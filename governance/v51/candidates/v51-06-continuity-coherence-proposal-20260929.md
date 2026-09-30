# V51-06 Canonical Continuity Coherence — Noncanonical Candidate

**Classification:** LOCAL/NONCANONICAL proposal backed by exact provider readback. It does not update canonical refs, Mission, Policy, Host, or execution authority.

## Finding

The Project Directory revision 5 resolves to the current pointer on `v45/factory-control`. That pointer selects CP192. CP192 identifies task `R3-P0-03-FACTORY-ORPHAN-RECONCILIATION`, attempt `V50-R3-P0-03-ATTEMPT-001`, epoch 1.

CP192's immutable `run_ref` resolves to commit `1ad3e192941ed3db63a2c605c8c2a72251d4523e`. That run and its contract identify task `R3-P0-01-CANONICAL-CONTINUITY-REBASE` and attempt `V50-R3-P0-01-ATTEMPT-001`, epoch 1. The task and attempt identities disagree; the epoch matches. The run also reports `RUNNING` while CP192's atomic state is `PREPARED_NOT_DISPATCHED`; the meaning of those separate state fields is unresolved.

## Bounded reconciliation design

1. Keep CP192 as the current canonical checkpoint until a separately authorized provider transition is accepted.
2. Do not mint a new run ID, task ID, attempt ID, or epoch to hide the mismatch. Any proposed run/contract correction must use the task and attempt already recorded in CP192 and preserve the Mission and EP72 hashes.
3. Do not change run-state, wait-reason, or checkpoint-reference field semantics until an authoritative `factory.run.v1` / `factory.contract.v1` schema or reader contract is identified. The current control's targeted `schemas/` listing contains a checkpoint schema and a V4.7 contract schema, but no applicable V1 run/contract schema.
4. If review establishes the exact schema, construct immutable corrected run/contract bytes first. The corrected run must resolve to the already-current CP192 identity. A subsequent proposed CP193 must point to that immutable run and to CP192 as its predecessor. Keep the reference graph acyclic and retain the run commit by an immutable provider-addressable reference.
5. Update the current pointer only in a separately authorized compare-and-swap transition from exact control head `a5ebfd86d440b61ecc4e4dc3ba7b8291836769c7`, followed by same-source readback.

CP192's `execution_fence` remains null. This proposal does not create or arm CP192/JIT, authorize Host mutation, change the four-tool surface, alter Production or business gates, or redispatch OP025.

## Review questions

- What authoritative schema/reader defines `factory.run.v1` and `factory.contract.v1` on the current control path?
- Does `RUNNING` describe the encompassing run while `PREPARED_NOT_DISPATCHED` describes its current atomic unit, or is that another state inconsistency?
- Which exact fields are the current task/attempt identity, and which fields are historical command metadata?
- What is the minimum valid acyclic immutable reference layout that preserves a direct-parent CP transition?

## Acceptance evidence required later

- Same-source readback proves Directory → current pointer → checkpoint → run → contract resolves to one task/attempt identity.
- Task ID, attempt ID, and epoch agree across the authoritative checkpoint, run, and contract.
- Existing Mission/Policy hashes, null execution fence, and all CP192 forbidden actions remain unchanged until separately authorized.
- A continuity projection deletion/rebuild does not alter the canonical resolution.
- No snapshot, mailbox, worklog, prompt, or report becomes a second authority.

**No tests or canonical updates are claimed by this proposal.**

