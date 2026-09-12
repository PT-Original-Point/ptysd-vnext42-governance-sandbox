# VNEXT4.5 execution baseline

Status: human-approved construction baseline for `CHATGPT_GLOBAL_SKILL_GOVERNANCE`.

Source artifact SHA-256: `150a04b802847e4e92f096ced09d5a5e2a3fbbb1a84416c564ef53f1bb00feca`.

Runtime architecture identifier: `GITHUB_ACTIONS_BOUNDED_V1`.

The human explicitly selected existing GitHub repository ID `1352411536` (`PT-Original-Point/ptysd-vnext42-governance-sandbox`) to replace the earlier Z2 private-target prerequisite. No new repository is created merely to satisfy naming. Provider rename remains pending because the connected GitHub administration surface lacks repository-rename capability; the approved target name is `ptysd-vnext45-governance-sandbox`.

Z2 boundaries:
- one approved self-hosted runner only;
- workflow is bounded and synthetic before real worker/model execution;
- GitHub Hosted Runner is forbidden;
- workflow token is read-only and checkout credentials are not retained;
- business projects, Production and provider writes are excluded;
- zero incremental paid cost remains mandatory.

Control-state layout follows the V4.5 plan: remote Git contains the authoritative bounded control record and `runs/<run_id>/run.json`; receipts and later operations must be committed with the state transition they prove. A local worktree is never a durable checkpoint until remote ref/tree readback succeeds.

Current first run: `V45-Z2-SYNTHETIC-001`, state `WAITING_RESOURCE`, waiting for the approved self-hosted runner registration.
