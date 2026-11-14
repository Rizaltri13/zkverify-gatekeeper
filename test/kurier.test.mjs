// Kurier client robustness (per KURIER.md §4): the submit response's
// optimisticVerify field is honored — a non-"success" verdict stops before
// any polling; a job landing on the terminal "Failed" status ends the wait
// immediately as a failure instead of burning the full budget and being
// mis-logged as a timeout; the Finalized path still works. fetch is stubbed;
// no network is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KurierClient } from "../src/kurier.mjs";

const realFetch = globalThis.fetch;

function stubFetch({ submit, statuses }) {
  const calls = { submit: 0, jobStatus: 0 };
  globalThis.fetch = async (url) => {
    if (String(url).includes("/submit-proof/")) {
      calls.submit += 1;
      return { ok: true, status: 200, json: async () => submit };
    }
    if (String(url).includes("/job-status/")) {
      calls.jobStatus += 1;
      const body = statuses[Math.min(calls.jobStatus - 1, statuses.length - 1)];
      return { ok: true, status: 200, json: async () => body };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return calls;
}

function client() {
  return new KurierClient({ apiKey: "test-key", apiUrl: "https://kurier.invalid/api/v1", vkHash: "0x0" });
}

test("kurier: Failed job status is terminal, not a timeout", async () => {
  const calls = stubFetch({
    submit: { jobId: "job-fail", optimisticVerify: "success" },
    statuses: [{ status: "Failed" }],
  });
  try {
    const started = Date.now();
    const res = await client().submitAndWait({}, [], 30000);
    const elapsed = Date.now() - started;
    assert.equal(res.status, "Failed");
    assert.equal(res.failed, true);
    assert.equal(calls.jobStatus, 1, "polling must stop at the first Failed status");
    assert.ok(elapsed < 20000, `must not burn the full wait (took ${elapsed}ms)`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("kurier: optimisticVerify !== success stops before polling", async () => {
  const calls = stubFetch({
    submit: { jobId: "job-ov", optimisticVerify: "failure" },
    statuses: [{ status: "Finalized" }],
  });
  try {
    const started = Date.now();
    const res = await client().submitAndWait({}, [], 30000);
    const elapsed = Date.now() - started;
    assert.equal(res.jobId, "job-ov");
    assert.equal(calls.jobStatus, 0, "a failed optimistic verification must not be polled");
    assert.ok(elapsed < 4000, `must return immediately (took ${elapsed}ms)`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("kurier: Finalized job still returns via the poll loop", async () => {
  const calls = stubFetch({
    submit: { jobId: "job-ok", optimisticVerify: "success" },
    statuses: [{ status: "IncludedInBlock" }, { status: "Finalized", txHash: "0xabc" }],
  });
  try {
    const res = await client().submitAndWait({}, [], 30000);
    assert.equal(res.status, "Finalized");
    assert.equal(res.txHash, "0xabc");
    assert.equal(res.failed, undefined);
    assert.equal(calls.jobStatus, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
