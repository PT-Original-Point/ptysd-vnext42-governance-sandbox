# VNEXT5.0 R4 Scheduled-Wake Staleness Hotfix

## Incident

A stale hourly Codex scheduled task injected the historical text beginning:

`Continue VNEXT5.0-R3 P0-03/P0-04 bootstrap sequencing in this thread.`

after R4 had already advanced. The stale payload re-declared an old atomic unit and old no-mutation/nondispatchable constraints. After context compaction it could become the newest operative instruction and stall current construction.

## Required local repair

Locate the existing Codex automation whose prompt begins with the exact historical string above. Before mutation, back up its local automation configuration.

Replace ONLY its payload with `governance/v50/CODEX-SCHEDULED-WAKE-LOCATOR-ONLY-R4.md`. Preserve cadence temporarily.

Read back the automation configuration and prove:
- exactly one active project wake for this project;
- payload contains `WAKE_SCHEMA=VNEXT5_CODEX_LOCATOR_WAKE_V1`;
- payload does not contain `R3-P0-03-P0-04-BOOTSTRAP-SEQUENCING-REPAIR`;
- payload does not contain `R3P03P04-BOOTSTRAP-REVIEW-D55C8F86`;
- payload does not contain the historical package digest;
- next wake reads CURRENT/canonical/provider state before choosing work.

If local Codex automation storage cannot be safely mutated from the current principal, report the exact file/object/provider and continue independent READY R4 work; do not stop the Goal.

After R4-04 supervisor live acceptance, disable/delete the UI scheduled wake entirely and prove no further UI wake is required.
