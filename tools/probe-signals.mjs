import { WitnessCalculatorBuilder } from "circom_runtime";
import { fnvHash } from "../node_modules/circom_runtime/js/utils.js";
import fs from "fs";

const wasm = fs.readFileSync(new URL("../circuits/gatekeeper.wasm", import.meta.url));
const wc = await WitnessCalculatorBuilder(wasm);
const ex = wc.instance.exports;
console.log("getInputSize (total input field elements):", ex.getInputSize());
console.log("getWitnessSize:", ex.getWitnessSize());

function sizeOf(name) {
  const h = fnvHash(name);
  const msb = parseInt(h.slice(0, 8), 16), lsb = parseInt(h.slice(8, 16), 16);
  return ex.getInputSignalSize(msb, lsb);
}

const stems = [
  "decision","approve","approved","isApproved","is_approved","verdict","outcome",
  "reason","reasonCode","reason_code","reasonId","reasonHash",
  "vk","vkHash","vk_hash","registeredVk","registered_vk","registeredVkHash","registered_vk_hash",
  "proofVk","proof_vk","proofVkHash","proof_vk_hash","vkMatch","vk_match","vkMatches","vkOk","vk_ok","vkMatchesRegistered",
  "minimum","min","minAmount","threshold","required","requiredMinimum","minBalance",
  "publicBalance","public_balance","balance","balanceOk","thresholdOk","threshold_ok","balanceMeetsMinimum",
  "expiry","expiryBlock","expiry_block","expiryOk","expired","isExpired","notExpired","expiryPassed",
  "currentBlock","current_block","currentHeight","blockNumber","block","blockHeight",
  "recipient","conditionRecipient","condition_recipient","expectedRecipient","recipientMatch","recipient_match","recipientOk",
  "amount","transferAmount","maxTransfer","max_transfer","cap","amountOk","amount_ok","overflow","amountOverflow","withinCap",
  "proofTx","proof_tx","proofHash","proofRef","proof_ref","proofReference","txHash","proofSeen",
  "seen","reused","proofReused","proof_reused","isReused","notReused","fresh","isFresh",
  "taskId","task_id","taskHash","nonce","timestamp","issuedAt","deadline","deadlineBlock",
  "valid","isValid","allOk","checks","flags","score","points","passed",
  "vkSubstitution","thresholdMismatch","conditionHash","statementHash","inputHash","publicInputsHash","envelopeHash",
  "sender","from","to","payer","payee","address","condition","statement",
  "a","b","c","x","y","out","result","ok","pass","accept","accepted",
  "vk_equal","vkEqual","balance_ge_minimum","recipient_equal","amount_le_max","not_expired","not_reused",
];
const prefixes = ["", "main."];
const found = [];
for (const p of prefixes) for (const s of stems) {
  const name = p + s;
  let size;
  try { size = sizeOf(name); } catch { continue; }
  if (size > 0) found.push({ name, size });
}
console.log(JSON.stringify(found, null, 2));
console.log("total elements accounted:", found.reduce((a, f) => a + f.size, 0));
