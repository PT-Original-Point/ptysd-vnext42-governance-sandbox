import { createHash } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail = (code, detail = '') => { throw new Error(detail ? `${code}:${detail}` : code); };
const copy = value => structuredClone(value);
const reqId = (value, name) => { if (typeof value !== 'string' || !ID_RE.test(value)) fail(`INVALID_${name}`); return value; };
const reqEpoch = value => { if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_ATTEMPT_EPOCH'); return value; };
const reqEffects = value => { if (!Array.isArray(value)) fail('INVALID_UNRESOLVED_EFFECT_REFS'); return value.map((v, i) => reqId(v, `EFFECT_REF_${i}`)); };
const tokenId = (cellId, attemptId, epoch, seq) => `act_${createHash('sha256').update(`${cellId}\0${attemptId}\0${epoch}\0${seq}`).digest('hex').slice(0, 32)}`;
const candidateId = (cellId, attemptId, epoch, revision) => `cmp_${createHash('sha256').update(`${cellId}\0${attemptId}\0${epoch}\0${revision}`).digest('hex').slice(0, 32)}`;

function assertCurrent(state, attemptId, attemptEpoch) {
  if (attemptId !== state.attempt_id) fail('STALE_ATTEMPT');
  if (attemptEpoch !== state.attempt_epoch) fail('STALE_EPOCH');
}

function assertOpen(state) {
  if (state.state === 'COMPLETED') fail('COMPLETION_TERMINAL');
  if (state.state === 'RECOVERY_REQUIRED') fail('RECOVERY_REQUIRED');
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('INVALID_SNAPSHOT');
  const state = {
    schema: 'v48.activity-fence.v1',
    cell_id: reqId(snapshot.cell_id, 'CELL_ID'),
    attempt_id: reqId(snapshot.attempt_id, 'ATTEMPT_ID'),
    attempt_epoch: reqEpoch(snapshot.attempt_epoch),
    state: snapshot.state ?? 'ACTIVE',
    activity_revision: Number.isSafeInteger(snapshot.activity_revision) && snapshot.activity_revision >= 0 ? snapshot.activity_revision : 0,
    active_lease_count: Number.isSafeInteger(snapshot.active_lease_count) && snapshot.active_lease_count >= 0 ? snapshot.active_lease_count : 0,
    next_activity_seq: Number.isSafeInteger(snapshot.next_activity_seq) && snapshot.next_activity_seq >= 1 ? snapshot.next_activity_seq : 1,
    leases: new Map(),
    completion_candidate: snapshot.completion_candidate ? copy(snapshot.completion_candidate) : null,
    completed_at_revision: snapshot.completed_at_revision ?? null,
  };
  if (!['ACTIVE', 'COMPLETED', 'RECOVERY_REQUIRED'].includes(state.state)) fail('INVALID_STATE');
  for (const lease of snapshot.leases ?? []) {
    reqId(lease.token, 'LEASE_TOKEN');
    if (!['ACTIVE', 'SETTLED'].includes(lease.status)) fail('INVALID_LEASE_STATUS');
    state.leases.set(lease.token, copy(lease));
  }
  const counted = [...state.leases.values()].filter(x => x.status === 'ACTIVE').length;
  if (counted !== state.active_lease_count) fail('LEASE_COUNT_MISMATCH');
  return state;
}

function exportSnapshot(state) {
  return {
    schema: state.schema,
    cell_id: state.cell_id,
    attempt_id: state.attempt_id,
    attempt_epoch: state.attempt_epoch,
    state: state.state,
    activity_revision: state.activity_revision,
    active_lease_count: state.active_lease_count,
    next_activity_seq: state.next_activity_seq,
    leases: [...state.leases.values()].map(copy),
    completion_candidate: state.completion_candidate ? copy(state.completion_candidate) : null,
    completed_at_revision: state.completed_at_revision,
  };
}

export function createActivityFence({ cell_id, attempt_id, attempt_epoch }) {
  return build(normalizeSnapshot({ cell_id, attempt_id, attempt_epoch, state: 'ACTIVE', activity_revision: 0, active_lease_count: 0, next_activity_seq: 1, leases: [] }));
}

export function restoreActivityFence(snapshot) {
  const state = normalizeSnapshot(snapshot);
  if (state.state !== 'COMPLETED' && state.completion_candidate) state.state = 'RECOVERY_REQUIRED';
  return build(state);
}

function build(state) {
  return {
    claim_activity(activity_id, { attempt_id = state.attempt_id, attempt_epoch = state.attempt_epoch } = {}) {
      assertOpen(state);
      assertCurrent(state, attempt_id, attempt_epoch);
      reqId(activity_id, 'ACTIVITY_ID');
      const token = tokenId(state.cell_id, state.attempt_id, state.attempt_epoch, state.next_activity_seq++);
      state.activity_revision += 1;
      state.active_lease_count += 1;
      const lease = { token, activity_id, attempt_id: state.attempt_id, attempt_epoch: state.attempt_epoch, claimed_revision: state.activity_revision, status: 'ACTIVE' };
      state.leases.set(token, lease);
      return copy({ token, activity_revision: state.activity_revision, active_lease_count: state.active_lease_count });
    },

    settle_activity(token, { attempt_id = state.attempt_id, attempt_epoch = state.attempt_epoch } = {}) {
      if (state.state === 'COMPLETED') fail('LATE_ACTIVITY_AFTER_COMPLETION');
      if (state.state === 'RECOVERY_REQUIRED') fail('RECOVERY_REQUIRED');
      assertCurrent(state, attempt_id, attempt_epoch);
      reqId(token, 'LEASE_TOKEN');
      const lease = state.leases.get(token);
      if (!lease) fail('LEASE_NOT_FOUND');
      if (lease.status !== 'ACTIVE') fail('LEASE_ALREADY_SETTLED');
      lease.status = 'SETTLED';
      state.active_lease_count -= 1;
      return copy({ token, activity_revision: state.activity_revision, active_lease_count: state.active_lease_count });
    },

    begin_completion({ attempt_id = state.attempt_id, attempt_epoch = state.attempt_epoch } = {}) {
      assertOpen(state);
      assertCurrent(state, attempt_id, attempt_epoch);
      const candidate = {
        candidate_id: candidateId(state.cell_id, state.attempt_id, state.attempt_epoch, state.activity_revision),
        attempt_id: state.attempt_id,
        attempt_epoch: state.attempt_epoch,
        remembered_activity_revision: state.activity_revision,
      };
      state.completion_candidate = candidate;
      return copy(candidate);
    },

    commit_completion(candidate, { attempt_id = state.attempt_id, attempt_epoch = state.attempt_epoch, unresolved_effect_refs = [] } = {}) {
      assertOpen(state);
      assertCurrent(state, attempt_id, attempt_epoch);
      const effects = reqEffects(unresolved_effect_refs);
      if (effects.length) fail('UNRESOLVED_EFFECTS_PRESENT');
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) fail('INVALID_COMPLETION_CANDIDATE');
      if (!state.completion_candidate || candidate.candidate_id !== state.completion_candidate.candidate_id) fail('COMPLETION_CANDIDATE_MISMATCH');
      assertCurrent(state, candidate.attempt_id, candidate.attempt_epoch);
      if (state.active_lease_count !== 0) fail('ACTIVE_LEASES_PRESENT');
      if (candidate.remembered_activity_revision !== state.activity_revision) fail('COMPLETION_REVISION_CHANGED');
      state.state = 'COMPLETED';
      state.completed_at_revision = state.activity_revision;
      return copy({ state: 'COMPLETED', candidate_id: candidate.candidate_id, activity_revision: state.activity_revision, active_lease_count: 0 });
    },

    snapshot() { return exportSnapshot(state); },
    status() { return copy({ state: state.state, activity_revision: state.activity_revision, active_lease_count: state.active_lease_count, completion_candidate: state.completion_candidate }); },
  };
}
