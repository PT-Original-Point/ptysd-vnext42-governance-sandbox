# V49-12 Codex Last-Mile Dispatch Contract

Status: PREPARED_NOT_AUTHORIZED

This file does not grant Codex authority. Dispatch is legal only after the human explicitly opts in to this exact V49-12 scope in the current Chat session.

## Exact scope

Project: `CHATGPT_GLOBAL_SKILL_GOVERNANCE`  
Run: `V49-CLOSURE-001`  
Unit: `V49-12`  
Canary baseline: `141baaebb30e4e4b43a3237b8e352822bbd54b10` / tree `de291ba0d7d6c6d09357471bd18653b0747a2a8a`  
Only worker-owned file: `fixtures/v49-live-n1/src/slugify.mjs`  
Durable WIP ref: `refs/heads/v49-12-real-builder-wip-20260919`  
Protected verifier base: `refs/heads/v49/accepted-source`

## Mandatory preflight

1. Read canonical `governance/csg/current.json`; it must be checkpoint 62 and `barrier=WAITING_HUMAN`.
2. Confirm current human message explicitly authorizes Codex for this exact last-mile scope.
3. Read `refs/heads/v49/accepted-source`; expected source includes the V49-12 protected candidate verifier.
4. Read Factory MCP status; exact VM must be `PTYSD-WORKER-01`, Running, SSH reachable.
5. Reissue the exact capability fence if the prior fence has expired. Do not widen paths, data class, provider calls, network mode, model, or authority.
6. Use only the existing restricted automation bridge. Do not reuse `C:\Users\x\.ssh\ptysd_worker_ed25519` as the automation key. Do not change SSH-key ACLs, authorized_keys policy, listener topology, or credentials.
7. Run `v49-n1-preflight`. Require fresh model catalog status active and zero-cost guard PASS. Paid fallback is forbidden.
8. Only after preflight PASS, run `v49-n1-build` once.

## Builder acceptance

The worker must use `opencode/muse-spark-1.3-contributor-free`, produce a real edit, and report observed run cost zero. The protected test/package must not change. The worker may not possess GitHub/provider write credentials.

Expected worker output includes:

- `FINAL_TEST=PASS_4_OF_4`
- `OBSERVED_RUN_COST=PASS:...`
- `CANDIDATE_SHA256=...`
- `CANDIDATE_BYTES=...`
- `CANDIDATE_BASE64=...`

If the worker result is unknown after dispatch, read back first with `v49-n1-readback`; do not blind-retry.

## Controller publication

1. Decode candidate bytes outside the worker.
2. Verify candidate SHA-256/size exactly match worker output.
3. Create exactly one commit whose parent is `141baaebb30e4e4b43a3237b8e352822bbd54b10` and whose only changed path is `fixtures/v49-live-n1/src/slugify.mjs`.
4. Advance only `refs/heads/v49-12-real-builder-wip-20260919` non-force to that candidate commit.
5. Same-source read back the branch commit/tree.
6. Open a PR from `v49-12-real-builder-wip-20260919` to `v49/accepted-source`. Do not merge it in V49-12.
7. Require the controller-owned workflow `V49-12 protected real-builder candidate verifier` to PASS. The candidate may not modify the verifier.
8. Record the PR number, workflow run/job IDs, candidate commit/tree, candidate SHA-256, protected test result, fresh zero-cost model evidence, observed run cost, and worker/provider-credential census in the V49-12 proof pack.

## Forbidden

Production; business projects; paid fallback; worker provider-write credentials; verifier/test/package/workflow mutation by the candidate; N2+; force push/update; cross-project mutation; credential/ACL/listener changes; mission/policy/verifier rewrite.

## Return schema

Return one JSON object with:

`status`, `model_id`, `fresh_zero_cost_guard`, `observed_run_cost`, `candidate_sha256`, `candidate_bytes`, `candidate_commit`, `candidate_tree`, `remote_wip_ref`, `pr_number`, `protected_verifier_run_id`, `protected_verifier_job_id`, `protected_tests`, `worker_provider_write_credentials`, `production_effect`, `paid_fallback_effect`, `blocker`.

Success status is exactly `V49_12_REAL_BUILDER_PASS`. Otherwise return a bounded blocker and do not self-promote to V49-13.
