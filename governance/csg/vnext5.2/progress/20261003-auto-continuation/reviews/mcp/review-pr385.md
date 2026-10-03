# PR385 exact-head independent semantic review

Verdict: **FINDINGS**. This does not globally block construction.

- Head: da8e1a767d54e67ba7bb15d7d35e9ae535e50034
- Tree: 04e09372fb6b35e7de98304f107ce3d6976819c2
- Sole parent: d39486601d851e31256852a24e9c1393b9046fe5
- Fresh provider PR metadata and commit identity agree with the clean frozen checkout.
- Structural verifier succeeds on this exact head; bounded-driver is skipped, not PASS.
- Four tools, package 0.2.4, task-SID caller boundary and the 16 exact repair payload digests are preserved.

## Required corrections

### MCP-SR-01 P1: Host diagnostic failure suppresses independent shared-context read

Source: tools/csg/factory-mcp/src/index.mjs:233-255.
Evidence: shared context is acquired only after the PowerShell probe and installed-runtime acquisition succeed; the single catch throws instead of returning a scoped probe failure and independent shared context.
Effect: A broken/missing probe or damaged Host component prevents factory_status from exposing otherwise valid V5.2 construction/canonical state, recreating the diagnostic self-lock.
Correction: Acquire and project Host, installed runtime and shared context independently with component-local unavailable states; keep no-argument fixed-purpose semantics and four tools.
Acceptance: Factory status returns valid shared context when Host probe throws/times out or local installed-runtime evidence acquisition fails.

### MCP-SR-02 P1: Publisher still binds an obsolete execution-owner identity

Source: tools/csg/factory-mcp/broker/owner-liveness-publisher.ps1:16-25.
Evidence: Expected identity pins generation 5, attempt 2 and old Codex thread; lines115-119 reject other identities; only ProjectId is configurable.
Effect: The JS projector supports rollover, but its producer rejects or relabels evidence for later legitimate task/attempt/session/generation. Scope-specific gen5 historical observation must not be represented as a universal current-owner publisher.
Correction: Bind current observation target from verified protected canonical/readback context, or explicitly separate bounded historical gen5 observation from current-owner projection. Never grant transport by owner generation.
Acceptance: After a canonical owner rollover, fresh protected target identity is accepted; stale identity is explicitly historical; cross-project and inconsistent components remain rejected.

### MCP-SR-03 P1: Output capture is not bounded and can block after nominal timeout

Source: tools/csg/factory-mcp/broker/host-powershell-exec.ps1:97-130.
Evidence: ReadToEndAsync stores complete stdout/stderr in memory; truncation happens after completion. GetAwaiter().GetResult has no deadline. Descendants retaining inherited pipes can keep capture incomplete even when the parent exited, and only non-exited parents trigger taskkill.
Effect: High output can exhaust the SYSTEM broker memory; retained pipes can stall its serial queue and health publishing indefinitely despite timeoutSeconds.
Correction: Stream bounded retained output with incremental total-byte/hash accounting; enforce an overall capture deadline and tree cleanup/cancel with explicit unknown effect when cleanup cannot be confirmed. Preserve existing capability, timeout shape and receipts.
Acceptance: High-volume stdout/stderr stays within memory/storage bounds; a parent exiting while a child retains pipes cannot exceed bounded completion/cancel deadline.

### MCP-SR-04 P1: Execution receipts do not establish crash-durable same-source completion

Source: tools/csg/factory-mcp/broker/hostguard-broker.ps1:49-53.
Evidence: Write-AtomicJson uses WriteAllText and Move-Item with no Flush(true), receipt digest or same-source readback. Invoke-BrokerPowerShell uses it at lines124-125 after effects have occurred.
Effect: A reported completed operation can lose durable receipt on crash/power loss, leaving an executed effect without reliable readback and inviting unsafe retry.
Correction: Use durable flush, final exact-byte readback/digest and explicit receipt persistence result before reporting completion. Persist intent/unknown-effect handling for effect/receipt failure; do not blind replay.
Acceptance: Injected failure after effect but before receipt acknowledgement remains unknown until exact receipt readback; successful completion has durable exact-source receipt.

### MCP-SR-05 P1: Fixed construction snapshot cannot discover subsequent integrated work

Source: tools/csg/factory-mcp/src/shared-context.mjs:95-114.
Evidence: Reader loads CURRENT and local-work-index only from the fixed shared-construction branch. Fresh exact fa1d9c00 CURRENT still names PR381/PR377 baseline and historical work snapshot; no progress locator/subsequent receipt-chain is consumed.
Effect: Real Web or new Session can read V5.2 architecture but cannot find current PR385/PR386/PR387 progress, results or continuing READY work without manual handoff.
Correction: Read a stable noncanonical single-writer CAS progress locator and exact receipt/index identities separately from frozen architecture/source documents. Do not edit a source candidate to bind its own head and do not mutate canonical CP200.
Acceptance: Publish a new bounded progress receipt, then a cold consumer discovers it through the stable locator without user copying a prompt; historical snapshot remains historical.

### MCP-SR-06 P2: Tests require the stale implementation instead of qualification behavior

Source: tools/csg/factory-mcp/tests/capability-parity.test.mjs:119-126.
Evidence: Candidate test requires exact donor helper normalized hash and ReadToEndAsync. Publisher test separately requires gen5 and old owner principal at lines93-95.
Effect: Correct bounded capture/current-target fixes would fail the current suite, encouraging source churn or retaining the defects.
Correction: Preserve donor baseline as historical lineage and verify candidate semantic capability parity through behavior, bounds, cancellation, fresh identity binding and exact package hashes.


## Scope of evidence

This audit inspected code/control flow and existing tests and independently calculated package payload digests. It did not rerun the previously reported 48/48 suite, install anything, dispatch Host code, probe SYSTEM, reproduce high-output execution, change source bytes, write provider refs, or promote canonical state.

Old donor lineage and historical gen5 reconciliation evidence remain preserved. A corrected candidate needs its own exact-source behavioral qualification; it must not silently relabel historical evidence as current or regress the six-argument authorized route.

Continue source repair and the independent progress-index lane now. Live consumer, install, Ads, survival and Production remain separate acceptance states.

