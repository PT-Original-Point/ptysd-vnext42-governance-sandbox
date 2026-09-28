# CONTINUITY — READ THIS FIRST

For `CHATGPT_GLOBAL_SKILL_GOVERNANCE` / 全自動軟體工廠:

1. Read `governance/continuity/CURRENT.json`.
2. Read the exact immutable snapshot commit/path it references.
3. Fresh-read Project Directory and `v45/factory-control`.
4. Fresh-read provider/runtime state named by the snapshot.
5. Continue the current valid next action; on any material evidence delta append a new snapshot and advance `CURRENT.json`.

This is a durable handoff projection, **not** a second canonical control plane. Provider/canonical truth wins on mismatch.
