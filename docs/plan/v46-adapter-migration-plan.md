# VNEXT4.6 Project Directory Adapter Migration Plan

Status: WP46-02 candidate only. This document does not publish a Directory record, Mission, Policy, or ACTIVE project.

## Goal

Make the human-visible name `全自動軟體工廠` resolve exactly to `CHATGPT_GLOBAL_SKILL_GOVERNANCE` without relying on Win11-local discovery, recent files, chat history, Memory, fuzzy search, or another Project.

## Fixed identity

- project_id: `CHATGPT_GLOBAL_SKILL_GOVERNANCE`
- repository_id: `1352411536`
- runtime_type: `GITHUB_ACTIONS_BOUNDED`
- control_ref: `refs/heads/v45/factory-control`
- run_path: `runs/V45-Z6-SAFETY-001/run.json`
- stable locator: `github://1352411536/runs/V45-Z6-SAFETY-001?control_ref=refs/heads/v45/factory-control`
- resolved control SHA is a readback field and must never be embedded as self-authority in the stable locator.

## Migration sequence

1. Keep the current RDC wrapper read-only for `resolve`/`get`; no scan fallback is allowed.
2. Resolve Current Mission and Execution Policy canonical body refs; recompute hashes before publish.
3. Expose a transactional/CAS Directory write surface implementing RESERVED record plus unique exact-name binding.
4. Normalize names with Unicode NFKC, trim, collapsed Unicode whitespace, and Unicode casefold.
5. Publish only this Project as `RESERVED`; do not promote to `ACTIVE` in the same step.
6. Same-source exact-name readback must return exactly one binding to the same project_id.
7. `get_project(project_id)` must read back the same RESERVED record and stable provider-qualified run locator.
8. Prove Host-off resolution through the approved off-host provider path; the RDC wrapper becomes migration fallback only.
9. Only a later explicit promotion step may set `ACTIVE` after Mission/Policy refs and the run locator are independently valid.

## Fail-closed cases

Name collision, multiple identities, missing Mission/Policy body refs, stale/malformed locator, shadow record, self-hash cycle, write-surface unavailability, or readback mismatch all leave the Project `NOT_FOUND` or `RESERVED`; none may trigger fuzzy/recent fallback.

## Current blockers

The currently installed RDC adapter exposes only `resolve` and `get`, and both exact lookups still return `NOT_FOUND`. Current Mission and Policy revisions/hashes are present in GitHub control state, but canonical body refs are not yet available from the verified provider surface. Therefore WP46-02 may complete as a candidate design, while R1-G0/G3 remain NOT_PASSED until WP46-05B has a real transactional Directory write/readback path.
