// End-to-end test: spawns the real server (node index.mjs) with a test HMAC
// secret and Kurier in stub mode, then drives signed envelopes for every
// documented case. Proofs returned by the server are verified locally with
// snarkjs against the exported verification key.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { secretToKey, signBody, verifyBody } from "../src/hmac.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 18787;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET_HEX = "11".repeat(32);
const key = secretToKey(SECRET_HEX);
const VK_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, "circuits", "verification_key.json"), "utf8"));

const VK = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const VK2 = "0x13aaaabbbbccccdddd0000111122223333444455556666777788889999aaaaff";
const A = "0xDe42a000000000000000000000000000009f01";
const B = "0x1111111111111111111111111111111111111111";
let txCounter = 0;
const freshTx = () => "0x" + (++txCounter).toString(16).padStart(64, "0");

function envelope(overrides = {}, inputOverrides = {}) {
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: overrides.task_id || `gk_test_${Math.random().toString(36).slice(2, 10)}`,
    mode: "practice",
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
    input: {
      registered_vk: VK,
      proof_vk: VK,
      minimum: "1000",
      public_balance: "1460",
      expiry_block: 8430000,
      current_block: 8420000,
      recipient: A,
      condition_recipient: A,
      amount: "500",
      max_transfer: "1000",
      proof_tx: freshTx(),
      ...inputOverrides,
    },
    ...overrides,
  };
}

async function post(pathname, obj, { sign = true } = {}) {
  const raw = Buffer.from(JSON.stringify(obj), "utf8");
  const headers = { "content-type": "application/json" };
  if (sign) headers["x-agent-games-signature"] = signBody(key, raw);
  const res = await fetch(BASE + pathname, { method: "POST", headers, body: raw });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, rawBody: text };
}

let child;
let tmpDir;
before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-e2e-"));
  child = spawn("node", ["index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_PATH: "/agent",
      AGENT_GAMES_HMAC_SECRET: SECRET_HEX,
      KURIER_API_KEY: "",
      SEEN_STORE_PATH: path.join(tmpDir, "seen.json"),
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + "/health");
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not come up");
});

after(() => {
  if (child) child.kill("SIGKILL");
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("health endpoint", async () => {
  const r = await fetch(BASE + "/health");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
});

test("preflight handshake returns signed ok", async () => {
  const { status, headers, rawBody } = await post("/agent", {
    type: "agent-games.preflight.v1", agent_id: "agt_test", issued_at: new Date().toISOString(), nonce: "abc123",
  });
  assert.equal(status, 200);
  const j = JSON.parse(rawBody);
  assert.deepEqual(j, { ok: true, protocolVersion: "v1" });
  assert.ok(verifyBody(key, Buffer.from(rawBody, "utf8"), headers.get("x-agent-games-signature")), "response signature must verify");
});

test("bad signature -> 401", async () => {
  const { status } = await post("/agent", envelope(), { sign: false });
  assert.equal(status, 401);
});

test("VALID task -> APPROVE with a locally verifiable Groth16 proof", { timeout: 120000 }, async () => {
  const { status, body } = await post("/agent", envelope());
  assert.equal(status, 200);
  assert.equal(body.decision, "APPROVE");
  assert.equal(body.reason_code, "VALID_CONDITION");
  assert.ok(body.proof && Array.isArray(body.public_signals), "proof + public_signals present");
  assert.equal(body.public_signals.length, 13);
  assert.equal(await snarkjs.groth16.verify(VK_JSON, body.public_signals, body.proof), true);
});

const traps = [
  ["VK_SUBSTITUTION", { proof_vk: VK2 }],
  ["THRESHOLD_MISMATCH", { public_balance: "10" }],
  ["EXPIRED_CONDITION", { current_block: 8430000 }],
  ["RECIPIENT_MISMATCH", { condition_recipient: B }],
  ["AMOUNT_OVERFLOW", { amount: "1001" }],
];
for (const [code, over] of traps) {
  test(`trap ${code} -> REJECT with verifiable proof`, { timeout: 120000 }, async () => {
    const { status, body } = await post("/agent", envelope({}, over));
    assert.equal(status, 200);
    assert.equal(body.decision, "REJECT");
    assert.equal(body.reason_code, code);
    assert.ok(body.proof, "proof present for provable trap");
    assert.equal(await snarkjs.groth16.verify(VK_JSON, body.public_signals, body.proof), true);
  });
}

test("PROOF_REUSED: second presentation of same proof_tx rejected without proof; same task_id replays cached response", { timeout: 120000 }, async () => {
  const sharedTx = freshTx();
  const first = envelope({ task_id: "gk_reuse_first" }, { proof_tx: sharedTx });
  const r1 = await post("/agent", first);
  assert.equal(r1.body.decision, "APPROVE");

  const second = envelope({ task_id: "gk_reuse_second" }, { proof_tx: sharedTx });
  const r2 = await post("/agent", second);
  assert.equal(r2.body.decision, "REJECT");
  assert.equal(r2.body.reason_code, "PROOF_REUSED");
  assert.equal(r2.body.proof, undefined, "PROOF_REUSED carries no proof (documented exclusion)");

  const replay = await post("/agent", first);
  assert.equal(replay.body.decision, "APPROVE", "idempotent retry returns the cached response");
  assert.deepEqual(replay.body, r1.body);
});
