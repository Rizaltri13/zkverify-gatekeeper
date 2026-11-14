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
  // The proxy dispatcher is a Node-on-this-VM concern only:
  // - Under Deno (Deno Deploy) there is no env-proxy requirement and the
  //   runtime's global fetch must be left untouched (the npm undici build
  //   is not Deno-compatible), so never attempt the import there.
  // - Without any proxy env var there is nothing to configure.
  // Any failure is non-fatal: log and continue with the global fetch.
  if (typeof globalThis.Deno !== "undefined") return;
  const hasProxyEnv = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    .some((k) => process.env[k]);
  if (!hasProxyEnv) return;
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
    log("info", "kurier.submitted", {
      jobId: job.jobId || job.id || null,
      status: job.status || "Submitted",
      optimisticVerify: job.optimisticVerify ?? null,
    });
    // Per the Kurier docs, the submit response's optimisticVerify field is
    // the fast verification verdict: anything other than "success" means the
    // proof failed verification — surface it immediately instead of letting
    // it emerge later as an opaque Failed job.
    if (typeof job.optimisticVerify === "string" && job.optimisticVerify !== "success") {
      log("error", "kurier.optimistic_verify_failed", {
        jobId: job.jobId || job.id || null,
        optimisticVerify: job.optimisticVerify,
        message: "Kurier optimistic verification did not succeed — proof verification failed, check artifacts",
      });
    }
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
      // Docs treat optimisticVerify !== "success" as a failed verification
      // and stop — don't poll a job that is already known to be bad.
      if (typeof job.optimisticVerify === "string" && job.optimisticVerify !== "success") {
        return { ...job, jobId, status: job.status || "Submitted" };
      }
      if (!jobId || !waitMs || waitMs <= 0) return { ...job, status: job.status || "Submitted" };
      const deadline = Date.now() + waitMs;
      let status = job.status || "Submitted";
      let last = job;
      while (Date.now() < deadline) {
        if (/final/i.test(status)) break;
        // "Failed" is a terminal job status (docs) — stop polling at once
        // and surface it as a failure, not as a wait timeout.
        if (/fail/i.test(status)) {
          log("error", "kurier.job_failed", { jobId, status });
          return { ...last, jobId, status, failed: true };
        }
        // Poll interval per the Kurier docs' example (5s).
        await new Promise((r) => setTimeout(r, 5000));
        const s = await this.jobStatus(jobId);
        last = s;
        status = s.status || s.jobStatus || status;
        if (/final/i.test(status)) {
          log("info", "kurier.finalized", { jobId, status, txHash: s.txHash || s.proofTx || null });
          return { ...s, jobId, status };
        }
      }
      if (/fail/i.test(status)) {
        log("error", "kurier.job_failed", { jobId, status });
        return { ...last, jobId, status, failed: true };
      }
      log("warn", "kurier.wait_timeout", { jobId, status });
      return { jobId, status };
    } catch (e) {
      log("error", "kurier.error", { error: String(e.message || e) });
      return { error: String(e.message || e) };
    }
  }
}
