import * as snarkjs from "snarkjs";
import fs from "fs";

const WASM = new URL("../circuits/gatekeeper.wasm", import.meta.url).pathname;
const ZKEY = new URL("../circuits/gatekeeper_final.zkey", import.meta.url).pathname;
const VK = JSON.parse(fs.readFileSync(new URL("../circuits/verification_key.json", import.meta.url), "utf8"));

const PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const fieldFromHash = (hex) => (BigInt(hex) % PRIME).toString();
const VK_HASH = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const ADDR = BigInt("0xDe42a000000000000000000000000000009f01").toString();

const approveInput = {
  decision: "1",
  registeredVkHash: fieldFromHash(VK_HASH),
  proofVkHash: fieldFromHash(VK_HASH),
  minimum: "1000",
  publicBalance: "1460",
  expiryBlock: "8430000",
  currentBlock: "8420000",
  recipient: ADDR,
  conditionRecipient: ADDR,
  amount: "500",
  maxTransfer: "1000",
  taskId: "424242",
  salt: "987654321",
};
const rejectInput = { ...approveInput, decision: "0", proofVkHash: fieldFromHash("0x13aaaabbbbccccdddd0000111122223333444455556666777788889999aaaaff") };

for (const [label, input] of [["APPROVE", approveInput], ["REJECT (vk mismatch)", rejectInput]]) {
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ms = Date.now() - t0;
  const ok = await snarkjs.groth16.verify(VK, publicSignals, proof);
  console.log(`${label}: prove ${ms} ms, publicSignals (${publicSignals.length}): ${JSON.stringify(publicSignals)}`);
  console.log(`${label}: local verify vs exported VK -> ${ok}`);
  console.log(`${label}: proof keys: ${Object.keys(proof).join(",")}`);
}
