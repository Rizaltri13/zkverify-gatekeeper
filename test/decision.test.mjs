import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/decision.mjs";

const VK = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const VK2 = "0x13aaaabbbbccccdddd0000111122223333444455556666777788889999aaaaff";
const A = "0xDe42a000000000000000000000000000009f01";
const B = "0x1111111111111111111111111111111111111111";

function input(overrides = {}) {
  return {
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
    proof_tx: "0xa8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a82c",
    ...overrides,
  };
}
const noSeen = new Set();

test("valid condition -> APPROVE / VALID_CONDITION / provable", () => {
  assert.deepEqual(decide(input(), noSeen), { decision: "APPROVE", reason_code: "VALID_CONDITION", provable: true });
});

test("VK_SUBSTITUTION", () => {
  const r = decide(input({ proof_vk: VK2 }), noSeen);
  assert.equal(r.decision, "REJECT"); assert.equal(r.reason_code, "VK_SUBSTITUTION"); assert.equal(r.provable, true);
});

test("VK comparison is case-insensitive", () => {
  const r = decide(input({ proof_vk: VK.toUpperCase().replace("0X", "0x") }), noSeen);
  assert.equal(r.decision, "APPROVE");
});

test("THRESHOLD_MISMATCH when balance below minimum", () => {
  const r = decide(input({ public_balance: "999" }), noSeen);
  assert.equal(r.reason_code, "THRESHOLD_MISMATCH");
});

test("balance == minimum still approves (circuit-verified boundary)", () => {
  assert.equal(decide(input({ public_balance: "1000" }), noSeen).decision, "APPROVE");
});

test("EXPIRED_CONDITION when current_block > expiry_block", () => {
  assert.equal(decide(input({ current_block: 8430001 }), noSeen).reason_code, "EXPIRED_CONDITION");
});

test("EXPIRED_CONDITION when current_block == expiry_block (circuit-verified boundary)", () => {
  assert.equal(decide(input({ current_block: 8430000 }), noSeen).reason_code, "EXPIRED_CONDITION");
});

test("RECIPIENT_MISMATCH", () => {
  assert.equal(decide(input({ condition_recipient: B }), noSeen).reason_code, "RECIPIENT_MISMATCH");
});

test("recipient comparison is case-insensitive", () => {
  assert.equal(decide(input({ recipient: A.toLowerCase() }), noSeen).decision, "APPROVE");
});

test("AMOUNT_OVERFLOW when amount above cap", () => {
  assert.equal(decide(input({ amount: "1001" }), noSeen).reason_code, "AMOUNT_OVERFLOW");
});

test("amount == max_transfer still approves (circuit-verified boundary)", () => {
  assert.equal(decide(input({ amount: "1000" }), noSeen).decision, "APPROVE");
});

test("PROOF_REUSED when proof_tx already seen, and it is not provable", () => {
  const seen = new Set([input().proof_tx.toLowerCase()]);
  const r = decide(input(), seen);
  assert.equal(r.decision, "REJECT"); assert.equal(r.reason_code, "PROOF_REUSED"); assert.equal(r.provable, false);
});

test("check order: VK_SUBSTITUTION beats PROOF_REUSED and THRESHOLD_MISMATCH", () => {
  const seen = new Set([input().proof_tx.toLowerCase()]);
  const r = decide(input({ proof_vk: VK2, public_balance: "1" }), seen);
  assert.equal(r.reason_code, "VK_SUBSTITUTION");
});

test("malformed inputs fail closed as INVALID_INPUT", () => {
  assert.equal(decide(null, noSeen).reason_code, "INVALID_INPUT");
  assert.equal(decide(input({ minimum: "abc" }), noSeen).reason_code, "INVALID_INPUT");
  assert.equal(decide(input({ proof_tx: undefined }), noSeen).reason_code, "INVALID_INPUT");
  assert.equal(decide(input({ amount: 1.5 }), noSeen).reason_code, "INVALID_INPUT");
});

test("numeric (non-string) integer fields are accepted", () => {
  assert.equal(decide(input({ minimum: 1000, public_balance: 1460, amount: 500, max_transfer: 1000 }), noSeen).decision, "APPROVE");
});
