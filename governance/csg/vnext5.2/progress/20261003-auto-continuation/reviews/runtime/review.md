# Independent exact-head runtime semantic review

Review invocation: `/root/v52_runtime_exact_review`. Producer and reviewer are separate agent invocations. This is a source semantic review, not live installation, protected verifier, system acceptance, or Production authority.

## Exact target

- Repository: PT-Original-Point/ptysd-vnext42-governance-sandbox
- PR386: c2bfa038121782a3ae903591981a0b05f52a7b38
- Tree: a25630fac30e3c474c797c2dbf9a5a4ddff05ce0
- Direct parent / provider base: 06da5fa224b65b9346e8b250dcea686d0ed458ee
- Fresh GitHub provider read: 2026-10-03T10:47:35.872Z; OPEN, Draft, one commit, exact head/base matched.
- Frozen read worktree: VNEXT5.2-RUNTIME-FROZEN-READ-WORK-20261003. Git status clean before and after review.
- Verdict: **FINDINGS**. Five P1 issues reproduced using current frozen source and synthetic ports. No actual Host or task dispatch, install, revoke, canonical mutation, or provider write occurred.

## P1 findings

### R386-01 — Scheduled-task action cannot start the supplied executable

`windows/supervisor-task-profile.json:17` supplies `--project-id ... --locator ...`. `bin/host-supervisor.mjs:16` accepts only `--shadow-once`, `--inspect-journal`, and `--help`. Calling the actual exported CLI main with the exact profile arguments throws `D02_ARGUMENTS_INVALID`. Registering this profile would repeatedly launch an invalid executable invocation under its restart-on-failure settings.

Correction: provide a real bounded Supervisor entrypoint/mode with its state/ports, or explicitly make the profile non-installable until the matching entrypoint exists. Add a profile-to-real-CLI compatibility regression; object-shape validation alone is insufficient. Source correction can proceed now; registering/running the task remains a separate Host acceptance operation.

### R386-02 — False global exhaustion despite an active or executable lane

`lib/operation-planner.mjs:221` computes global exhaustion using only the count of `READY` states. The actual scheduler supports `KEEP_RUNNING` and `RETRY_BOUNDED`. With the unchanged full 59-unit catalog and fresh complete facts, the review reproduced:

| State | Actual planned decision | Incorrect global decision |
|---|---|---|
| B00 RUNNING, valid owner | KEEP_RUNNING | GLOBAL_EXHAUSTED |
| B00 FAILED_RETRYABLE, exact authorized retry | RETRY_BOUNDED | GLOBAL_EXHAUSTED |

Correction: derive global continuation/exhaustion from valid active work, safe bounded retries, READY units, invariant violations, and catalog completeness together. `GLOBAL_EXHAUSTED` must not permit coordinator termination while any active or safely executable lane remains. Preserve subset scoping and pending gate distinctions.

### R386-03 — Authorized provider reads can never become READY

`lib/operation-planner.mjs:179` rejects every effect class outside local effects and CANDIDATE_PUBLISH. `A01.LIVE_READ` is `PROVIDER_READ`; even after accepted dependencies, AUTHORIZED facts, fresh target prestate, and a supplied verified route proof, its state remains `WAITING_EXTERNAL / EXACT_EFFECT_AUTHORITY_REQUIRED:PROVIDER_READ`. No branch consumes such a proof, so rebuilding facts cannot resolve this gate. The same pattern prevents future nonlocal operation qualification.

Correction: keep exact target, read-only scope, caller/credential custody, freshness, and bounded usage requirements, but consume an explicit verified effect qualification record so the exact already-authorized read operation can become READY. Missing MCP should park only the consumer route; a qualified native read route must remain available. Do not require a fresh canonical execution owner or repeated Human approval for native source/read construction.

### R386-04 — F01 accepts stale provider task receipts

`lib/f01-executor-adapter.mjs:116` only checks that `receipt.observed_at` parses as a date. `readVerified` at line194 does not receive the freshness policy or a before/after dispatch observation boundary. A signed/authenticated old receipt can therefore satisfy the adapter checks. The review supplied receipts dated 2000-01-01 while the fresh route clock was 2026-10-03: the pre-start NOT_FOUND was accepted, the synthetic start counter incremented, and the old RUNNING post-read returned `PROVIDER_READBACK_CONFIRMED`.

Correction: require current trusted provider readback freshness and an observation/revision bound appropriate to pre-start, post-start and cancellation; pass these requirements to the receipt verifier. An authenticated digest establishes identity/integrity, not freshness. Preserve provider idempotency/CAS and readback-first handling of unknown effects. Regress stale/future/pre-dispatch post-read receipts and stale CANCELLED/capacity receipts before qualifying a real route.

### R386-05 — Canonical version is still hardcoded, perpetuating cross-Session drift

`lib/shadow-runtime.mjs:194` reports `spec:'VNEXT5.1-R2'` regardless of fresh canonical authority. `lib/reconcile.mjs` does not propagate observed canonical spec into the returned authority. A summary fed authority for VNEXT5.2 / CP201 still reports VNEXT5.1-R2 / CP201. This can recreate the user's reported obsolete-version display after actual canonical promotion.

Correction: bind the canonical spec/revision to the verified checkpoint/Mission payload, or report UNKNOWN if the authoritative schema has no usable field. Keep construction, canonical and installed *roles* separate, but do not forbid their versions from legitimately becoming equal. Installed UNKNOWN is currently honest for the explicitly unobserved shadow; add actual installed observation only through a separately qualified read route, never infer it from source PASS.

## P2 follow-up — enforce one writer per journal

`lib/shadow-journal.mjs:313-338` reads sequence/tail, appends, and verifies after writing, without a process lock or expected-tail CAS. Two native Sessions targeting the same state directory can both compute the same next sequence and permanently corrupt the chain. The Task Scheduler IgnoreNew policy does not cover independent CLI Sessions. This is a static concurrency finding; no concurrent mutation experiment was run. Use one-writer coordination or a mature transaction store, and require an actual simultaneous-writer regression before claiming cross-Session durable ownership. Preserve existing V1/V2 bytes.

## Verified strengths and scope limits

- Exact 59-union identity is protected by content digest, fixed parent bytes, ID uniqueness, dependency resolution, and start/completion DAG checks in `loadUnionCatalog`; a 59-count alone is insufficient.
- Missing/unknown per-unit facts park that lane and dependent lanes while independent READY source work remains visible. Shared identity/digest/freshness corruption stays fail closed.
- Raw DONE cannot bypass unaccepted transitive completion dependencies.
- Shadow has no dispatcher port, makes live probe status explicitly unavailable, and records all Host/canonical/local dispatch effects false. This is genuine shadow behavior and must remain distinct from real execution.
- F01 verifies exact task/route/sandbox identities through external verification ports, and does not release capacity until a verified CANCELLED receipt says capacity_released=true. Route implementation, sandbox proof, and live cancel/receipt remain pending.
- Local source construction uses LOCAL_PREPRODUCTION_WORKTREE; PRODUCT_CODING requires qualified Hyper-V Ubuntu isolation. Git worktree separation does not prove OS sandboxing.
- Journal restore verifies UTF-8, complete lines, sequence, digest chain, and projections. V1 preservation/V2 continuation and process-exit restore are covered by existing local tests. This does not prove power-loss/reboot/UI-closed/24x7 continuity.
- The actual CLI is currently one-shot shadow/inspection only; `runSupervisor` exists as a library with injected ports, not a connected production worker service. Do not classify this PR as a deployed autonomous factory.
- No source files were changed by this independent review. Findings do not impose a global Human gate; all legal source corrections and native bounded read discovery may continue immediately.

## Durable evidence

`reproduce.mjs` and `reproduction-results.json` bind all five deterministic reproductions to the exact frozen head/tree. `review-receipt.json` records the provider binding, scope, findings, evidence digests, and continuation conditions. Any later source-byte change requires a new exact-head review; this verdict is not portable.
