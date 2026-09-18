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
