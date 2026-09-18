# V48-D9 Qualification Plan v2

Status: `ACTIVE / BLOCKED_ON_OFFICIAL_STDIO_CONFORMANCE`

This document is a bounded execution plan and evidence projection for the current V48-D9 unit. It does not change Mission, Execution Policy, canonical checkpoint, or the D9 verdict.

## Authority prestate

- Project: `CHATGPT_GLOBAL_SKILL_GOVERNANCE`
- Canonical prestate: `v45/factory-control@fc91725cc2239504158884d49b681b1a244d693a`
- Checkpoint: `000035`
- Transition: `V48-D9-BLOCKED-035`
- Last verified gate: `V48-D8 = PASS`
- Required resume condition: `OFFICIAL_STDIO_CONFORMANCE_RUNNER_AVAILABLE_OR_EQUIVALENT_OFFICIAL_PATH_VERIFIED`
- Forbidden: Production, business project mutation, paid fallback, N2+, Host VM start, Worker dispatch, new listener, new credential topology, force update.

## Frozen upstream observation set

The following exact upstream heads are research pins for this qualification tranche. They are not vendored runtime dependencies.

| Component | Observed head | Intended role |
| --- | --- | --- |
| `modelcontextprotocol/conformance` | `7169291ec0b68eb370fddcd9947313ab0d5e4156` | Official conformance authority |
| `modelcontextprotocol/inspector` | `2e90a628e6296c62e4bef942afbb43d3faa4baf4` | Official stdio protocol shadow/probe |
| `modelcontextprotocol/typescript-sdk` | `60321700871029401a2e3bed8fdf4f02c9ec3331` | Official TypeScript protocol/runtime oracle |
| `modelcontextprotocol/python-sdk` | `6affe5c0d3588fd1705713b3703dc68015cfe3eb` | Cross-language 2026-07-28 stdio oracle |
| `hasmcp/mcp-spec-test` | `dd0647ac87091ae97a16954100d9da90f9294cd0` | Third-party black-box differential only |
| `EnjoyableWork/mcp-doctor` | `7781f8f72581f80670d48e2d1ccb6838cfcc53d9` | Passive diagnostic only |
| `mcp-contracts/mcp-contracts` | `5228e7ad71b080c3d56001b3019289703f5dc231` | ABI/schema snapshot-diff candidate |

Fresh readback confirms `modelcontextprotocol/conformance#258` remains OPEN. Its discussion explicitly identifies the need for a server `--stdio` path and transport-aware filtering for HTTP-only scenarios. No maintainer-approved stdio runner implementation was verified in this tranche.

## Evidence ladder

### L0 — Static identity/fence evidence

Must remain true:

- Factory MCP public tool count is exactly 3.
- Exact tool names: `factory_status`, `worker_prepare`, `worker_start`.
- `attemptEpoch >= 1` at the MCP schema, PowerShell wrapper and HostGuard broker boundaries.
- No new listener.
- No new credential topology.
- Transport session/connection does not grant application authority.
- Package/runtime server identity must not have duplicate version authorities.

L0 can harden source but cannot clear D9 by itself.

### L1 — Official-component stdio shadow

When the environment can execute the official package without violating policy:

- Pin Inspector to an exact release/commit-equivalent package identity.
- Start Factory MCP only as its existing stdio process.
- Run read-only protocol operations such as discovery/listing through Inspector CLI.
- Capture machine-readable output and stderr separately.
- Verify 2026-era negotiation where the installed Factory MCP SDK supports it.
- Do not introduce HTTP/SSE listener shims.

Verdict label: `OFFICIAL_COMPONENT_SHADOW_PASS|FAIL`.

This is not an official conformance PASS.

### L2 — Independent differential

Optional test-only tools may be used only if they remain ephemeral and do not enter the Production/runtime dependency graph.

- `mcp-spec-test`: black-box differential; telemetry disabled; exact version pinned.
- `mcp-doctor`: passive diagnostics.
- ABI/schema diff candidate: compare `mcpdiff` and `mcptoolkit-contract`; retain at most one if it deletes custom fixture/LOC later.

Verdict label: `THIRD_PARTY_DIFFERENTIAL_PASS|FAIL`.

Third-party success cannot clear the official D9 blocker.

### L3 — Live ChatGPT definition acceptance

The repository source and the live connector schema must converge.

Required fresh-session readback:

- public tool count = 3
- exact names unchanged
- `attemptEpoch.minimum = 1`
- no unexpected prompt/resource/public tool growth

A stale ChatGPT definition snapshot must not be mistaken for current server source.

Verdict label: `LIVE_SCHEMA_CONVERGED|STALE_OR_MISMATCHED`.

### L4 — D9 promotion authority

D9 may move from BLOCKED only when one of the checkpoint-required conditions is actually demonstrated:

1. an official server stdio conformance runner becomes available and runs successfully against the supported Factory MCP scope; or
2. an equivalent official path is verified without replacing official requirement/scenario semantics with a large custom harness.

If an adapter would need to reimplement HTTP-only scenario semantics, lifecycle rules, requirement selection, or large parts of the official runner, it fails the V4.8 DELETE_GATE and must not be promoted as an equivalent path.

Only L4 can authorize a new D9 acceptance checkpoint and unlock D10.

## Current code-hardening subtranche

A local metadata drift was found:

- `package.json` version: `0.1.3`
- `package-lock.json` root version: `0.1.3`
- previous `src/index.mjs` serverInfo version literal: `0.1.0`

The bounded repair removes the duplicate literal and reads version from package metadata. The protocol smoke fixture also asserts that the initialize response reports the package version.

This change:

- adds no dependency,
- adds no daemon/listener,
- adds no credential or trust surface,
- does not change the three-tool public surface,
- does not change HostGuard mutation authority,
- does not claim D9 PASS.

## DELETE_GATE for qualification tooling

Default result for all external qualification tools is `TEST_ONLY / NOT_RUNTIME_DEPENDENCY`.

A tool may remain after D9 only if it deletes more maintained custom verification code than it adds and does not introduce a second authority, persistent daemon, credential surface, network listener, or paid service.

Until then:

- `DEL-06 protocol-smoke.mjs = RETAIN`
- official Inspector/SDK = external oracle, not vendored control plane
- community tools = differential only
- D10 = FORBIDDEN

