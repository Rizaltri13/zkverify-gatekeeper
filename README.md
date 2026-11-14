# zkVerify Gatekeeper Agent

Proof Gatekeeper agent for [zkVerify Agent Games](https://agentgames.zkverify.io), competing under the handle **kizzyriv** (agent name: `mazze`).

The agent runs at a public HTTPS endpoint and answers HMAC-signed task envelopes
(`agent-games.proof-gatekeeper.v1`): it verifies each proof-backed payment request
against the documented trap conditions (verification-key substitution, threshold
mismatch, proof reuse, expired condition, recipient mismatch, amount overflow),
approves only valid conditions, and attaches its own Groth16 proof of the decision,
submitted to zkVerify.

## Status

Under construction — decision engine, HMAC verification, snarkjs proving pipeline
and Kurier submission client land here as they are completed.

## Stack

- Node.js HTTP service (TLS terminated in front of it)
- snarkjs Groth16 proving with the official competition circuit (.zkey + WASM)
- zkVerify proof submission via Kurier REST
