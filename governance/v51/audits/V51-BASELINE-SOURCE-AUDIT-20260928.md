# VNEXT5.1 baseline source audit — 2026-09-28

## Scope and ownership

- Atomic unit: `V51-01-EXECUTION-OWNERSHIP-ANTI-DOUBLE-WRITER-CANDIDATE`
- Owner: CODEX, epoch 1, from the preserved local ownership record (SHA-256 `ff3e4fae72a4f4f1224c1ec825c358754d59e69e23ebbe8b8ce72de4b926d157`).
- Candidate branch: `codex/v51-execution-ownership-candidate`
- Exact base: `v49/accepted-source` `7784663cca65dc7b0aa96c599db3224ad8317817`; local tree `a540d81e695521f026fd49025b6ca2c2d546dfdc`; clean before this audit.
- Authorized path set:
  1. `governance/v51/audits/V51-BASELINE-SOURCE-AUDIT-20260928.md`
  2. `tools/csg/v51/execution-owner.mjs`
  3. `tools/csg/v51/tests/execution-owner.test.mjs`
- No `AGENTS.md` was present in the checkout. The accepted-source tree has no `tools/csg/v51` directory.
- No canonical ref, Mission, Policy, Host, broker, receipt, or Production state was changed.

## Fresh provider state

- Project Directory: revision 5, binding generation 2, control locator `refs/heads/v45/factory-control`.
- Canonical control: `v45/factory-control` `a5ebfd86d440b61ecc4e4dc3ba7b8291836769c7`, checkpoint 192.
- **Checkpoint/run identity is inconsistent:** CP192 names task/attempt `R3-P0-03-FACTORY-ORPHAN-RECONCILIATION / V50-R3-P0-03-ATTEMPT-001`; its referenced `runs/V50-R3-001/run.json` at `1ad3e192941ed3db63a2c605c8c2a72251d4523e` names `R3-P0-01-CANONICAL-CONTINUITY-REBASE / V50-R3-P0-01-ATTEMPT-001`. No canonical repair or dispatch was attempted.
- Mission remains `20260926T220900+0800`, hash `3cd12c504e42247f52b2f8200ee590a7d1e6e1f0e58c15063cb9551ebf9a38a5`; EP72 hash `ce3abb44889a495d9a228e9117a22cc741807e033049a51346762110e7609cd2`. Production, business-project, paid-fallback, and OP025 redispatch remain disallowed; OP025 remains UNKNOWN.
- PR #316 is open/draft at exact head `fe519d8060c62a404ab7960d6b681b790d2af547`, tree `2b8883f15272830c9ce45faa5e93c8b73e530071`, 45 changed paths, zero reviews, zero check-runs, and zero combined statuses. The most recent returned conversation comment is not bound to this head. No exact-head qualification is claimed.
- Continuity `CURRENT.json` at that head points to snapshot commit `cc20d5bd2214c5ec204db146ba9fbf7a5cb259f3`; it is a read-only R4 projection and yields to the canonical chain.

## Source findings at PR #316 head

1. `tools/csg/autonomy-supervisor/ptysd-autonomy-supervisor.ps1` defines a separate `Provider-Fingerprint`; it does not import the adjacent `scheduler.mjs` or `fingerprint.mjs`. Its fingerprint includes Directory, control, PR head, and last Issue comment only; it omits checkpoint, run, accepted-source, and Factory state. The code exits on same fingerprint plus `TURN_COMPLETED` before recomputing READY work.
2. The supervisor writes PowerShell Job `InstanceId` to `active_pid`, then casts it to integer for `Get-Process`. Its timeout uses `Stop-Job`/ `Remove-Job`; process-tree termination is not established.
3. `gh` lookup uses `Get-Command -CommandType Application`. `codex` lookup does not specify Application-only. On this local executor, no `gh` Application was found.
4. Current local Codex CLI is `codex-cli 0.158.0-alpha.2.1`. `codex exec --help` reports `--json`, `--approve-for-me`, `--sandbox`, `--cd`, and `--add-dir`; it does not report `--full-auto`. The current supervisor uses the supported `--json --approve-for-me` flags.
5. `register-autonomy-supervisor.ps1` defaults to `C:\ProgramData\PTYSD\AutonomySupervisor` and a fixed workspace. Those defaults are source assumptions, not live OS discovery.
6. On current `main` `1dcec5ea8124e4d1b69b53652c657df8b65eb3ef`, `.github/workflows/factory-bounded.yml` accepts caller-supplied `control_sha` for workflow-dispatch tests on the `PTYSD-V46-CONTROL-TRUSTED` self-hosted runner. The active trusted verifier lists individual forbidden workflow paths; it does not default-deny all of `.github/workflows/**`. PR #316's r4-08 files are candidates and do not change this active trust root.
7. The R4-08 candidate workflow uses ubuntu-24.04 for its candidate-controlled test job and keeps the self-hosted job for `pull_request_target` verification. This remains candidate source only and has no exact PR #316 head check-run.
8. The V51-01 candidate is isolated from those R4 findings. It defines a versioned ownership state machine and a provider CAS/write/readback adapter contract; it does not contain a persistent ownership store or a production provider adapter. The local race test uses a shared in-memory provider model and does not establish cross-session exclusion or system-level B19 acceptance. Production integration must bind the ownership record and source head to an authoritative provider CAS and same-source readback.

## Automation cleanup readback

The Codex App `codex-dev.db` was queried read-only again on 2026-09-29: `automations=0`, `automation_runs=0`, `inbox_items=0`; no matching automation definitions were returned. The Codex Home automation directory contains no `automation.toml`. Delete for the only observed legacy ID returned `not_found`; the automation tool view still returns only a rendered-card notice, so app-side exhaustive enumeration remains unverified. No duplicate delete/update was issued. Evidence is under `evidence/v51-00-codex-automation/`.

## V51-01 local candidate verification

- Runtime: Node.js v24.19.0.
- Exact command: node --test tools/csg/v51/tests/execution-owner.test.mjs.
- Candidate parent: PR328 head `d42736eb638ef93ebabab9e4e27fad0e1024c5bb`; this correction changes only the three authorized paths listed above.
- The scope digest now includes `atomicUnitId`, preventing identical path scopes for different units from sharing a token.
- `executeOwnedWrite` requires a provider CAS adapter, then validates a same-source readback bound to unit, owner, epoch, state, parent/result head, revision, scope, changed paths, and evidence digest before advancing the local record. Ambiguous adapter failures and readback mismatches are surfaced as unconfirmed effects; callers must read back before retrying.
- Result after the correction: 11 tests passed, 0 failed.
- Coverage includes exact scoped proposals, unit-bound scope digests, owner handoff epochs, stale revision/head rejection, readback-bound reclaim, strict schema rejection, concurrent stale proposals through a shared test adapter, post-write head advancement, readback mismatch handling, and unknown adapter failure without automatic replay.
- This is local noncanonical candidate evidence only. The adapter interface and in-memory race model do not establish a production provider adapter, durable ownership persistence, cross-session exclusion, canonical acceptance, or live supervisor qualification.

This audit is not an acceptance claim. It records the fresh source baseline and limits for the local V51-01 candidate.
