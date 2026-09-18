# V4.8 即時施工工作日誌

> 性質：人類可讀的即時投影（NON-CANONICAL PROJECTION）。
> 權威仍是 Git/CSG canonical control、checkpoint、Mission、Execution Policy 與 provider same-source readback；本檔不得覆蓋 canonical state。

## 2026-09-18｜D9 continuation

- Project: `CHATGPT_GLOBAL_SKILL_GOVERNANCE`
- Canonical branch prestate: `v45/factory-control@fc91725cc2239504158884d49b681b1a244d693a`
- Current control: `V48-D9-BLOCKED-035`, checkpoint `35`
- Active atomic unit: `V48-D9`
- Last verified gate: `V48-D8 = PASS`
- STOP: `false`
- unresolved effects: `[]`
- D10 remains forbidden while D9 is blocked.
- Current D9 upstream blocker: `modelcontextprotocol/conformance#258` remains OPEN; no official server stdio conformance runner was verified.
- Prohibited workaround remains `NEW_LISTENER_HTTP_SHIM`.

### Durable changes already completed before this continuation

- D9 local hardening was merged by PR #64 and canonicalized at `fc91725cc2239504158884d49b681b1a244d693a`.
- Factory MCP application fence now requires `attemptEpoch >= 1` in source, wrapper and broker; the legacy protocol fixture also contains a negative `attemptEpoch=0` case.
- Static fence verifier previously passed 14 checks. Runtime protocol smoke was not executed in the current container because npm dependencies were unavailable; no runtime PASS is claimed.
- External ecosystem research was expanded into `V47-GITHUB-ECOSYSTEM-MASTER-WATCHLIST-20260917-R2-20260918.md`; local artifact SHA-256: `9edb270743440e7319f6e811fe2bbbae3a2afda4eac24d1b56d047e3beef01a3`.
- Software-factory ecosystem monitoring was consolidated into one daily adaptive monitor. The older overlapping weekly factory monitor, weekly frontier-model report, and separate daily frontier-model monitor were disabled.
- Daily hard-watch scope now includes MCP conformance #258, Inspector, official TypeScript/Python/Go/Rust SDKs, mcp-spec-test, mcp-doctor, mcpdiff, mcptoolkit-contract, mcp-conform, mcp-scan and MCP Server Tester, plus the wider Harness/Agent/Sandbox/Durable Runtime/GitHub-native/model ecosystem.

### Fresh upstream readback in this continuation

- `modelcontextprotocol/conformance#258` is still OPEN.
- The issue discussion explicitly notes that the current suite has HTTP-only scenarios and that stdio support would require transport-aware scenario filtering/tagging; no maintainer-approved stdio runner implementation was verified.
- Community stdio/server-test projects remain differential or diagnostic evidence only and must not be promoted as official MCP conformance authority.
- Frozen upstream heads for this research tranche:
  - conformance `7169291ec0b68eb370fddcd9947313ab0d5e4156`
  - Inspector `2e90a628e6296c62e4bef942afbb43d3faa4baf4`
  - TypeScript SDK `60321700871029401a2e3bed8fdf4f02c9ec3331`
  - Python SDK `6affe5c0d3588fd1705713b3703dc68015cfe3eb`
  - mcp-spec-test `dd0647ac87091ae97a16954100d9da90f9294cd0`
  - mcp-doctor `7781f8f72581f80670d48e2d1ccb6838cfcc53d9`
  - mcp-contracts `5228e7ad71b080c3d56001b3019289703f5dc231`

### New local finding

- Factory MCP package metadata is `0.1.3` in both `package.json` and `package-lock.json`, while the pre-patch `src/index.mjs` reported server version `0.1.0`.
- This created avoidable server-identity evidence drift.

### D9 local hardening continuation

Dedicated branch: `v48-d9-continuation-20260918`, created from exact canonical SHA `fc91725cc2239504158884d49b681b1a244d693a`.

Applied changes:

- `tools/csg/factory-mcp/src/index.mjs`
  - removed the duplicated hard-coded `VERSION = '0.1.0'`
  - derives runtime server version from `../package.json`
  - fails closed with `INVALID_PACKAGE_VERSION` if package version is absent/invalid
  - preserves `attemptEpoch.min(1)`
  - preserves exactly three `server.registerTool(...)` registrations
- `tools/csg/factory-mcp/tests/protocol-smoke.mjs`
  - reads package metadata
  - asserts `initialize.result.serverInfo.version === packageMetadata.version`
  - preserves the existing three-tool assertion
  - preserves the negative `attemptEpoch=0` fail-closed assertion
- added `governance/csg/v48/d9-qualification-plan-v2.md`
  - separates L0 static evidence, L1 official-component shadow, L2 third-party differential, L3 live ChatGPT schema convergence, and L4 promotion authority
  - explicitly retains `DEL-06` and forbids D10 until L4 is satisfied
  - external qualification tools remain test-only; no runtime dependency promotion

Branch commit progression:

- `f9dc52bcd241d0426d15f162babe1d5db3154f88` — create live worklog
- `16b7ce2cd011b81a027fbfce700a8da35cc824c2` — derive runtime MCP version from package metadata
- `7d16f6a724fb97f2c604f9c2c1cd19693b4ecbb9` — add version-consistency protocol-smoke assertion
- `4b7cd6df2bd5843b6a6dab8709906c91548bf938` — add D9 qualification plan v2

Local validation performed against same-source readback content reconstructed in an isolated local directory:

- `node --check src/index.mjs` = PASS
- `node --check tests/protocol-smoke.mjs` = PASS
- package version readback = `0.1.3`
- static check: no hard-coded `0.1.0` runtime version = PASS
- static check: `attemptEpoch.min(1)` and no `.min(0)` = PASS
- static check: public `server.registerTool` count = 3 = PASS
- static check: runtime-version smoke assertion present = PASS
- static check: `attemptEpoch=0` negative case present = PASS
- reconstructed candidate SHA-256:
  - `src/index.mjs` = `762c09aeca38c8774d1a98e5e37f584247b5a7dc440c2e1c2d8ed7bb10b0ed9e`
  - `tests/protocol-smoke.mjs` = `ddf5c7abf5a4e1084295c28d97b60e4073fe1aaf5c0471c2cb5289c59932276b`

Runtime protocol smoke remains `NOT_EXECUTED` in the current container because the Factory MCP npm dependencies are not locally installed and outbound npm package fetch is unavailable. No runtime PASS is claimed.

### Shared-mutation pre-PR readback

Immediately before PR creation, `v45/factory-control` still compared identical to `fc91725cc2239504158884d49b681b1a244d693a`; no canonical drift was detected.

### Current bounded construction tranche

1. Open a protected PR from `v48-d9-continuation-20260918` to `v45/factory-control`.
2. Require the trusted verifier/checks to finish successfully.
3. Fresh-read canonical head before merge and bind merge to the exact PR head.
4. Merge only if checks are clean and canonical prestate has not drifted.
5. Same-source read back canonical source after merge.
6. Keep checkpoint 35 BLOCKED unless official stdio conformance or a verified equivalent official path actually satisfies the D9 gate.
7. Continue D9 source-level qualification and upstream monitoring; D10 remains forbidden.


### PR #65 trusted-verifier incident and bounded repair

- PR #65 head: `3d06db62ee363fadbebadbe653bf5a586f59f37d`.
- GitHub check `csg-trusted-verifier` completed with FAILURE; job id `105456093502`, workflow run `35298552732`.
- Immutable verifier output: `DIRECT_PARENT_MISMATCH`.
- Root cause: the candidate head had five sequential commits after canonical base `fc91725cc2239504158884d49b681b1a244d693a`; the trusted verifier requires the PR head to have exactly one parent and that direct parent must equal the current canonical base SHA.
- This is a candidate-history structural failure, not a Factory MCP runtime/test PASS or FAIL. No runtime protocol smoke claim changes.
- `bounded-driver-acceptance` was skipped for this PR; no business/Production/worker effect was dispatched.
- Repository auto-merge is disabled; no auto-merge fallback was used.
- Repair policy: do not modify the trusted verifier, do not weaken acceptance, do not force-update any ref. Reconstruct the exact intended final tree as one commit directly parented by `fc91725cc2239504158884d49b681b1a244d693a` on a fresh feature branch, then open a replacement PR and rerun the same trusted verifier.
- Repair branch: `v48-d9-continuation-squash-20260918`, created at the exact canonical base before the one-commit candidate is attached.
- Canonical `v45/factory-control` is unchanged by the failed PR.

### Next single action

Create one Git commit containing the final four-file D9 changes with direct parent `fc91725cc2239504158884d49b681b1a244d693a`, fast-forward only the fresh repair branch to that commit, close superseded PR #65, and open the replacement PR. No force update is permitted.

### PR #66 acceptance and canonical merge

- Replacement PR #66 used candidate head `1cc5ff4041e927d5545cebd20a415b4c9fd4676b`.
- Candidate direct-parent proof: exactly one parent, `fc91725cc2239504158884d49b681b1a244d693a`; compare showed ahead_by=1 and behind_by=0 before PR.
- `csg-trusted-verifier` job `105457055025` / workflow run `35298874255` completed `SUCCESS`.
- `bounded-driver-acceptance` was `SKIPPED`; it is not being claimed as a runtime protocol test.
- Final pre-merge readback showed PR head unchanged, base SHA `fc91725cc2239504158884d49b681b1a244d693a`, mergeable=true, and canonical branch still identical to the expected base.
- Merge dispatch returned HTTP 405 `Merge already in progress`; per readback-first policy it was NOT retried.
- Immediate same-source readback confirmed PR #66 `merged=true` at merge commit `75070afead2d307d609e5ac7253508964db2ab60`.
- Canonical readback after merge confirms the new runtime-version source and smoke assertion are present.
- Canonical CSG pointer remains checkpoint 35 / `V48-D9-BLOCKED-035`; D9 was not promoted and D10 was not entered.

### Current-session live Factory MCP schema readback

- Current ChatGPT session exposes exactly three Factory MCP tools: `factory_status`, `worker_prepare`, `worker_start`.
- Current loaded schema for both mutation tools still advertises `attemptEpoch.minimum = 0`.
- Canonical repository source now requires `attemptEpoch.min(1)`; therefore current-session application definition is `STALE_OR_MISMATCHED` relative to canonical source.
- This observation is scoped to the currently loaded ChatGPT session definition. It does not prove that the server deployment is stale, because ChatGPT connector/tool definitions can be session/app-definition snapshots.
- Read-only `factory_status` succeeded against the governed endpoint and returned exact host `DESKTOP-1B6PD2P`, VM `PTYSD-WORKER-01`, VM state `Running`, guest IP `172.31.253.10`, SSH 22 reachable, and run-as `NT AUTHORITY\\SYSTEM`.
- The VM was already Running. No `worker_prepare` or `worker_start` call was issued in this tranche.
- D9 L3 therefore remains UNSATISFIED until an app-definition refresh / fresh-session readback shows `attemptEpoch.minimum = 1` with the exact three-tool surface.

### Next single action

Persist this live-schema mismatch as bounded D9 evidence, then continue source-level/upstream qualification work that does not require Host VM start, Worker dispatch, new listener, new credentials, or D10.

### PR #67 acceptance and canonical merge

- PR #67 candidate head `1b55d4ca42e28aa5ae5d363485adcd5d7bbb7753` had exact direct parent `75070afead2d307d609e5ac7253508964db2ab60`.
- `csg-trusted-verifier` job `105457590034` / workflow run `35299097185` completed `SUCCESS`.
- PR #67 merged at canonical commit `0be803c1ea8cb522d338d4ee973f8e443c7e2d7f`.
- Same-source readback confirmed `d9-live-schema-evidence-v1.json` and the worklog are canonical, while `governance/csg/current.json` remains checkpoint 35 / `V48-D9-BLOCKED-035`.

### D9 upstream source compatibility audit

Purpose: determine whether the Factory MCP pin itself is behind the official 2026-07-28 stdio implementation before considering an SDK upgrade.

Fresh findings:

- Factory MCP canonical `package.json` pins `@modelcontextprotocol/server=2.0.0` and `zod=4.6.5`.
- Canonical `package-lock.json` resolves and integrity-pins:
  - `@modelcontextprotocol/server@2.0.0`
  - `@modelcontextprotocol/core@2.0.0`
  - `zod@4.6.5`
- At observed official TypeScript SDK head `60321700871029401a2e3bed8fdf4f02c9ec3331`, both `@modelcontextprotocol/server` and `@modelcontextprotocol/client` package manifests are version `2.0.0`.
- Official `serveStdio` source at that head explicitly defines itself as the stdio entry point for the 2026-07-28 revision, with 2025 fallback behavior.
- Official source handles `server/discover` in the stdio opening exchange, builds a modern instance for the probe, keeps the negotiation window unpinned until a modern request commits the era, and supports fallback to a fresh legacy instance.
- Official protocol-era constants at the same head define `FIRST_MODERN_PROTOCOL_VERSION='2026-07-28'` and `SUPPORTED_MODERN_PROTOCOL_VERSIONS=[FIRST_MODERN_PROTOCOL_VERSION]`.
- Official discover tests require server identity in result `_meta['io.modelcontextprotocol/serverInfo']` and verify modern-only supportedVersions.
- Official docs explicitly map 2026 stdio serving to `serveStdio(factory)`; Factory MCP already uses `void serveStdio(createServer)`.
- Inspector observed release head `2e90a628e6296c62e4bef942afbb43d3faa4baf4` is version `2.7.0` and itself pins official MCP client/core/server `2.0.0`; its CLI supports stdio commands, `--protocol-era legacy|auto|modern`, `tools/list`, `--strict`, and machine-readable `--format json`.

Decision from source audit:

- `SDK_UPGRADE_NEEDED_FOR_2026_STDIO = false` for the currently observed official server package: Factory MCP is already pinned to the official server `2.0.0` that contains the modern `serveStdio` path.
- `SOURCE_LEVEL_2026_STDIO_ALIGNMENT = PASS`.
- `RUNTIME_2026_NEGOTIATION = NOT_EXECUTED`.
- Existing local protocol smoke still exercises the 2025 `initialize` path; it does not prove `server/discover` / modern per-request envelope behavior.
- Therefore no dependency churn is justified. The next value-producing proof is an official-client/Inspector modern stdio runtime probe when the execution environment can run the pinned packages.
- This source audit does not clear D9 L4 and does not change checkpoint 35.

### Local runtime-package acquisition attempt

- A bounded attempt was made to obtain the exact npm tarballs named by canonical `package-lock.json` so the protocol smoke could run in an isolated workspace.
- Direct npm registry access from the current execution container fails DNS resolution (`Could not resolve host: registry.npmjs.org`); the artifact-download helper also could not retrieve the registry tarball through its allowed URL path.
- No package was substituted from an unverified mirror; no integrity check was bypassed.
- Runtime smoke remains `NOT_EXECUTED`.

### Next single action

Persist the source-compatibility evidence through a one-commit direct-parent PR. If trusted verification passes, merge it, then continue D9 with the next legal proof target: refine the modern-runtime test vector and search for a provider-native execution route that can run the exact pinned packages without adding a workflow/listener/credential surface.

### PR #68 acceptance and worklog projection reconciliation

- PR #68 candidate head `44ad92fdd317d7bafaeb0ce70dad7bd8f22886d4` passed `csg-trusted-verifier` job `105458960336` / workflow run `35299497820`.
- PR #68 merged at canonical commit `75b44aae12231f12cf2b11462226da9a093dda68`.
- Same-source readback confirmed the upstream-source compatibility evidence is canonical; CSG pointer remains checkpoint 35 / `V48-D9-BLOCKED-035`.
- During continuity hygiene review, the pre-existing projected worklog at `governance/csg/worklog/*` was found still rendered from checkpoint 25. The projector's `classifyProjection()` semantics therefore treat it as stale relative to current checkpoint 35 even though its stored `stale` field reflects the time it was originally rendered.
- This repair does not make the worklog authoritative. It only regenerates the existing projection from canonical checkpoint events 11–35 so human-visible status again matches canonical CSG.
- The detailed D9 notes in this file remain a non-canonical construction log; `governance/csg/worklog/*` remains the deterministic checkpoint projection.

### Worklog projection repair target

- source checkpoint seq: 35
- source checkpoint digest: `sha256:3dd8d6d6e1b78cf47a810222e1df008564d09af5cb05c3f22f8e75f31a112e5a`
- projected state: `V48-D9 / BLOCKED / ACTIVE_UNIT`
- next legal transition: `V48_D9_RESUME_OFFICIAL_STDIO_CONFORMANCE_QUALIFICATION`
- rendered markdown SHA-256: `sha256:0ed4a56de595bb8226b6cf76fae1a69240033236fe18530da7fef58919972d8f`
- no Mission/Policy/checkpoint/control mutation.

### Next single action

Publish the regenerated worklog projection plus this reconciliation evidence as one direct-parent commit, require trusted verifier PASS, then merge with fresh canonical precheck.
