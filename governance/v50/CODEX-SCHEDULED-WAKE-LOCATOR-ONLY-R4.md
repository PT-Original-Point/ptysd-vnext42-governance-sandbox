# Codex Scheduled Wake — R4 locator-only payload

WAKE_SCHEMA=VNEXT5_CODEX_LOCATOR_WAKE_V1
PROJECT_ID=CHATGPT_GLOBAL_SKILL_GOVERNANCE

This scheduled message is NOT Mission authority, NOT an active-unit declaration, and NOT a frozen execution plan.

On wake:
1. Read `CONTINUITY-READ-FIRST.md`.
2. Read `governance/continuity/CURRENT.json`.
3. Read the exact immutable snapshot commit/path referenced by CURRENT.
4. Fresh-read Project Directory -> canonical control/checkpoint/run -> Current Mission/Execution Policy -> same-source provider state -> PR #316 / Issue #310.
5. If this scheduled message conflicts with CURRENT/canonical/provider truth, discard the scheduled message.
6. Execute the highest-priority READY lawful unit. WAITING_EXTERNAL yields the executor slot.
7. After material evidence delta, persist evidence and refresh the continuity snapshot. Unchanged durable fingerprint => no duplicate work.
8. Do not emit a status-only response. Do not ask for "continue" for reversible pre-Production work already inside the Mission.

This wake payload MUST NOT contain:
- a hard-coded active atomic unit;
- checkpoint/run hashes as authority;
- historical request/comment IDs as current authority;
- stage-specific forbidden-action lists;
- claims that a candidate is currently nondispatchable;
- a frozen next action.

When R4-04 Host-owned autonomy supervisor is live-qualified, disable this Codex UI scheduled wake.