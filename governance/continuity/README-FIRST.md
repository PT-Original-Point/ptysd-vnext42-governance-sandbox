# READ THIS FIRST — Cross-Session Continuity Projection

This directory exists so a new ChatGPT/Codex/AI/session does **not** have to excavate old conversations.

## Authority boundary

The files here are **derived projections**, not a second control plane.

Authority order remains:

1. Human's latest explicit Mission instruction
2. Project Directory
3. canonical `v45/factory-control` checkpoint/run
4. same-source provider/runtime readback
5. immutable snapshot in this directory
6. chat/session summaries

If a snapshot disagrees with canonical/provider state, canonical/provider state wins and the projection must be refreshed.

## Required cold-start path

1. Read `governance/continuity/CURRENT.json`.
2. Read the exact immutable snapshot commit/path referenced there.
3. Fresh-read Project Directory and `v45/factory-control`.
4. Fresh-read the active provider surfaces named by the snapshot.
5. Continue the listed next atomic action if still valid; otherwise emit a new snapshot with the reconciled facts.

## Mandatory durable logging contract

After every **material evidence delta**, publish a new append-only snapshot and advance only `CURRENT.json`.

Material delta includes at least:

- canonical checkpoint/run transition;
- provider commit/PR exact-head change that changes execution state;
- test/verifier verdict;
- discovered live runtime path or principal;
- deploy/restart/rollback/readback;
- blocker resolution/new blocker;
- orphan/effect classification;
- reboot/crash/disconnect fault-test result;
- Mission/Policy/controller revision change.

Do **not** publish a duplicate snapshot when the durable fingerprint is unchanged.

Each snapshot must contain:

- Project/Mission/Policy/controller identities;
- canonical checkpoint/run;
- current provider heads;
- live runtime facts and evidence level;
- verified completed work;
- invalidated/superseded claims;
- blockers/unresolved effects;
- exactly one next action;
- Human-reserved gates.

Every snapshot is fixed by its Git commit SHA. `CURRENT.json` is only a mutable locator to the newest immutable snapshot.
