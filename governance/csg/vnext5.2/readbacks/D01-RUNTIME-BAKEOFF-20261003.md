# VNEXT5.2 D01 — bounded runtime bakeoff

**Observed:** 2026-10-03 (Asia/Taipei)  
**Outcome:** `BOUNDED_FALLBACK_SELECTED`  
**Evidence level:** static official-document review + static donor-source review  
**Canonical selection / Host / Production effects:** none

## Decision

Keep the existing minimal Supervisor donor as the source-only construction baseline while D02 prerequisites are built. It may inform local read/reconcile work; this decision does not qualify it as an executable runtime, install it, enable dispatch, or authorize canonical writes. Git/CSG remains the sole Mission/Policy/checkpoint authority.

Neither runtime challenger is selected for deployment. The bounded comparison found useful documented primitives, but did not execute either runtime against the failure corpus. Therefore no reboot, crash, external-effect, recovery, isolation, throughput, or whole-layer deletion result is claimed. This meets D01's scorecard-plus-bounded-fallback outcome; it is not D02/D03/D04 acceptance.

## Frozen comparison inputs

- B00 cold-start baseline: CP200; canonical control head `d39486601d851e31256852a24e9c1393b9046fe5`. B00 is the authority snapshot, not runtime test evidence.
- Minimal donor: 21 inventoried files under `tools/csg/v51-supervisor/`; source inventory hashes were checked. The donor README says it is not installed. The package `bin/host-supervisor.mjs` entrypoint, packaged `runtime/node.exe`, and real dispatcher are absent.
- Failure corpus: 20 statically read any-state scenarios in `tests/any-state-regression.test.mjs`: clean idle; Builder running; Reviewer running; expired owner lease; Agent UI closed; GPT Web unavailable; Supervisor restart; Windows reboot; VM reboot; external wait; provider 429; Muse 403; unknown side effect; orphan present; stale wake; Mission update while worker is old; Policy update while worker is old; already-PASS deterministic test; provider readback unavailable; integration conflict.
- The adjacent scheduler/reconcile source tests also describe logical-work fingerprint stability, bounded concurrency, one owner per mutable slice, one project integration lane, canonical reread order, unknown-effect parking, exact-identity readback, bounded retry only after confirmed `NOT_APPLIED`, and fail-closed Host/Production/provider-write gates. These were read statically for this D01 decision; they were not run as part of the bakeoff.

## Scorecard

| Criterion | Restate 1.7.13 | DBOS TypeScript | Minimal Supervisor donor |
|---|---|---|---|
| Runtime identity | Official release pinned by the handoff spec. Workflow IDs and Virtual Object keys offer a close fit for durable work and per-key serialization. | Official release page showed v5.2; npm versions showed v5.2.3-preview and stable v5.1.10 at review time. No package version was selected or installed. | Existing source candidate; no executable package identity or entrypoint. |
| Durable work / wait | Workflow journal, durable promises/signals and timers are documented. No app-level mapping was executed. | Workflows and steps checkpoint to a PostgreSQL system database; durable sleep is documented. Signal/callback fit was not demonstrated. | Source parks unavailable lanes and reconciles on wake; no persistent runtime wake service was tested. |
| Slice writer / integration lane | Virtual Object provides a documented single writer per key; `project_id` keying and exact slice contract still need a spike. | Queues and concurrency controls are documented, but the donor's per-slice and per-project writer invariants still need explicit adapter logic and proof. | Scheduler source encodes mutable-slice ownership, capacity and one integration lane; no dispatcher is packaged. |
| Crash / reboot | Durable journaling is a capability, not evidence for this deployment's service startup, journal persistence, backup or restore. Not tested. | Checkpoint recovery is documented, but adds PostgreSQL persistence and its backup/restore lifecycle. Not tested. | README explicitly says local source regressions do not prove crash, reboot or 24x7 survival. Not installed or tested. |
| Unknown external effect | Workflow replay cannot alone prove an arbitrary Git/Google/Host effect absent or exactly once. Keep provider idempotency/CAS and exact readback. | A completed step checkpoint cannot alone prove an external provider effect's final state. Keep the same provider fence and readback. | Source parks unknown effects and disallows blind retry; retain this behavior whichever runtime is later selected. |
| Quota / cron / multi-project | Official material documents flow-control primitives and cron. Provider quota mapping and tenant isolation are unverified. | Queues and scheduled workflows are documented. Provider-specific quota mapping and project isolation are unverified. | Provider cap is input to the source scheduler; cron/boot registration remains a separate unaccepted Windows task profile. |
| Additional durable infrastructure | Adds a long-running Restate service and a persistent journal lifecycle to package, monitor, upgrade, back up and restore. Exact topology not selected. | Requires a PostgreSQL system database. No accepted PostgreSQL control dependency exists in this construction baseline. | Lowest new infrastructure, but source is incomplete and retains custom scheduler/recovery logic. |
| License / platform | Restate v1.7.13 is BSL 1.1 with an Additional Use Grant and a prohibition on a public Restate platform service. No legal qualification or deployment approval is recorded. | DBOS TypeScript repository declares MIT. PostgreSQL remains an additional operational dependency. | Existing source fallback; Windows package/Task Scheduler installation and security acceptance are still separate gates. |
| Net custom production LOC removed | Not measured. No source was replaced, so claimed deletion is zero. | Not measured. No source was replaced, so claimed deletion is zero. | Zero; this route keeps the donor logic. |

**Comparison result:** Restate has the closest documented whole-layer fit; DBOS offers a lighter library interface but requires PostgreSQL; the donor is the lowest-change construction fallback but is not executable or accepted. Because D01's promotion bar requires measured net deletion, no second authority, corpus non-regression, and actual crash/reboot recovery, none is promoted by this static comparison.

## Responsibility delete map

| Donor responsibility | D01 disposition | Replacement condition |
|---|---|---|
| `lib/scheduler.mjs`: READY choice, bounded capacity, mutable-slice and integration-lane serialization | Keep; no deletion in D01 | A single selected runtime must pass the frozen corpus and show positive net LOC removal. A Restate Virtual Object is a candidate for per-key serialization; other runtime glue remains measured. |
| `lib/fleet.mjs`: owner/liveness and slice aggregation | Keep as source evidence/adapter for now | Replace only the scheduling mechanism demonstrated redundant by the chosen runtime; keep exact owner and scope evidence. |
| `lib/fingerprint.mjs`: logical work identity and anti-loop binding | Keep | Not replaced by workflow IDs. Continue binding canonical prestate, contract and exogenous inputs. |
| `lib/reconcile.mjs`: Directory → pointer → checkpoint/Mission/Policy/run/attempt/owner/effect rereads; stale wake rejection; exact effect readback | Keep | Runtime must call this reconciler. It cannot become canonical authority or infer absence from a failed read. |
| `lib/evidence-contract.mjs`, `lib/evidence-ledger.mjs` | Keep | Runtime journal does not replace CSG-shaped evidence or provider readback receipts. |
| `lib/github-readonly.mjs` | Keep | Not an orchestration responsibility; retain the narrow read-only adapter. |
| `lib/windows-task-profile.mjs`, `windows/register-supervisor-task.ps1`, `windows/remove-supervisor-task.ps1` | Keep uninstalled and unmodified | OS identity, ACL, registration, rollback and boot acceptance need their own exact Host gate. |
| custom timers, retry/backoff, scheduled wake bookkeeping, wait/signal bookkeeping | Potential deletion candidates only | First demonstrate the same behavior and failure corpus in one runtime; retain provider effect fences and bounded retry rules. |

## Scope and next legal work

- No challenger code was installed or run; no PostgreSQL server was created; no service, Windows task, Host component, or live canary was changed.
- No custom source was deleted. No permanent dual orchestrator is proposed.
- Restate deployment/legal scope remains unqualified; DBOS package/runtime pin remains unresolved for a real spike; the donor package is incomplete.
- D02 remains gated on D01 plus F01's actual isolated-agent route. Any later D02 work is candidate-source plus non-dispatching shadow only. Reboot, live survival, Host install, Production, new paid service, identity/OAuth/MFA and major trust expansion remain Human gates as specified.

## Source references

- [Restate v1.7.13 release](https://github.com/restatedev/restate/releases/tag/v1.7.13)
- [Restate service and workflow semantics](https://docs.restate.dev/foundations/services)
- [Restate v1.7.13 license](https://github.com/restatedev/restate/blob/v1.7.13/LICENSE)
- [DBOS TypeScript releases](https://github.com/dbos-inc/dbos-transact-ts/releases)
- [DBOS TypeScript npm versions](https://www.npmjs.com/package/@dbos-inc/dbos-sdk?activeTab=versions)
- [DBOS TypeScript programming guide](https://docs.dbos.dev/typescript/programming-guide)
- [DBOS durable sleep/workflow guide](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)
- [DBOS TypeScript license](https://github.com/dbos-inc/dbos-transact-ts/blob/main/LICENSE)

