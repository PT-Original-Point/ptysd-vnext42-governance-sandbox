# CODEX EXECUTE DIRECTIVE — VNEXT5.0 R4 AUTONOMOUS CONTINUATION

PROJECT_ID=CHATGPT_GLOBAL_SKILL_GOVERNANCE
HUMAN_DIRECTIVE_DATE=2026-09-28
MISSION_CHANGE=NO
PRODUCTION_FINAL_AUTHORIZATION=NO
PAID_FALLBACK=NO
PREPRODUCTION_AUTONOMOUS_CONTINUATION=AUTHORIZED
HUMAN_RELAY_REQUIRED=false

Operate as an execution loop, not a reporting loop.

## EXECUTION DECISION — DO NOT ASK THE HUMAN

DECISION=EXECUTE_NOW
REVIEW_FIRST=NO
CLARIFICATION_REQUIRED=NO
HUMAN_CONTINUE_REQUIRED=NO

The question “start execution or review first?” is already decided by the Human directive: **start execution now**.
Do not stop to ask this question again. Review is performed only as an internal bounded step when required by the exact atomic acceptance; it is not a separate Human choice and must not become a liveness dependency.

Current provider execution anchors at 2026-09-28:
- PR #316 current R4 head: c6a48d8ba7ce588101f22603bfb9838091c02edd
- R4-01 exact implementation commit: a83b7b973faa6e02f2d53c53d12f4c8567709a55
- R4-01 protected structural verifier: PASS, run 36378250626, job 108788401851
- R4-01 live Host deployment/readback: NOT YET COMPLETE
- R4-08 trust-plane candidate: PREPARED NONCANONICAL at current R4 head

Immediate action on wake:
1. fresh-read Directory -> CP192 -> PR #316;
2. consume the exact R4-01 live-deploy request from Issue #310;
3. perform the bounded local R4-01 live qualification if the local executor is available;
4. if that lane is externally unavailable, immediately continue the next READY independent R4 unit instead of asking the Human or emitting a status-only response;
5. after every material delta, read back provider/runtime state and continue automatically.

## Bootstrap authority

Every start:
1. exact Project Directory;
2. active_run_ref -> canonical control;
3. checkpoint/run;
4. Current Mission/Execution Policy;
5. provider/accepted-source readback;
6. Factory same-source status when available.

Chat history, Memory, local notes and old prompt snapshots are not current authority.

## Immediate assignment

Read the exact provider versions of:
- docs/VNEXT5.0-R4-AUTONOMOUS-DEADLOCK-AUDIT-20260928.md
- docs/VNEXT5.0-R4-SILKY-AUTONOMOUS-CONTINUATION-CONSTRUCTION-SPEC-20260928.md

Then continue the current Mission without asking the Human to say continue for normal pre-Production work.

Priority:
R4-01 Factory MCP non-circular host transport repair
→ R4-02 local bootstrap/readback
→ R4-03 orphan reconciliation
→ R4-04 Host-owned autonomy supervisor
→ R4-05/R4-06 scheduler + anti-loop
→ R4-08 CI trust-plane hardening
→ R4-09/R4-11 recovery campaign
→ remaining P0-09 and normal V5.0 R3 work.

## Anti-stall contract

- WAITING_EXTERNAL yields the executor slot.
- A pending review does not stop independent lawful work.
- Do not repeat the same request on the same durable fingerprint.
- No evidence delta => no new snapshot/status-only iteration.
- After every material result, fresh-read and automatically execute the highest-priority READY action.
- A PR, handoff, verifier result, or progress report is not completion.
- Do not require Human relay or periodic wake-up.

## Review contract

For reversible pre-Production work, deterministic tests, trusted structural verification and same-source readback are blocking evidence. External AI semantic review is asynchronous advisory/batch audit and must not be a liveness dependency.

## Safety boundaries that remain

Never autonomously:
- approve Production final;
- add paid fallback/new cost;
- make legal/contract/signature/identity decisions;
- perform Human OAuth/MFA;
- make a major irreversible authority expansion beyond this R4 scope;
- blind-retry UNKNOWN side effects;
- force-reset/push canonical history;
- expose secrets.

Everything else already inside the Current Mission should continue with exact prestate, bounded change, readback and rollback.

## Terminal rule

Do not terminate solely with WAITING_PROVIDER or a progress report.
Stop only at Mission acceptance, a genuine Human-reserved gate, or a proven all-lanes externally unavailable condition with an exact durable re-entry trigger.
