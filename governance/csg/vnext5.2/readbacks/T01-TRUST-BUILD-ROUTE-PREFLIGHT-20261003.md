# VNEXT5.2 T01 — trust and build-route preflight

**Observed:** 2026-10-02 16:21:07 UTC / 2026-10-03 Asia/Taipei  
**Task status:** `PARTIAL_READBACK_TRUST_ROUTE_NOT_QUALIFIED`  
**Effect class:** read-only  
**Trust configuration, workflow dispatch, artifact signing, Host, and Production effects:** none

## Finding

Repository visibility and selected workflow source are observable, but the exact organization runner-group restrictions and artifact-attestation route are not. The caller has repository-level admin access on both repositories; that does not establish organization runner-group authority or reveal the effective group policy. The unauthenticated runner-group and Actions-permissions reads returned HTTP 401. No group was created or changed.

GitHub documents that runner groups can restrict repository and workflow access, and warns about self-hosted runners in public repositories because pull requests can run untrusted code on them. It also documents that artifact attestations are available to public repositories on Free, Pro, and Team plans. Availability is not an attestation or a trusted build route.

## Provider readback

| Repository | ID | Visibility / owner | Connector repo permission | Current workflow index |
|---|---:|---|---|---:|
| `PT-Original-Point/ptysd-vnext42-governance-sandbox` | 1352411536 | public / organization | admin | 54 active entries |
| `t14210184/hanyao` | 1272482826 | public / user | admin | 14 active entries |

“Active” is the Actions workflow index state; it does not mean a workflow ran or succeeded. The workflow index listed the governance workflow `factory-mcp-host-powershell-ci.yml` as active, but the file read at `main` and at the exact M01 head returned 404. That workflow identity is unresolved and is not accepted as a trusted route.

## Exact candidate and workflow observations

- PR #381 is open, non-draft, unmerged; exact head `7775891344b82886b9dbb7c7c7bf8fb369c026bf`, base CP200 `d39486601d851e31256852a24e9c1393b9046fe5`, 32 changed paths, zero `.github/workflows/**` paths. Its exact head currently has zero PR-triggered workflow runs.
- PR #88 is open draft, unmerged; exact head `7cd87cb0f69b5586719c1265828df20879b28bf`, base `e917139e4e81a12e41ef5ead507589ae0bf48452`, 11 changed paths, zero workflow paths. Its exact head currently has zero PR-triggered workflow runs.
- The governance workflow `.github/workflows/v45-bounded-self-hosted.yml` was read from `main` at blob `96eaa3e3a95c6d2a7821ee298659b43da8656db5`. It is `workflow_dispatch` only, has a fixed `z2-noop` input, `contents: read`, and `runs-on: [self-hosted, windows, ptysd-governance-v45]`. This is a runner-label request; it does not prove the actual group membership, repository allowlist, workflow allowlist, or runner identity. The workflow was not dispatched.
- The inspected HANYAO workflows `ads-line-hardening.yml` (`1f684ddcc7744e17c6abcc979b09cde1c720ba25`), `ads-line-required-gate.yml` (`d9ffd9697961110d43b81798150afe3037e7c461`), `ads-line-production-activation-pr.yml` (`dbc3c01d8989d81742418f23f4284f84fc64b81e`), and `ads-line-auto-activator.yml` (`a27aab16faf6bc16b34e2cc77f1cd6ddcd2953d5`) use GitHub-hosted `ubuntu-latest` runners and declare `contents: read`. PR #88 changes none of those workflow files. This is source inspection only; no workflow ran.
- Code search returned no `attest-build-provenance` matches in either repository. No attestation artifact or verification receipt is bound to the exact PR #381 or PR #88 heads.
- The direct unauthenticated `GET /orgs/PT-Original-Point/actions/runner-groups` and `GET /repos/{repo}/actions/permissions` calls returned HTTP 401. The connector has repository metadata and file tools but no runner-group configuration read operation. This does not prove the runner-group list is empty or that Actions settings are disabled.

## T01 disposition

The source-only survey is recorded; trusted-runner confinement and attestation qualification remain unverified. Keep candidate PR qualification on GitHub-hosted runners. Do not infer an eligible self-hosted route from repository admin permission, labels, workflow-index state, or a public-repository plan entitlement. Retain this as an exact trust lane awaiting authenticated group/workflow-access and Actions-permissions readback.

To close the lane, the exact runner group must be read with its selected repository IDs, selected workflow refs, runner membership/labels and current run identity; the applicable Actions settings must be read; and a provenance bundle must be generated and verified against the expected repository, workflow and immutable ref. Configuration or runner-group creation remains a separate trust-configuration action.

## Source references

- [GitHub runner groups](https://docs.github.com/en/actions/concepts/runners/runner-groups)
- [Managing access to self-hosted runners using groups](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub artifact attestations availability](https://docs.github.com/en/code-security/getting-started/github-security-features)
- [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)

