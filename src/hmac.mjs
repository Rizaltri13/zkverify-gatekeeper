// HMAC-SHA256 signing/verification for x-agent-games-signature.
// Per the Build page: compute the HMAC over the RAW body and compare it to the
// header BEFORE parsing JSON. The platform secret is 32 bytes shown once as
// plaintext; we accept it as a 64-char hex string, a base64 string decoding to
// 32 bytes, or (fallback) the raw UTF-8 string.
import crypto from "node:crypto";

export function secretToKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  try {
    const b = Buffer.from(s, "base64");
    if (b.length === 32) return b;
  } catch { /* fall through */ }
  return Buffer.from(s, "utf8");
}

export function signBody(key, rawBody) {
  return crypto.createHmac("sha256", key).update(rawBody).digest("hex");
}

export function verifyBody(key, rawBody, headerValue) {
  if (!key || !headerValue) return false;
  const provided = String(headerValue).trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return false;
  const expected = signBody(key, rawBody);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
