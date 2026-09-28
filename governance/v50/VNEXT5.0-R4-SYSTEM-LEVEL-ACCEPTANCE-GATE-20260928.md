# VNEXT5.0 R4 System-Level Acceptance Gate

Status at publication: `R4_ACCEPTANCE=NOT_ACCEPTED`.

## Claim rule

A spec, commit, local test, structural verifier, semantic review, draft PR, or single live canary does **not** permit the claim that R4/continuity/autonomy is solved. Closure language is allowed only after `R4_SYSTEM_LEVEL_ACCEPTANCE=PASS`.

## Required black-box matrix

Every row below must PASS with fresh exact-head/provider evidence. Any later regression revokes acceptance.

| ID | Scenario | PASS condition |
|---|---|---|
| A01 | Fresh Codex session | Resolves current durable state without chat archaeology and continues correct work |
| A02 | Fresh ChatGPT session | Resolves Project/run from Directory + canonical control, not Memory/recent chat |
| A03 | Context compaction | Current authority survives; stale text cannot regain control |
| A04 | Stale scheduled wake | Obsolete wake is rejected; CURRENT/canonical/provider truth wins |
| A05 | Codex UI closed | Host-owned continuation still makes useful progress |
| A06 | Codex process crash | Finite recovery; no duplicate non-idempotent side effect |
| A07 | Windows reboot | Supervisor restarts and resumes from durable state |
| A08 | Broker/tunnel restart | Transport recovers without permanent WAITING/NOOP |
| A09 | WAITING_EXTERNAL | Waiting lane yields to another READY lawful unit |
| A10 | Runtime path drift | Runtime is rediscovered from OS/provider objects; no hard-coded-path deadlock |
| A11 | Duplicate/concurrent wake | One executor owns slot; duplicate wake is bounded/no-op |
| A12 | Unknown side effect | Same-source readback first; no blind retry |
| A13 | Local vs protected PASS | Local PASS is never promoted without exact-head protected/live evidence |
| A14 | Orphan reconciliation | Five Factory orphans classified from exact evidence only |
| A15 | No human relay | Ordinary authorized construction requires no message shuttling between AIs |
| A16 | 12-hour soak | No silent stop, stale wake regression, or unchanged-state loop |
| A17 | 24-hour soak | Same across restart/scheduled boundaries |
| A18 | Resume normal R3 | R3 resumes without reverting to legacy P0 prompts |

## Evidence per row

Exact candidate/head; exact prestate; injected event/fault; execution identity; same-source readback; expected vs actual; side-effect classification; durable evidence ref.

## Known regression classes

Stale scheduled instruction; context-compaction authority inversion; runtime-path drift; local PASS confused with protected/live PASS; WAITING_EXTERNAL becoming Goal-global; unchanged-fingerprint report loops; UI liveness confused with executor liveness; circular Host bootstrap; stale/missing durable handoff; divergent executor heads; unnecessary external-review dependency.

## Promotion and revocation

`R4_ACCEPTANCE=PASS` only when A01-A18 all PASS on one integrated lineage or explicitly compatible exact heads with compatibility proof.

Any later A01-A18 regression => `R4_ACCEPTANCE=REVOKED_PENDING_REQUALIFICATION`.

## Current state

R4 is **NOT ACCEPTED**.

Known open live gaps include the stale Codex scheduled wake, R4-01 live Host qualification, and R4-04 live supervisor/reboot/crash/duplicate-wake qualification.

No component-level PASS overrides this status.
