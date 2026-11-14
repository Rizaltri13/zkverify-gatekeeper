// Proof Gatekeeper agent server.
//
// POST {AGENT_PATH}  — platform endpoint: preflight + task envelopes.
// GET  /health      — health check (also GET on the agent path).
//
// Request flow (per the Build page):
//   1. Read the RAW body; verify x-agent-games-signature (HMAC-SHA256 over the
//      raw body) BEFORE parsing JSON. Mismatch -> 401.
//   2. agent-games.preflight.v1 -> { ok: true, protocolVersion: "v1" }.
//   3. agent-games.proof-gatekeeper.v1 -> decide deterministically, generate
//      our own Groth16 proof with snarkjs, submit to Kurier (if configured),
//      and reply { decision, reason_code, proof_tx, proof, public_signals }.
//      PROOF_REUSED replies carry no proof (documented exclusion).
//   4. Every JSON response is signed with x-agent-games-signature over the
//      raw response body.
// Task IDs are idempotency keys: a retried task_id returns the cached
// response byte-for-byte. Fail closed: any internal error on a task still
// returns a timely REJECT rather than timing out.
import http from "node:http";
import { config } from "./config.mjs";
import { log } from "./log.mjs";
import { secretToKey, signBody, verifyBody } from "./hmac.mjs";
import { decide } from "./decision.mjs";
import { SeenStore } from "./seen.mjs";
import { buildCircuitInput, prove } from "./circuit.mjs";
import { KurierClient } from "./kurier.mjs";

const key = secretToKey(config.hmacSecretRaw);
if (!key) {
  log("warn", "server.no_hmac_secret", {
    message:
      "AGENT_GAMES_HMAC_SECRET(_FILE) not set — signature verification DISABLED (dev only). Platform preflight will fail until the real secret is configured.",
  });
} else {
  log("info", "server.hmac_secret_loaded", { source: config.hmacSecretSource });
}
if (config.hmacSecretError) log("error", "server.hmac_secret_read_error", { error: config.hmacSecretError });

const seen = new SeenStore(config.seenStorePath);
const kurier = new KurierClient({
  apiKey: config.kurierApiKey,
  apiUrl: config.kurierApiUrl,
  vkHash: config.gatekeeperVkHash,
});
if (kurier.stub) log("warn", "server.kurier_stub_mode", { message: "KURIER_API_KEY not set — proofs will not be submitted to zkVerify" });

// Idempotency cache: task_id -> serialized response body (bounded FIFO).
const responseCache = new Map();
const CACHE_MAX = 1000;
function cacheGet(id) { return responseCache.get(id); }
function cacheSet(id, body) {
  if (responseCache.size >= CACHE_MAX) responseCache.delete(responseCache.keys().next().value);
  responseCache.set(id, body);
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const headers = { "content-type": "application/json", "content-length": body.length };
  if (key) headers["x-agent-games-signature"] = signBody(key, body);
  res.writeHead(status, headers);
  res.end(body);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function handleTask(envelope) {
  const started = Date.now();
  const taskId = envelope.task_id || null;
  const outcome = decide(envelope.input, seen);
  log("info", "task.decided", {
    task_id: taskId,
    mode: envelope.mode || null,
    decision: outcome.decision,
    reason_code: outcome.reason_code,
    provable: outcome.provable,
  });

  const response = { decision: outcome.decision, reason_code: outcome.reason_code, proof_tx: envelope.input?.proof_tx ?? null };

  if (outcome.provable && outcome.reason_code !== "INVALID_INPUT") {
    try {
      const circuitInput = buildCircuitInput(envelope, outcome.decision, config.taskIdEncoding);
      const { proof, publicSignals } = await withTimeout(
        prove(circuitInput, { wasmPath: config.wasmPath, zkeyPath: config.zkeyPath }),
        config.softDeadlineMs,
        "groth16 prove"
      );
      response.proof = proof;
      response.public_signals = publicSignals;
      log("info", "task.proved", { task_id: taskId, ms: Date.now() - started });
      // Kurier submission (confirmation/audit). Bounded wait; failures logged,
      // never block or fail the response.
      const remaining = Math.max(0, config.softDeadlineMs - (Date.now() - started));
      const waitMs = Math.min(config.kurierWaitMs, remaining);
      const job = await kurier.submitAndWait(proof, publicSignals, waitMs);
      if (job && !job.stub && !job.error) response.kurier_job_id = job.jobId || job.id || null;
    } catch (e) {
      // Fail closed on the decision, open about the missing proof: a timely
      // decision without a proof scores better than a timeout.
      log("error", "task.prove_failed", { task_id: taskId, error: String(e.message || e) });
      delete response.proof;
      delete response.public_signals;
    }
  }

  // Record the incoming proof reference as seen (once per task_id; retries
  // are served from the cache before this point).
  if (envelope.input?.proof_tx) seen.add(envelope.input.proof_tx);
  log("info", "task.responded", { task_id: taskId, ms: Date.now() - started });
  return response;
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === config.agentPath)) {
      return sendJson(res, 200, {
        ok: true,
        service: "proof-gatekeeper",
        protocolVersion: "v1",
        kurier: kurier.stub ? "stub" : "configured",
        seen_proofs: seen.size,
      });
    }
    if (req.method !== "POST" || url.pathname !== config.agentPath) {
      return sendJson(res, 404, { ok: false, error: "not found" });
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on("end", async () => {
      const raw = Buffer.concat(chunks);
      // 1. Verify signature over the RAW body before parsing.
      if (key && !verifyBody(key, raw, req.headers["x-agent-games-signature"])) {
        log("warn", "request.bad_signature", { bytes: raw.length });
        return sendJson(res, 401, { ok: false, error: "invalid signature" });
      }
      let envelope;
      try {
        envelope = JSON.parse(raw.toString("utf8"));
      } catch {
        return sendJson(res, 400, { ok: false, error: "invalid json" });
      }
      try {
        if (envelope.type === "agent-games.preflight.v1") {
          log("info", "preflight.ok", { agent_id: envelope.agent_id || null });
          return sendJson(res, 200, { ok: true, protocolVersion: "v1" });
        }
        if (envelope.type === "agent-games.proof-gatekeeper.v1") {
          const cached = envelope.task_id ? cacheGet(envelope.task_id) : null;
          if (cached) {
            log("info", "task.idempotent_replay", { task_id: envelope.task_id });
            const body = Buffer.from(cached, "utf8");
            const headers = { "content-type": "application/json", "content-length": body.length };
            if (key) headers["x-agent-games-signature"] = signBody(key, body);
            res.writeHead(200, headers);
            return res.end(body);
          }
          const response = await handleTask(envelope);
          if (envelope.task_id) cacheSet(envelope.task_id, JSON.stringify(response));
          return sendJson(res, 200, response);
        }
        log("warn", "request.unknown_type", { type: envelope.type || null });
        return sendJson(res, 400, { ok: false, error: "unknown envelope type" });
      } catch (e) {
        log("error", "request.handler_error", { error: String(e.message || e) });
        // Fail closed for tasks: a REJECT response beats a timeout.
        if (envelope && envelope.type === "agent-games.proof-gatekeeper.v1") {
          return sendJson(res, 200, {
            decision: "REJECT",
            reason_code: "INTERNAL_ERROR",
            proof_tx: envelope.input?.proof_tx ?? null,
          });
        }
        return sendJson(res, 500, { ok: false, error: "internal error" });
      }
    });
    req.on("error", () => { try { res.destroy(); } catch { /* noop */ } });
  });
}

export function start() {
  const server = createServer();
  server.listen(config.port, () => {
    log("info", "server.listening", { port: config.port, agent_path: config.agentPath });
  });
  return server;
}
