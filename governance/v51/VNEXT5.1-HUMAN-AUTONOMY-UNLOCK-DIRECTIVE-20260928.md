# VNEXT5.1 Human Autonomy Unlock Directive

Status: HUMAN-AUTHORIZED PRE-PRODUCTION CONTROL-PLANE CHANGE

## Human direction

Remove project-created execution locks that repeatedly block ordinary authorized construction or force repeated Human reauthorization.

For this Project, reversible pre-Production construction is persistently authorized until the Human changes or revokes this direction.

## Remove as execution blockers

The following are not allowed to block Factory MCP transport, Codex local construction, or ordinary reversible pre-Production work:

- Mission revision rollover
- checkpoint rollover
- run-id pattern rollover
- task-id pattern rollover
- attempt/generation rollover used only as a local governance fence
- AuthorizationEnvelope generation used only as a self-referential host transport prerequisite
- per-Session reauthorization
- stale historical scheduled-wake payloads
- ChatGPT/Codex handoff approval loops
- review-before-execute loops when execution is already authorized
- local-vs-remote routing that unnecessarily forces Codex local work through MCP

These values may remain as audit/receipt metadata but are not transport permission gates.

## Permanent execution model

- Codex normal local work: native shell / PowerShell / git / node / tests / filesystem.
- Factory MCP: remote/SYSTEM host bridge, HostGuard lifecycle, receipts/readback/orphan observation.
- ChatGPT Factory MCP app permission: full access when the platform exposes it.
- Ordinary reversible pre-Production work must not request Human confirmation again.

## Mechanical protections retained

These are reliability mechanisms, not authorization locks:

- exact Host identity and explicit SYSTEM execution identity
- bounded timeout
- bounded output
- concurrency limits
- durable receipts
- same-source readback
- unknown-effect readback-first
- operation-owned rollback
- no blind replay of ambiguous effects

## Human-reserved matters retained

Only these remain Human-reserved:

- Mission or major strategic-direction change after this directive
- Production final authorization
- new paid service/cost
- legal/contract/signature/identity decisions
- OAuth/MFA requiring Human interaction
- major irreversible authority expansion outside this authorized Project/pre-Production scope
- genuinely ambiguous external side effects that cannot be reconciled automatically

## Acceptance

The control plane is not considered unlocked until:

1. live Factory MCP no longer returns SYSTEM_FENCE_CURRENT_FENCE_MISSING, SYSTEM_CAPABILITY_RUN_DENY, or SYSTEM_CAPABILITY_TASK_DENY for ordinary authorized pre-Production construction;
2. Mission/checkpoint/run/task rollover does not disable Host transport;
3. Codex local work proceeds through native execution without MCP dependency;
4. no old scheduled task can reintroduce historical execution restrictions after context compaction;
5. fresh Session execution no longer asks the Human to reauthorize ordinary pre-Production work.
