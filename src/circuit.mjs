// Circuit input building + Groth16 proving with snarkjs.
//
// The gatekeeper circuit (gatekeeper.wasm / gatekeeper_final.zkey, Circom 2.x,
// BN128) has exactly 13 inputs, recovered from the WASM itself
// (tools/probe-signals.mjs) and semantics verified empirically
// (tools/probe-semantics.mjs):
//   decision, registeredVkHash, proofVkHash, minimum, publicBalance,
//   expiryBlock, currentBlock, recipient, conditionRecipient, amount,
//   maxTransfer, taskId, salt
// The circuit asserts decision == 1 iff every field check passes
// (vk equal, balance >= minimum, currentBlock < expiryBlock,
// recipient equal, amount <= maxTransfer); decision == 0 iff at least one
// fails. decision: 1 = APPROVE, 0 = REJECT.
import crypto from "node:crypto";
import * as snarkjs from "snarkjs";

export const BN128_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

export function fieldFromHex(hex) {
  const s = String(hex).trim().toLowerCase().replace(/^0x/, "");
  if (/^[0-9a-f]+$/.test(s) && s.length > 0) return (BigInt("0x" + s) % BN128_PRIME).toString();
  // Non-hex identifier: hash it deterministically into the field.
  const h = crypto.createHash("sha256").update(String(hex)).digest("hex");
  return (BigInt("0x" + h) % BN128_PRIME).toString();
}

export function fieldFromAddress(addr) {
  return fieldFromHex(addr);
}

// FNV-1a 64-bit — the same hash family the circuit toolchain uses for signal
// names; here just a compact deterministic string -> field encoding.
export function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) % (1n << 64n);
  }
  return h;
}

export function encodeTaskId(taskId, encoding = "fnv") {
  const s = String(taskId);
  if (/^\d+$/.test(s)) return (BigInt(s) % BN128_PRIME).toString();
  if (encoding === "sha256") {
    const h = crypto.createHash("sha256").update(s).digest("hex");
    return (BigInt("0x" + h) % BN128_PRIME).toString();
  }
  return fnv1a64(s).toString();
}

// Deterministic per-task salt: idempotent retries of the same task reproduce
// the same proof instead of minting a fresh one.
export function deriveSalt(taskId, proofTx) {
  const h = crypto.createHash("sha256").update(`gk-salt:${taskId}:${proofTx}`).digest("hex");
  return (BigInt("0x" + h) % BN128_PRIME).toString();
}

export function buildCircuitInput(envelope, decision, encoding = "fnv") {
  const input = envelope.input;
  return {
    decision: decision === "APPROVE" ? "1" : "0",
    registeredVkHash: fieldFromHex(input.registered_vk),
    proofVkHash: fieldFromHex(input.proof_vk),
    minimum: String(BigInt(input.minimum)),
    publicBalance: String(BigInt(input.public_balance)),
    expiryBlock: String(BigInt(input.expiry_block)),
    currentBlock: String(BigInt(input.current_block)),
    recipient: fieldFromAddress(input.recipient),
    conditionRecipient: fieldFromAddress(input.condition_recipient),
    amount: String(BigInt(input.amount)),
    maxTransfer: String(BigInt(input.max_transfer)),
    taskId: encodeTaskId(envelope.task_id, encoding),
    salt: deriveSalt(envelope.task_id, input.proof_tx),
  };
}

export async function prove(circuitInput, { wasmPath, zkeyPath }) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, wasmPath, zkeyPath);
  return { proof, publicSignals };
}
