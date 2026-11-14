# Proof Gatekeeper agent (zkVerify Agent Games)

Node service implementing the `agent-games.proof-gatekeeper.v1` protocol:
HMAC-signed task envelopes in, deterministic APPROVE/REJECT decisions out,
each with a locally generated Groth16 proof (snarkjs) and optional Kurier
(zkVerify) submission. Full design/verification notes: `../NOTES.md`.

## Run

```bash
npm install
node index.mjs            # listens on PORT (default 8787), path /agent
```

Configuration is env-only — see `.env.example`. The HMAC secret is read from
`AGENT_GAMES_HMAC_SECRET_FILE`, else `AGENT_GAMES_HMAC_SECRET`, else (on the
dev VM) `~/workspace/user/zkverify/hmac-secret.txt`. Without
`KURIER_API_KEY` the agent runs in Kurier STUB mode (proofs returned in the
response, nothing submitted, clearly logged).

On hosts whose egress needs a proxy, start with `NODE_USE_ENV_PROXY=1`
(the Kurier client also installs an undici `EnvHttpProxyAgent` when the
`undici` package is present).

## Test

```bash
npm test                  # decision unit tests + e2e + secret-file wiring
node tools/prove-test.mjs # standalone prove + local verify timing check
```
