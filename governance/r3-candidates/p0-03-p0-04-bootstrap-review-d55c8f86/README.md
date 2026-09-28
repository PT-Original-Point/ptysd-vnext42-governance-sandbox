# VNEXT5.0 R3 P0-03/P0-04 Bootstrap Sequencing Candidate

**Classification:** `LOCAL_NONCANONICAL_DESIGN_CANDIDATE`  
**Status:** `PREPARATION_ONLY_NOT_DISPATCHABLE`

This package captures a bounded proposal for enabling the already-present Factory MCP orphan identity observer, then obtaining a read-only identity readback. It changes no repository ref, Mission, Policy, capability, checkpoint, receipt, broker, Host, or Production state. It creates no permit or execution fence and contains no Host script.

## Fresh canonical binding

- Project Directory ref `governance/project-directory`, commit `38f4fc7cb2841e2318a97ff7a53e41b2ec07aef1`; project record `directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json`, blob `377dcf88279d3ba433d099a7cc9f78af8c86b8ae`, revision 5.
- The record's `active_run_ref` is `csg.active-run-ref.v1`, binding generation 2, resolving through `CURRENT_CANONICAL_CONTROL_POINTER_V1` to `v45/factory-control:governance/csg/current.json`.
- Control ref `v45/factory-control` is at `3fe64c651dd97fff75a74c668dc81f3fa2626c8f`; current-pointer blob `4ad01cbc6663294590d947e123eb50ba736ffb2f` selects checkpoint 191, blob `6720cea9c8a76a077d81c28fc62da34b0316e5f1`, payload digest `sha256:0e177814d7693e3fbc6a573979f3599e035cf31b920f0d08e81b1b30427cfa9f`.
- CP191 references run `V50-R3-001`, immutable revision `1ad3e192941ed3db63a2c605c8c2a72251d4523e`, blob `96807d7a5754fd3a28ad695dfc8963b11e21b5e2`, digest `sha256:b8d7797025dfff31bed9613125899999b0677339851edb4bf3741a2588e23c99`, attempt `V50-R3-P0-01-ATTEMPT-001`, epoch 1.
- CP191 has `atomic.execution_fence=null`, no `authorization_mode.envelope_ref.digest`, no active jobs, and no unresolved-effect refs. It still lists P0-02 publication/readback as a blocker and next legal transition. This package does not advance that canonical state.
- Mission anchor: `20260926T220900+0800`, hash `sha256:3cd12c504e42247f52b2f8200ee590a7d1e6e1f0e58c15063cb9551ebf9a38a5`. Policy anchor: `20260926T220900+0800-EP72`, hash `sha256:ce3abb44889a495d9a228e9117a22cc741807e033049a51346762110e7609cd2`.

## Source and verifier boundary

PR #308 is closed/merged; exact head `6e8bd3aa0918fbf1a038d559c64eb6db3beeeee4`, tree `01d3db213d35357d6f6ee751769b08979ddaa434`, parent `8894cf133191e053dabc61ac9c35030c1a18d3df`, merge commit `a041043904cbef41e83b0209221aabe0b0ee3d91`. Current `v49/accepted-source` is `7784663cca65dc7b0aa96c599db3224ad8317817`, tree `a540d81e695521f026fd49025b6ca2c2d546dfdc`.

The three runtime observer inputs currently present at that exact accepted-source commit are:

| Runtime artifact | Git blob OID |
| --- | --- |
| `tools/csg/factory-mcp/broker/hostguard-broker.ps1` | `0c40dd6d87bce25f841dd5772d930d8cc5284b52` |
| `tools/csg/factory-mcp/src/index.mjs` | `42dafd04d50ea260ad8a6cc0ef86fd7454ea92cf` |
| `tools/csg/factory-mcp/src/orphan-status.mjs` | `1e1067bf6617bf4a94018460bc916d7862c430fc` |

The exact-head semantic review comment `5856740789` is recorded as PASS. The exact PR #308 head has **zero** check-runs, zero PR-triggered workflow runs, and zero combined statuses in the fresh provider read. The `csg-trusted-verifier` PASS on PR #309 was bound to the mirror head and does not transfer to PR #308. Therefore source bytes are present in `accepted-source`, but exact-head protected structural qualification for Host deployment is **not established**.

The last same-source Factory response is comment `5856944590`: it reported aggregate orphan count 5 but no per-record identity surface; its bounded Host route probe returned `SYSTEM_FENCE_CURRENT_FENCE_MISSING`. It is evidence of the earlier readback, not a fresh Host read in this package run. This Codex task has no direct Factory MCP tool, so no current Host state or individual classification is claimed.

## Exact bootstrap blockers

1. CP191 has no execution fence and no current authorization-envelope digest; current `host_powershell` must fail closed.
2. The repository system-capability config at accepted-source blob `6cbc824c700c87c66d2be628f0d304d1f2cd8f8f` binds Mission revision `20260919T010100+0800`, hash `sha256:58f21a0818bd60b61929925b38ea8507d5b80c09d816a7b6f5a75d2a410d542b`, and capability generation 4. These do not match CP191's Mission revision/hash. This is repository evidence, not proof of the runtime-loaded capability.
3. The exact PR #308 head lacks the protected structural verifier result required for deployment.
4. The exact Host install root, service identity, existing observer version, fixed deployment/readback script bytes, script SHA-256, rollback target, and single-use replay receipt mechanism are not established by current evidence. No values are invented here.
5. The observer exposes bounded orphan receipt identity/metadata only. It does not establish `CURRENT_TARGET_STATE` or historical execution outcome. Those must remain separate; aggregate counts, `ORPHANED`, or `UNKNOWN_AFTER_BROKER_RESTART` alone classify no record beyond `UNKNOWN`.

## Proposed sequence (design only)

1. Re-read Directory, pointer, CP/run, Mission/Policy, accepted-source head/tree and exact source blobs. If any binding moved, rebuild the package and stop this sequence.
2. Establish a protected verifier result bound to the exact source head/tree; semantic review alone or a mirror result is insufficient.
3. Obtain a governance-issued, non-expanding one-time authorization envelope bound to the current Mission/EP72, project/repository, attempt/epoch, exact accepted-source tree and three runtime blob OIDs, concrete Host install target, exact fixed script digest, timeout, expiry, and rollback/readback plan. Do not fabricate its digest, generation, operation ID, target path, or script hash.
4. Reconcile the repository/runtime capability binding through an existing authorized route and same-source readback. A future capability must match the current Mission and authorization-envelope digest; it must keep the four public tools and provider/Production/business/paid restrictions unchanged.
5. Only after separate canonical Gate approval, build one current fence using the existing `HOST_POWERSHELL` validation contract. Immediately before one dispatch, recheck STOP/revoke, current control/pointer/checkpoint, attempt, expiry, source bytes and single-use operation identity. Any drift denies dispatch.
6. A future fixed script may stage and atomically install only the three listed runtime files, preserving exact backups for rollback; it may not accept a caller script/body or extra paths. It must not read secrets, print local paths, reconcile or mutate receipts, kill processes, retry, or redispatch. Host target path/service details remain unresolved, so no script is included.
7. After any separately authorized deployment, use the existing read-only `factory_status` route for same-source readback. Compare source/health and receipt hashes before/after. A changed or ambiguous receipt is `UNKNOWN`; read back before any response, never retry blindly.
8. Classify each orphan only from a complete exact-identity join of its receipt, historical execution result, and current target-state evidence. If any component is unavailable or mismatched, emit `UNKNOWN`.

No step above is an authorization or dispatch request. In particular this package does not create CP192/JIT, publish a canonical ref, execute `host_powershell`, deploy Host bytes, or write receipts.

## Qualification boundary

The companion Node tests validate only this package's non-dispatching declarations and deny conditions. They do not execute Host code, establish protected verifier qualification, prove provider enforcement, or classify any orphan. A passing local test result must never be reported as semantic acceptance, canonical acceptance, or Host readiness.
