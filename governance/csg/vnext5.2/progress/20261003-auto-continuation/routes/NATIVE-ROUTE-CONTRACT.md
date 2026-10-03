# Native route inventory and exact dispatch contract

Observed on 2026-10-03. Discovery invoked no model, installed nothing, did not inspect credentials, and did not submit construction.

## OpenCode: installed noninteractive route

- Executable: `C:\Users\x\AppData\Local\Programs\@opencodedesktop\resources\opencode-cli.exe`.
- Actual version: `opencode v2.0.22`.
- Existing service: `http://127.0.0.1:49374`, process 12936. `api server.info` returned the same version, PID, URL.
- Existing process executable: `C:\Users\x\AppData\Roaming\ai.opencode.desktop\cli\2.0.22\opencode-cli.exe`.
- Installed `run --help` supports `--server`, `--standalone`, `--session`, `--format json`, `--file`, `--title`, `--agent`, `--model provider/model#variant`.
- Installed `run` has no `--dir` or `--attach`; use subprocess cwd and installed syntax, not copied online v1 syntax.
- Session list in the S-RECOVERY worktree returned `[]`. This does not prove no sessions exist in other project contexts. Do not select an unrelated last session with `--continue`.
- `GET /global/health` returned HTML. Never count HTTP 200 alone as API health. The installed operation `api server.info` is proven; v1 REST cancellation endpoints are not.

Coordinator invocation shape, after exact worktree, model/provider cost authority and write set are selected:

```text
spawn(executable, ["run", "--server", verifiedLoopbackUrl, "--session", durableSelectedSessionId,
  "--format", "json", "--file", exactTaskFile, "--title", durableTaskId,
  "Execute the attached bounded source task and persist its result."],
  { cwd: exactDedicatedWorktree, shell: false, windowsHide: true })
```

Do not add `--auto` indiscriminately. Use current permissions and explicit bounded task rules. Model is not silently substituted or changed to paid fallback. Completion requires persisted task receipt plus exact path/tree verification; process exit alone is not acceptance. CLI process cancellation does not prove backend cancellation when using the existing service. Until installed cancellation API is inspected, cancellation is `UNQUALIFIED`, never blind redispatch after timeout. `session export --sanitize <selectedSessionId>` is installed for result retrieval, but was not executed during discovery.

## Antigravity: Desktop present, official CLI not located

- Start Menu shortcut resolves to `C:\Users\x\AppData\Local\Programs\antigravity\Antigravity.exe`, actual version 2.19.1.
- PATH lookup for `agy`, `agy.cmd`, `agy.exe` found nothing. Official default `C:\Users\x\AppData\Local\agy\bin` absent; no CLI found in inspected user bin/npm/WinGet locations.
- Desktop is not the `agy` launcher. Do not invoke Desktop with invented `-p` flags or bypass its UI through internal language-server endpoints.
- Official mature CLI supports `agy -p`, JSON/stream-json results, `--conversation <id>`, persistent stream-json stdin, bounded `--print-timeout`, configured permissions. That is the preferred native adapter when installed/authenticated.
- Installing CLI and performing sign-in remain separate capability work; neither was done here. Missing Antigravity CLI parks its route only. Ready Codex/OpenCode native source lanes continue.

Proposed supported command after installation and existing-account authentication readback:

```text
agy -p "<bounded exact source task>" --output-format stream-json --print-timeout 15m
```

Future turns use captured conversation ID, never global `--continue`. Persist result status, denied actions, exact bytes, tool events and conversation ID. Do not replace Antigravity with Gemini API keys or a new billable account to remove the missing route.

## Isolation and authority

These are user-native Windows construction routes. Dedicated Git worktrees prevent source collision but are not OS sandboxes. They do not satisfy F01 Hyper-V Ubuntu cell execution, SYSTEM Host broker qualification, live MCP acceptance, Ads acceptance, canonical promotion, or Production. Scope enforcement and exact task/write-set checking are required before automatic dispatch; unknown effects demand readback first.

## Primary sources

- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode server](https://opencode.ai/docs/server/)
- [Google official Windows CLI installation and auth](https://www.antigravity.google/docs/cli/install/)
- [Google official headless CLI](https://www.antigravity.google/docs/cli/headless/)
- [Google official CLI reference](https://www.antigravity.google/docs/cli/reference/)

Online OpenCode docs expose a different API generation than the installed binary. Installed help and proven server operation take precedence for actual dispatch arguments; documentation does not count as local runtime proof.
