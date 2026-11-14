// Deterministic decision engine for Proof Gatekeeper tasks.
//
// Input: the envelope `input` object documented on the Build / event pages:
//   { registered_vk, proof_vk, minimum, public_balance, expiry_block,
//     current_block, recipient, condition_recipient, amount, max_transfer,
//     proof_tx }
// Output: { decision: "APPROVE"|"REJECT", reason_code, provable }
//   provable=false only for PROOF_REUSED: the event page states those tasks
//   "have no proof to submit" (reuse is not a circuit check — the gatekeeper
//   circuit asserts decision == (all field checks pass), so a reuse-only
//   rejection cannot be proven) and they are excluded from the proof bonus.
//
// Check order (single-fault traps make order mostly moot; fixed for
// determinism): VK -> REUSED -> EXPIRED -> RECIPIENT -> THRESHOLD -> AMOUNT.
// Boundary semantics were verified empirically against the real circuit
// (tools/probe-semantics.mjs): APPROVE requires public_balance >= minimum,
// amount <= max_transfer, and current_block < expiry_block (a task whose
// current_block == expiry_block is already expired).

function toBig(v, field) {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`field ${field} is not a safe integer`);
    return BigInt(v);
  }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new Error(`field ${field} is not an integer: ${JSON.stringify(v)}`);
}

function normHex(v) {
  return String(v ?? "").trim().toLowerCase();
}

function normAddr(v) {
  return normHex(v);
}

export function decide(input, seen) {
  if (!input || typeof input !== "object") {
    return { decision: "REJECT", reason_code: "INVALID_INPUT", provable: false };
  }
  let minimum, publicBalance, expiryBlock, currentBlock, amount, maxTransfer;
  try {
    minimum = toBig(input.minimum, "minimum");
    publicBalance = toBig(input.public_balance, "public_balance");
    expiryBlock = toBig(input.expiry_block, "expiry_block");
    currentBlock = toBig(input.current_block, "current_block");
    amount = toBig(input.amount, "amount");
    maxTransfer = toBig(input.max_transfer, "max_transfer");
  } catch {
    return { decision: "REJECT", reason_code: "INVALID_INPUT", provable: false };
  }
  if (!input.registered_vk || !input.proof_vk || !input.recipient || !input.condition_recipient || !input.proof_tx) {
    return { decision: "REJECT", reason_code: "INVALID_INPUT", provable: false };
  }

  // 1. Verification-key substitution: the incoming proof's VK must equal the
  //    VK registered for the condition.
  if (normHex(input.proof_vk) !== normHex(input.registered_vk)) {
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION", provable: true };
  }
  // 2. Proof reuse: the reference was already presented by an earlier task.
  if (seen && seen.has(normHex(input.proof_tx))) {
    return { decision: "REJECT", reason_code: "PROOF_REUSED", provable: false };
  }
  // 3. Expired condition: current block has reached the expiry block.
  if (currentBlock >= expiryBlock) {
    return { decision: "REJECT", reason_code: "EXPIRED_CONDITION", provable: true };
  }
  // 4. Recipient mismatch: proof recipient must equal the condition recipient.
  if (normAddr(input.recipient) !== normAddr(input.condition_recipient)) {
    return { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH", provable: true };
  }
  // 5. Threshold mismatch: disclosed public balance below required minimum.
  if (publicBalance < minimum) {
    return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH", provable: true };
  }
  // 6. Amount overflow: requested amount above the single-transfer cap.
  if (amount > maxTransfer) {
    return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW", provable: true };
  }
  return { decision: "APPROVE", reason_code: "VALID_CONDITION", provable: true };
}
