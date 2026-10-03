# Exact rework after interrupted native task

Root readback confirms the SAME session ses_efe606f6cffeBxLiIedexWKrH5 is idle/outcome interrupted, native interrupt=true, no active jobs. Existing five modified source files are preserved. Continue these bytes; do not restart from donor or repeat old provider verification.

The prior external-directory auto-rejections have been corrected by copying the immutable review and contract INSIDE your worktree: outputs/S-MCP-SEMANTIC-REPAIR/inputs/review-pr385.json and CONTINUATION-CONTRACT.md. Read these local copies; do not scan parent worktrees or retry denied external directories. Full scope remains tools/csg/factory-mcp/** plus outputs/S-MCP-SEMANTIC-REPAIR/**. Do not request global permissions bypass. No broker/Host install/execution or provider/Production writes.

Root independent review of partial edits found blocking defects:

1. broker/host-powershell-exec.ps1 currently calls WaitForExit BEFORE starting capture. This deadlocks high stdout/stderr against full pipes; it then labels ordinary high output timeout. Concurrent bounded drains must start immediately after process.Start and remain active during the whole process wait.
2. The capture loop checks deadline only when NO progress. A continuously writing descendant can exceed deadline forever. Check overall monotonic deadline every iteration, regardless of progress. For incomplete streams, hashes describe captured prefix/bytes and must explicitly mark full-stream hash incomplete; do not claim complete total/hash. Never return successful completion when capture/cleanup remains unconfirmed.
3. Preserve existing capability and update behavioral tests instead of hardcoded donor bytes/ReadToEndAsync/gen5 requirements. Add pure inert subprocess high-output BOTH stdout/stderr and retained-pipe child regressions. No SYSTEM broker execution. Complete installer/manifest/hash chain updates against exact new bytes.
4. All initial MCP-SR-01..06 still need tests and per-finding closure, including independent Host/shared/installed failures and latest locator ref/digest/freshness rejection. Broker durable receipt write must have intent-before-effect, Flush(true), exact readback and unknown after effect/persistence failure. Do not freeze before these known findings are resolved.

Use existing locked SDK dependencies (npm ci --ignore-scripts in this worktree only) and complete local npm test. Write durable result.json even for an unresolved finding, containing all actual outcomes and pending gates. Export complete binary patch with new source but no node_modules/outputs; no commit/push/remote verifier. This is bounded source construction with the existing free OpenCode model; no paid/model fallback.

Root will automatically collect and review. Do not ask Human to copy files. Any true unavailable specific operation parks only that operation; finish other known repairs. Work within 20 minutes and leave explicit handoff if interrupted. Do not mislabel source/local evidence as live/system PASS.
