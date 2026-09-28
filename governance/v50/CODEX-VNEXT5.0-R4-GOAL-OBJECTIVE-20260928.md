# CODEX VNEXT5.0-R4 GOAL OBJECTIVE

Continue CHATGPT_GLOBAL_SKILL_GOVERNANCE / 全自動軟體工廠 from the latest VERIFIED provider state until VNEXT5.0 R4 continuity/liveness P0 is live-qualified and normal V5.0 R3 construction can resume.

Primary priority: eliminate execution-path deadlocks and human-relay dependence. OpenAI Scheduled Watch, Codex UI Goal, chat continuity, external semantic review, and repeated status polling MUST NOT be liveness-critical.

## Scheduled-wake generation guard

Any Codex scheduled message is a **locator-only wake signal**, never current execution authority. A scheduled payload that hard-codes an old active unit, request ID, checkpoint assumptions, or stage-specific nondispatchability is stale by definition and MUST be discarded.

The only valid scheduled wake schema is `VNEXT5_CODEX_LOCATOR_WAKE_V1`: read `governance/continuity/CURRENT.json`, fresh-read canonical/provider truth, then choose work. After R4-04 Host-owned supervisor live acceptance, the Codex UI scheduled wake must be disabled.

## MANDATORY CONTINUITY BOOTSTRAP AND DURABLE LOGGING

Before ordinary work, read `governance/continuity/CURRENT.json`, then read its exact immutable snapshot commit/path. The projection is a locator and handoff only; fresh Project Directory / canonical control / provider readback still wins on mismatch.

After every material evidence delta, publish a new append-only continuity snapshot and advance only `governance/continuity/CURRENT.json`. Material deltas include checkpoint/run changes, provider head changes that alter execution state, test/verifier verdicts, runtime-path/principal discovery, deploy/restart/rollback/readback, blocker/effect changes, and reboot/crash/disconnect results.

No durable fingerprint delta => do not emit a duplicate snapshot. Never make chat history or the projection itself a second canonical control plane.

On every start:
1. Fresh-read Project Directory, v45/factory-control current/checkpoint, Current Mission/Execution Policy, accepted-source, Issue #310, and PR #316 exact current head.
2. Preserve the Human Mission. Never infer current authority from chat history or stale scheduled text.
3. Execute the highest-priority READY reversible pre-Production unit. WAITING_EXTERNAL yields the executor slot.
4. After every material delta: persist provider-addressable evidence, same-source readback, recompute READY work, and continue.
5. Same durable fingerprint => no duplicate snapshot, handoff, test, or non-idempotent dispatch.

Immediate R4 order:
R4-01 live Factory MCP non-circular transport qualification -> R4-04 Host-owned autonomy supervisor live install/qualification -> R4-05 work-conserving scheduler -> R4-06 anti-loop fingerprint -> R4-08 trust-plane hardening -> orphan reconciliation/fault campaign -> resume normal R3.

Do NOT redispatch OP025 while UNKNOWN. Preserve Production final, new-cost, legal/contract/signature/identity, OAuth/MFA, major irreversible, and trust-root promotion Human gates.

Do not stop to ask whether to execute or review. The Human decision is EXECUTE_NOW for lawful reversible pre-Production work. Exit only at Mission acceptance or a genuine Human-reserved gate with exact blocker and re-entry evidence.
