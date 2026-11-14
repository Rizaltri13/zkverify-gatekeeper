// Persistent seen-set of incoming proof_tx references (PROOF_REUSED
// detection), stored as a JSON array and rewritten atomically.
import fs from "node:fs";
import path from "node:path";

export class SeenStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.set = new Set();
    try {
      const arr = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Array.isArray(arr)) for (const x of arr) this.set.add(String(x).toLowerCase());
    } catch { /* fresh store */ }
  }
  has(tx) { return this.set.has(String(tx).toLowerCase()); }
  add(tx) {
    const k = String(tx).toLowerCase();
    if (this.set.has(k)) return;
    this.set.add(k);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify([...this.set]));
      fs.renameSync(tmp, this.filePath);
    } catch { /* persistence is best-effort; in-memory set still works */ }
  }
  get size() { return this.set.size; }
}
