// Kurier (zkVerify) submission client, following the Build page's documented
// pattern:
//   POST {KURIER_API_URL}/submit-proof/{KURIER_API_KEY}
//   { proofType: "groth16", vkRegistered: true,
//     proofOptions: { library: "snarkjs", curve: "bn128" },
//     proofData: { proof, publicSignals, vk: <gatekeeper vk_hash> } }
// then poll the job until it reaches Finalized.
//
// If KURIER_API_KEY is not configured the client runs in STUB mode: it logs
// clearly and returns { stub: true } without any network call. Outbound HTTP
// goes through the environment proxy (this VM requires it): we install an
// undici EnvHttpProxyAgent dispatcher when available, and the service can
// also be started with NODE_USE_ENV_PROXY=1.
import { log } from "./log.mjs";

let dispatcherReady = false;
async function ensureDispatcher() {
  if (dispatcherReady) return;
  dispatcherReady = true;
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch (e) {
    log("warn", "kurier.dispatcher_unavailable", { error: String(e.message || e) });
  }
}

export class KurierClient {
  constructor({ apiKey, apiUrl, vkHash }) {
    this.apiKey = apiKey || "";
    this.apiUrl = apiUrl;
    this.vkHash = vkHash;
    this.stub = !this.apiKey;
  }

  async submitProof(proof, publicSignals) {
    if (this.stub) {
      log("warn", "kurier.stub_skip", {
        reason: "KURIER_API_KEY not set — STUB mode, proof NOT submitted to zkVerify",
      });
      return { stub: true, status: "stub" };
    }
    await ensureDispatcher();
    const res = await fetch(`${this.apiUrl}/submit-proof/${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: { library: "snarkjs", curve: "bn128" },
        proofData: { proof, publicSignals, vk: this.vkHash },
      }),
    });
    const job = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Kurier submit failed: HTTP ${res.status} ${JSON.stringify(job).slice(0, 200)}`);
    }
    log("info", "kurier.submitted", { jobId: job.jobId || job.id || null, status: job.status || "Submitted" });
    return job;
  }

  async jobStatus(jobId) {
    await ensureDispatcher();
    const res = await fetch(`${this.apiUrl}/job-status/${this.apiKey}/${jobId}`, { method: "GET" });
    if (!res.ok) throw new Error(`Kurier job-status failed: HTTP ${res.status}`);
    return res.json();
  }

  // Submit and wait (bounded) for a Finalized status. Never throws: Kurier is
  // confirmation/audit — the platform response carries the proof itself.
  async submitAndWait(proof, publicSignals, waitMs) {
    if (this.stub) return this.submitProof(proof, publicSignals);
    try {
      const job = await this.submitProof(proof, publicSignals);
      const jobId = job.jobId || job.id;
      if (!jobId || !waitMs || waitMs <= 0) return { ...job, status: job.status || "Submitted" };
      const deadline = Date.now() + waitMs;
      let status = job.status || "Submitted";
      while (Date.now() < deadline) {
        if (/final/i.test(status)) break;
        await new Promise((r) => setTimeout(r, 3000));
        const s = await this.jobStatus(jobId);
        status = s.status || s.jobStatus || status;
        if (/final/i.test(status)) {
          log("info", "kurier.finalized", { jobId, status, txHash: s.txHash || s.proofTx || null });
          return { ...s, jobId, status };
        }
      }
      log("warn", "kurier.wait_timeout", { jobId, status });
      return { jobId, status };
    } catch (e) {
      log("error", "kurier.error", { error: String(e.message || e) });
      return { error: String(e.message || e) };
    }
  }
}
