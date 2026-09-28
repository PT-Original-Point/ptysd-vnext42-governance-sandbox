# Continuity Snapshot 20260928T0819Z-R4-WAKE-LOCATOR-HOTFIX

## Completed local liveness hotfix

The stale hourly Codex wake was replaced with the exact locator-only payload from `governance/v50/CODEX-SCHEDULED-WAKE-LOCATOR-ONLY-R4.md`, read at PR #316 head `4374160daea8c371a58b2885c17a21598cc44484` (blob `3658d9e1c7297c189d925f4665b84887e9c23dea`). The local decoded payload equals the fetched source text exactly.

- Automation: `vnext5-0-r3-p0-01-exact-head-review-continuation`
- Config after update SHA-256: `10f4e1d22a29fe5b79f08311c3c99c35beae4efcbc125958f5c36691fdf077c4`
- Pre-mutation backup SHA-256 / bytes: `a61d5dc549fa0cb02d16f382f476029cc9f4a69d9254e1626b532f25da653be0` / `3461`
- Active project wakes: `1`
- Cadence preserved: `FREQ=HOURLY;INTERVAL=1`
- Schema marker: `WAKE_SCHEMA=VNEXT5_CODEX_LOCATOR_WAKE_V1`
- Old active unit, request ID, and historical package digest absent; no hard-coded active unit.
- Keep the UI wake active until R4-04 Host-owned supervisor receives LIVE PASS.

## Current authority and gates

Project Directory revision 5 resolves through `v45/factory-control` to checkpoint 192, digest `sha256:fc0112e9203a8d9c8a43fa98f427f67c6e0b58aca09c6adcfa260ac6faa274f0`. Mission and EP72 remain the exact referenced revisions/hashes recorded in the JSON. Issue #310 is coordination only. R4 system acceptance remains `NOT_ACCEPTED`; all A01-A18 remain unproven.

PR #316 remains an open draft at exact head `4374160daea8c371a58b2885c17a21598cc44484`, tree `3ecbd6b74356be66ba4fd993f1749cd118dca0ca`. The exact head has no status checks or PR workflow runs, so there is no exact-head trusted-verifier PASS.

## Next ready work

Run the repaired R4-05/R4-06 tests from the exact repo root and discover Factory MCP runtime paths through read-only OS/provider objects. Prior 6/6 functional claim was invalidated and is not reused.

OP025 remains UNKNOWN and must never be redispatched. No Host/canonical/CP192/JIT/operation027/Production/paid/business action is authorized by this projection.
