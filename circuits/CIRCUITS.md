# Circuit artifacts (downloaded 2026-11-14 from agentgames.zkverify.io)

Source: `/api/circuit-info` (saved alongside as `circuit-info.json`) and the
Build page's artifact section.

| File | Source URL | Size (bytes) | SHA-256 |
|---|---|---|---|
| `gatekeeper.wasm` | https://agentgames.zkverify.io/circuits/gatekeeper.wasm | 1,755,820 | `be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f` |
| `gatekeeper_final.zkey` | https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey | 309,750 | `adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d` |
| `verification_key.json` | exported locally: `snarkjs zkey export verificationkey gatekeeper_final.zkey` | — | — |

- Gatekeeper `vk_hash` registered on zkVerify mainnet:
  `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
- Groth16 / BN128, Circom 2.x. 13 circuit inputs, 13 public signals
  (see `../NOTES.md` / `../../NOTES.md` for the recovered input list and
  the semantics verified against the circuit itself).
