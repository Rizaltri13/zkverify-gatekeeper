import { WitnessCalculatorBuilder } from "circom_runtime";
import fs from "fs";

const wasm = fs.readFileSync(new URL("../circuits/gatekeeper.wasm", import.meta.url));
const wc = await WitnessCalculatorBuilder(wasm);

const ADDR = BigInt("0xDe42a000000000000000000000000000009f01").toString();
const base = {
  decision: "1",
  registeredVkHash: "12345",
  proofVkHash: "12345",
  minimum: "1000",
  publicBalance: "1460",
  expiryBlock: "8430000",
  currentBlock: "8420000",
  recipient: ADDR,
  conditionRecipient: ADDR,
  amount: "500",
  maxTransfer: "1000",
  taskId: "777",
  salt: "999",
};

async function trial(label, overrides) {
  const input = { ...base, ...overrides };
  try {
    const w = await wc.calculateWitness(input, true);
    // public signals are the first witnesses after the constant 1: order = outputs then public inputs (declaration order unknown);
    // just report success and the first 16 witness values
    console.log(`PASS  ${label}  witness[0..15]=${w.slice(0, 16).join(",")}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${label}  -> ${String(e.message || e).slice(0, 100)}`);
    return false;
  }
}

await trial("base approve (all valid, decision=1)", {});
await trial("decision=0 with all valid", { decision: "0" });
await trial("decision=1, vk mismatch", { proofVkHash: "99999" });
await trial("decision=0, vk mismatch", { decision: "0", proofVkHash: "99999" });
await trial("decision=1, balance<minimum", { publicBalance: "999" });
await trial("decision=0, balance<minimum", { decision: "0", publicBalance: "999" });
await trial("decision=1, balance==minimum", { publicBalance: "1000" });
await trial("decision=1, expired (current>expiry)", { currentBlock: "8430001" });
await trial("decision=0, expired (current>expiry)", { decision: "0", currentBlock: "8430001" });
await trial("decision=1, current==expiry", { currentBlock: "8430000" });
await trial("decision=0, current==expiry", { decision: "0", currentBlock: "8430000" });
await trial("decision=1, recipient mismatch", { conditionRecipient: "123" });
await trial("decision=0, recipient mismatch", { decision: "0", conditionRecipient: "123" });
await trial("decision=1, amount>max", { amount: "1001" });
await trial("decision=0, amount>max", { decision: "0", amount: "1001" });
await trial("decision=1, amount==max", { amount: "1000" });
await trial("decision=2 (invalid decision value), all valid", { decision: "2" });
await trial("decision=0, two traps (vk+amount)", { decision: "0", proofVkHash: "99999", amount: "1001" });
