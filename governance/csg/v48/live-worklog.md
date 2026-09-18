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

### New local finding

- Factory MCP package metadata is `0.1.3` in both `package.json` and `package-lock.json`, while `src/index.mjs` still reports server version `0.1.0`.
- This creates avoidable server-identity evidence drift. The planned hardening is to remove the duplicate literal and derive the MCP server version from the package metadata without adding a dependency, daemon, listener, credential or public tool.

### Current bounded construction tranche

1. Eliminate the duplicated Factory MCP runtime version literal.
2. Add an exact protocol-smoke assertion that `initialize.result.serverInfo.version` equals package metadata.
3. Perform syntax/static checks available in the current environment; explicitly retain the runtime-smoke limitation if dependencies remain unavailable.
4. Record every evidence delta in this worklog.
5. Submit through a dedicated D9 branch and protected PR; merge only after fresh canonical-head precheck and required trusted verifier success.
6. Do not mutate checkpoint 35 or claim D9 PASS unless the official-stdio/equivalent-official-path requirement is actually satisfied.

