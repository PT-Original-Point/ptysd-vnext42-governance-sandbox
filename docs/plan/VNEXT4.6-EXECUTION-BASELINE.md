# VNEXT4.6 execution baseline

Status: human-approved construction specification baseline for `CHATGPT_GLOBAL_SKILL_GOVERNANCE`.

Human approval: `APPROVE_VNEXT46_FORMAL_ADOPTION` on 2026-09-14 (Asia/Taipei).

Approved source artifact: `VNEXT4.6.md`.

Approved source artifact SHA-256: `14b6c13038c53f027ea7f8316637fa4a212cfcdeea3721f3b6a75d14d51ef236`.

Full re-audit artifact SHA-256: `95755e751e83d321075d7ac536d671d41c0fdc677654a5e5f6b5503820c35f07`.

Final Promotion Review artifact SHA-256: `63b526a3bcbf83a4efda7fd23c97309b692d2ea0de14e72ea97c9675811a2a68`.

Architecture decision: `A_LEAN_BOUNDED_FACTORY`.

Runtime architecture identifier remains `GITHUB_ACTIONS_BOUNDED_V1`.

This approval adopts only the exact audited VNEXT4.6 construction specification baseline. It does not itself publish or rewrite Current Mission or Current Execution Policy, provision Project Directory, declare Z6 PASS, activate N=2, authorize Production, authorize paid fallback, grant business-project access, place provider-write credentials on workers, authorize blind Z6 redispatch, or authorize force history rewrite.

Preserved verified evidence and boundaries:
- Z3 / Z4 / Z5 existing PASS evidence remains valid unless a prerequisite is independently invalidated.
- Existing active run identity remains `V45-Z6-SAFETY-001`; continuation must fresh-read the same attempt before any dispatch.
- Active coding slots remain 1.
- `ProviderGuard` remains the sole normal shared/provider write path.
- control updates remain no-force and require same-source readback.
- Production final authorization remains human-reserved.
- zero incremental paid cost remains mandatory.

Known external gates at adoption time:
- Project Directory exact resolution/provision is not yet proven.
- Current Mission body and hash recomputation are not yet proven from canonical body.
- Current Policy body and hash recomputation are not yet proven from canonical body.
- Z6 executor liveness is not proven by the persisted `RUNNING` projection alone.
- GitHub rules/protection/private-control qualification is not yet proven.

The exact approved bytes are identified by the SHA-256 above. Any byte change to the construction specification requires a new audit/promotion decision before being treated as this baseline.
