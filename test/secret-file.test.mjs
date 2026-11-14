// Verifies the production secret wiring: the server loads the HMAC secret
// from the restricted file issued at registration
// (~/workspace/user/zkverify/hmac-secret.txt) via AGENT_GAMES_HMAC_SECRET_FILE,
// accepts requests signed with that key, and rejects requests signed with a
// different key. The secret value is never printed or asserted on directly —
// only that the derived key is 32 bytes and signatures round-trip.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { secretToKey, signBody, verifyBody } from "../src/hmac.mjs";
import { DEFAULT_SECRET_FILE } from "../src/config.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 18788;
const BASE = `http://127.0.0.1:${PORT}`;

const raw = fs.readFileSync(DEFAULT_SECRET_FILE, "utf8").trim();
const key = secretToKey(raw);
const wrongKey = secretToKey("22".repeat(32));

let child;
let tmpDir;
before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-secret-"));
  child = spawn("node", ["index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_PATH: "/agent",
      AGENT_GAMES_HMAC_SECRET_FILE: DEFAULT_SECRET_FILE,
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

test("secret file yields a 32-byte key", () => {
  assert.ok(key, "key derived");
  assert.equal(key.length, 32);
  assert.equal(raw.length, 64, "stored secret is 64 hex chars");
});

test("preflight signed with the REAL registration secret is accepted and response signature verifies", async () => {
  const bodyRaw = Buffer.from(JSON.stringify({
    type: "agent-games.preflight.v1", agent_id: "agt_mazze", issued_at: new Date().toISOString(), nonce: "wiring-check",
  }), "utf8");
  const res = await fetch(BASE + "/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-games-signature": signBody(key, bodyRaw) },
    body: bodyRaw,
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { ok: true, protocolVersion: "v1" });
  assert.ok(verifyBody(key, Buffer.from(text, "utf8"), res.headers.get("x-agent-games-signature")));
});

test("request signed with a WRONG key is rejected 401", async () => {
  const bodyRaw = Buffer.from(JSON.stringify({
    type: "agent-games.preflight.v1", agent_id: "agt_mazze", issued_at: new Date().toISOString(), nonce: "wiring-check-2",
  }), "utf8");
  const res = await fetch(BASE + "/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-games-signature": signBody(wrongKey, bodyRaw) },
    body: bodyRaw,
  });
  assert.equal(res.status, 401);
});
