# VNEXT5.0-R4 — CODEX IMMEDIATE CONTINUATION PROMPT

EXECUTE NOW. Do not summarize first, do not ask whether to review, and do not wait for another AI response.

PROJECT_ID=CHATGPT_GLOBAL_SKILL_GOVERNANCE
MISSION_CHANGE=NO
PRODUCTION_FINAL_AUTHORIZATION=NO
PAID_FALLBACK=NO
HUMAN_RELAY_REQUIRED=false
CODEX_LOCAL_LAST_MILE_OPT_IN=YES_FOR_THIS_R4_PREPRODUCTION_SCOPE

## Fresh provider anchors
- Directory: governance/project-directory -> project record CHATGPT_GLOBAL_SKILL_GOVERNANCE
- Canonical control: v45/factory-control
- Canonical checkpoint: 192
- CP192 digest: sha256:fc0112e9203a8d9c8a43fa98f427f67c6e0b58aca09c6adcfa260ac6faa274f0
- Current Mission revision: 20260926T220900+0800
- Mission hash: sha256:3cd12c504e42247f52b2f8200ee590a7d1e6e1f0e58c15063cb9551ebf9a38a5
- Execution Policy revision: 20260926T220900+0800-EP72
- Policy hash: sha256:ce3abb44889a495d9a228e9117a22cc741807e033049a51346762110e7609cd2
- R4 PR: #316
- R4 current head at issuance: bf9f4dd27bc6d8f80378b991e6138e58a7264c7f
- R4-01 implementation commit: a83b7b973faa6e02f2d53c53d12f4c8567709a55
- R4-01 structural verifier: PASS; run 36378250626; job 108788401851
- R4-04 source/structural: PASS candidate at ca238f8c9478917102fd30d0590d669ce0accb24; verifier run 36381158935/job 108797020346
- R4-05/R4-06 source/functional/structural: PASS candidate at bf9f4dd27bc6d8f80378b991e6138e58a7264c7f; functional 6/6; verifier run 36381441459/job 108797852726
- Factory fresh status at issuance: DESKTOP-1B6PD2P / VM Running / SSH reachable / SYSTEM / tunnel live+ready / host_exec_lane IDLE_WITH_ORPHANS / orphan_count=5

IMPORTANT: the exact PR #316 head may advance after this prompt. Fresh-read it before mutation. Provider truth overrides the issuance snapshot above.

## ACTIVE ATOMIC UNIT
R4-01_FACTORY_MCP_NONCIRCULAR_HOST_TRANSPORT_LIVE_QUALIFICATION

## R4-01 exact execution
1. Fresh-read Directory -> CP192 -> Mission/Policy -> accepted-source -> Issue #310 -> PR #316.
2. Read exact R4-01 files from commit a83b7b973faa6e02f2d53c53d12f4c8567709a55.
3. Inspect the installed Factory MCP prestate on DESKTOP-1B6PD2P. Resolve actual install/service/task paths from the machine; do not guess.
4. Run syntax/regression checks on the exact R4-01 source bytes.
5. Create operation-owned backup of only files you will replace.
6. Deploy only the R4-01 runtime delta.
7. Restart only the broker/tunnel/service components necessary to load it.
8. Same-source readback installed bytes/process/task/tunnel state.
9. Run a harmless host_powershell SYSTEM canary. PASS requires:
   - no SYSTEM_FENCE_CURRENT_FENCE_MISSING bootstrap denial;
   - run_as=NT AUTHORITY\SYSTEM;
   - public Factory MCP tool surface remains exactly 4;
   - timeout/concurrency/receipt/orphan safeguards still work;
   - no Production/business/cost expansion.
10. If validation fails, rollback only your R4-01 changes, read back rollback, record evidence, then continue the next legal independent R4 unit if one exists.

Do NOT block R4-01 on CP192 having an execution fence: removing that circular transport prerequisite is the exact R4-01 purpose. Mission/safety authorization remains controller-level; the transport itself must not require future control state to upgrade itself.

## AFTER R4-01 PASS — DO NOT STOP
Immediately continue R4-04:
1. Consume source candidate ca238f8c9478917102fd30d0590d669ce0accb24 and current PR #316 head.
2. Inspect actual local Codex CLI location/auth environment and Windows principal requirements.
3. Install PTYSD-Autonomy-Supervisor-V50 as the Host-owned liveness client using the qualified candidate, with operation-owned backup and reversible uninstall.
4. Prove non-interactive `codex exec --json --full-auto` works without the Codex UI conversation being open.
5. Prove duplicate wake is finite, same fingerprint is a no-op, process crash is recoverable, and reboot/startup resumes the supervisor.
6. Disable/ignore OpenAI Scheduled Watch as a liveness dependency during the fault test. It may remain advisory only.
7. Same-source readback all task/process/state/log evidence.

Then integrate/qualify R4-05/R4-06 from bf9f4dd27bc6d8f80378b991e6138e58a7264c7f:
- WAITING_EXTERNAL must yield to READY;
- only one RUNNING unit may own the executor;
- same durable fingerprint must not repeat handoff/snapshot/test/non-idempotent dispatch;
- material provider delta must produce a new fingerprint.

Then continue R4-08 trust-plane hardening candidate and remaining R4 fault campaign without asking for another "continue".

## EXECUTION RULES
- One active atomic unit at a time.
- Reporting is not progress.
- A PR/comment/verifier request is not terminal completion.
- WAITING_EXTERNAL is lane-local, not Goal-global.
- Never set Goal BLOCKED while any lawful non-human READY/preparation/readback/test/repair action exists.
- Do not create repeated full-graph snapshots when provider fingerprint is unchanged.
- Do not resend the same handoff/comment merely because time passed.
- Unknown external effects: readback first; never blind retry.
- OP025 remains UNKNOWN and must not be redispatched.
- Do not mutate Production, business projects, paid services, trust-root canonical promotion, legal/identity/OAuth/MFA, or major irreversible scope without the reserved Human gate.
- Do not weaken verifier/tests/acceptance to make a candidate pass.
- Every shared mutation: fresh prestate -> exact bounded dispatch -> same-source readback -> evidence.

## STOP CONDITION
Stop only when:
A. VNEXT5.0 R4 live acceptance is complete and normal R3 continuation has resumed, or
B. the next action is genuinely Human-reserved by the Mission/policy and every other lawful non-human lane is exhausted.

If B occurs, output only the exact blocker, exact evidence, and exact re-entry condition. Do not enter an hourly/reporting/no-op loop.
