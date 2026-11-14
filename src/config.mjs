// Configuration loaded from environment variables only. Secrets are never
// hardcoded; the HMAC secret comes from AGENT_GAMES_HMAC_SECRET_FILE,
// AGENT_GAMES_HMAC_SECRET, or — when present — the restricted file issued at
// registration: ~/workspace/user/zkverify/hmac-secret.txt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SECRET_FILE = path.join(os.homedir(), "workspace", "user", "zkverify", "hmac-secret.txt");

function loadHmacSecret() {
  const file = process.env.AGENT_GAMES_HMAC_SECRET_FILE;
  if (file) {
    try {
      return { raw: fs.readFileSync(file, "utf8").trim(), source: `file:${file}` };
    } catch (e) {
      return { raw: null, source: `file:${file}`, error: String(e.message || e) };
    }
  }
  if (process.env.AGENT_GAMES_HMAC_SECRET) {
    return { raw: process.env.AGENT_GAMES_HMAC_SECRET.trim(), source: "env:AGENT_GAMES_HMAC_SECRET" };
  }
  if (fs.existsSync(DEFAULT_SECRET_FILE)) {
    try {
      return { raw: fs.readFileSync(DEFAULT_SECRET_FILE, "utf8").trim(), source: `file:${DEFAULT_SECRET_FILE} (default)` };
    } catch (e) {
      return { raw: null, source: `file:${DEFAULT_SECRET_FILE} (default)`, error: String(e.message || e) };
    }
  }
  return { raw: null, source: "none" };
}

const secretInfo = loadHmacSecret();

export const config = {
  port: Number(process.env.PORT || 8787),
  agentPath: process.env.AGENT_PATH || "/agent",
  hmacSecretRaw: secretInfo.raw,
  hmacSecretSource: secretInfo.source,
  hmacSecretError: secretInfo.error || null,
  kurierApiKey: process.env.KURIER_API_KEY || "",
  kurierApiUrl: (process.env.KURIER_API_URL || "https://api.kurier.xyz/api/v1").replace(/\/$/, ""),
  gatekeeperVkHash:
    process.env.GATEKEEPER_VK_HASH ||
    "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
  kurierWaitMs: Number(process.env.KURIER_WAIT_MS ?? 25000),
  seenStorePath: path.resolve(ROOT, process.env.SEEN_STORE_PATH || "./data/seen.json"),
  taskIdEncoding: process.env.TASKID_ENCODING || "sha256",
  logLevel: process.env.LOG_LEVEL || "info",
  wasmPath: path.join(ROOT, "circuits", "gatekeeper.wasm"),
  zkeyPath: path.join(ROOT, "circuits", "gatekeeper_final.zkey"),
  vkPath: path.join(ROOT, "circuits", "verification_key.json"),
  // Hard platform deadline is 60s; keep an internal soft budget below it.
  softDeadlineMs: Number(process.env.SOFT_DEADLINE_MS || 50000),
};
