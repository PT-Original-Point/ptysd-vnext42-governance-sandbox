# PTYSD Autonomy Supervisor — R4-04 candidate

Purpose: remove Codex UI goals and OpenAI Scheduled Watch from the liveness-critical path.

`PTYSD-Autonomy-Supervisor-V50` is a liveness client, not a Mission/task authority. It stores only local provider fingerprint, process/tick/result metadata and bounded logs under `C:\ProgramData\PTYSD\AutonomySupervisor`.

Each tick fresh-reads GitHub provider heads/mailbox state, computes a durable fingerprint and invokes `codex exec --json --full-auto` non-interactively only when a new actionable fingerprint exists or one bounded retry is allowed.

Safety properties:
- single local file lock and Scheduled Task `IgnoreNew`;
- bounded execution time and kill-on-timeout;
- same fingerprint finite retry budget;
- JSONL must contain `turn.completed`; outer process exit code alone is not treated as success;
- STOP file provides a reversible local stop;
- the Codex bootstrap prompt re-resolves Project Directory/canonical state and does not become authority;
- Mission/Production/cost/legal/OAuth/UNKNOWN-effect rules remain controller-owned.

Live acceptance is separate: prove SYSTEM/current-user Codex authentication, reboot survival, crash restart, duplicate-wake no duplicate effect, unchanged-fingerprint finite no-op, provider-first recovery, and operation with OpenAI Watch disabled.

Do not claim live PASS until installed and tested on DESKTOP-1B6PD2P.

## Continuity projection

Every supervisor-started Codex run must read `governance/continuity/CURRENT.json` and its immutable snapshot before normal work, then fresh-read canonical/provider state. After a material evidence delta it must append a new snapshot and advance only `CURRENT.json`. Unchanged durable fingerprint means no duplicate snapshot. The projection is never canonical authority.
