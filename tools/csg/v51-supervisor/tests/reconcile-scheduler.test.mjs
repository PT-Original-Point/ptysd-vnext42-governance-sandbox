import test from 'node:test';
import assert from 'node:assert/strict';
import {durableFingerprint} from '../lib/fingerprint.mjs';
import {mayDispatch, selectNextUnit} from '../lib/scheduler.mjs';
import {reconcileOnWake, validateCanonicalSnapshot} from '../lib/reconcile.mjs';

const sha = (char) => `sha256:${char.repeat(64)}`;
const oid = (char) => char.repeat(40);

function fingerprintInput() {
  return {
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    current_spec: {revision: 'VNEXT5.1-R2', digest: sha('a')},
    mission: {revision: '20260930T104733+0800', digest: sha('b')},
    logical_unit_id: 'C7_SUPERVISOR_RECONCILIATION',
    acceptance_contract: {id: 'R2-07', digest: sha('c')},
    canonical_prestate: {
      control_ref: 'refs/heads/v45/factory-control',
      control_head: oid('d'),
      pointer_blob_oid: oid('e'),
      checkpoint_seq: 200,
      checkpoint_digest: sha('f')
    },
    upstream_inputs: [
      {id: 'factory-mcp', provider: 'GitHub', resource: 'PR381', revision: oid('1'), digest: sha('1')},
      {id: 'runtime', provider: 'GitHub', resource: 'PR377', revision: oid('2'), digest: sha('2')}
    ]
  };
}

function canonicalSnapshot() {
  const mission = {mission_revision_id: 'M1', mission_hash: sha('1')};
  const policy = {policy_revision_id: 'P1', policy_hash: sha('2')};
  const run = {path: 'runs/run.json', run_id: 'RUN1', active_task_id: 'TASK1',
    attempt_id: 'ATTEMPT1', attempt_epoch: 2, execution_owner: null, stop_requested: false,
    unresolved_operation_ids: []};
  const checkpoint = {
    path: 'checkpoints/000200.json', checkpoint_seq: 200, payload_digest: sha('3'),
    lifecycle: 'ACTIVE', recorded_at: '2026-09-30T02:52:35Z', owner: null, stop_requested: false,
    mission_anchor: {revision: 'M1', declared_hash: sha('1')},
    policy_anchor: {revision: 'P1', declared_hash: sha('2')},
    run_ref: {path: 'runs/run.json'}, task_id: 'TASK1', attempt_id: 'ATTEMPT1', attempt_epoch: 2,
    unresolved_effect_refs: []
  };
  const directory = {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', directory_revision: 5,
    control_locator: {ref: 'refs/heads/v45/factory-control', current_path: 'governance/csg/current.json'}};
  const pointer = {ref: 'refs/heads/v45/factory-control', path: 'governance/csg/current.json',
    control_head: oid('4'), checkpoint_seq: 200, checkpoint_path: 'checkpoints/000200.json', checkpoint_digest: sha('3')};
  return {project_directory: directory, pointer, mission, policy, checkpoint, run};
}

test('logical fingerprint excludes candidate output SHA, reviewer state, session, and checkpoint-only rollover', () => {
  const input = fingerprintInput();
  const before = durableFingerprint(input).digest;
  const derived = {...input, candidate_output_sha: oid('9'), candidate_head_sha: oid('8'),
    reviewer_status: 'PENDING', session_id: 'SESSION-OLD', checkpoint_rollover_only: 201};
  assert.equal(durableFingerprint(derived).digest, before);
});

test('logical fingerprint changes when canonical prestate or a true upstream input changes', () => {
  const input = fingerprintInput();
  const base = durableFingerprint(input).digest;
  const prestate = structuredClone(input);
  prestate.canonical_prestate.checkpoint_seq = 201;
  prestate.canonical_prestate.checkpoint_digest = sha('7');
  assert.notEqual(durableFingerprint(prestate).digest, base);
  const source = structuredClone(input);
  source.upstream_inputs[0].revision = oid('8');
  source.upstream_inputs[0].digest = sha('8');
  assert.notEqual(durableFingerprint(source).digest, base);
});

test('upstream input order does not reset the logical fingerprint', () => {
  const input = fingerprintInput();
  const reversed = structuredClone(input);
  reversed.upstream_inputs.reverse();
  assert.equal(durableFingerprint(input).digest, durableFingerprint(reversed).digest);
});

test('lane-local WAITING_EXTERNAL does not block another READY lane', () => {
  assert.deepEqual(selectNextUnit([
    {id: 'C1_LIVE_LIVENESS', state: 'WAITING_EXTERNAL', priority: 1},
    {id: 'C7_LOCAL_SUPERVISOR_SOURCE', state: 'READY', priority: 5}
  ]), {decision: 'CONTINUE_READY', unit: 'C7_LOCAL_SUPERVISOR_SOURCE'});
});

test('expired or unknown execution-owner authority parks only its RUNNING lane', () => {
  assert.deepEqual(selectNextUnit([
    {id: 'R2-02', state: 'RUNNING', owner_authority: 'EXPIRED'},
    {id: 'C8', state: 'READY'}
  ]), {decision: 'CONTINUE_READY', unit: 'C8'});
  assert.equal(selectNextUnit([
    {id: 'R2-02', state: 'RUNNING', owner_authority: 'UNKNOWN'}
  ]).decision, 'WAITING_EXTERNAL_NO_READY');
});

test('unknown effects cannot enter the bounded retry lane', () => {
  assert.equal(selectNextUnit([
    {id: 'OP-UNKNOWN', state: 'FAILED_RETRYABLE', retry_allowed: true, retry_budget_remaining: 2,
      effect_status: 'UNKNOWN'}
  ]).decision, 'NO_LEGAL_ACTION');
  assert.deepEqual(selectNextUnit([
    {id: 'RETRY-BOUNDED', state: 'FAILED_RETRYABLE', retry_allowed: true,
      retry_budget_remaining: 1, effect_status: 'NOT_APPLIED'}
  ]), {decision: 'RETRY_BOUNDED', unit: 'RETRY-BOUNDED'});
});

test('two valid running owners for one mutable slice are an invariant violation', () => {
  assert.equal(selectNextUnit([
    {id: 'A', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'slice-a'},
    {id: 'B', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'slice-a'}
  ]).decision, 'INVARIANT_VIOLATION');
});

test('independent mutable slices can continue asynchronously within the provider capacity', () => {
  assert.deepEqual(selectNextUnit([
    {id: 'builder-running', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'source-a'},
    {id: 'reviewer-running', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'review-b'},
    {id: 'source-c', state: 'READY', mutable_scope: 'source-c', priority: 3},
    {id: 'integration', state: 'READY', mutable_scope: 'project-integration', integration_lane: true, priority: 4}
  ], {max_concurrency: 4}), {
    decision: 'CONTINUE_READY', unit: 'source-c', running_units: ['builder-running', 'reviewer-running']
  });
});

test('a running slice serializes an unscoped READY unit and returns to polling', () => {
  assert.deepEqual(selectNextUnit([
    {id: 'running', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'source-a'},
    {id: 'ambiguous-ready', state: 'READY'}
  ], {max_concurrency: 4}), {
    decision: 'KEEP_RUNNING', units: ['running'], concurrency_limit: 4
  });
});

test('scheduler does not exceed the bounded active-worker capacity', () => {
  assert.deepEqual(selectNextUnit([
    {id: 'a', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'a'},
    {id: 'b', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'b'},
    {id: 'c', state: 'READY', mutable_scope: 'c'}
  ], {max_concurrency: 2}), {
    decision: 'KEEP_RUNNING', units: ['a', 'b'], concurrency_limit: 2
  });
});

test('only one valid owner may use the project integration lane', () => {
  assert.equal(selectNextUnit([
    {id: 'integration-a', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'integration-a', integration_lane: true},
    {id: 'integration-b', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'integration-b', integration_lane: true}
  ], {max_concurrency: 4}).reason, 'MULTIPLE_VALID_PROJECT_INTEGRATION_OWNERS');
});

test('an active integration lane does not block independent source construction', () => {
  assert.deepEqual(selectNextUnit([
    {id: 'integration-running', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'integration', integration_lane: true},
    {id: 'source-ready', state: 'READY', mutable_scope: 'source', priority: 1},
    {id: 'integration-ready', state: 'READY', mutable_scope: 'integration-next', integration_lane: true, priority: 2}
  ], {max_concurrency: 4}), {
    decision: 'CONTINUE_READY', unit: 'source-ready', running_units: ['integration-running']
  });
});

test('concurrency capacity is an explicit small positive integer', () => {
  assert.throws(() => selectNextUnit([], {max_concurrency: 5}), {code: 'INVALID_MAX_CONCURRENCY'});
});

test('dispatch stays fail-closed for stale authority, related unknown effects, Host mutation, and Production', () => {
  const base = {canonical_state_fresh: true, mission_lifecycle: 'ACTIVE', stop_requested: false,
    unresolved_effect_refs: []};
  const lane = {state: 'READY', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']};
  assert.deepEqual(mayDispatch(lane, {...base, canonical_state_fresh: false}),
    {allowed: false, reason: 'CANONICAL_READ_REQUIRED'});
  assert.deepEqual(mayDispatch({...lane, requires_effect_readback: true, related_effect_refs: ['op-1']},
    {...base, unresolved_effect_refs: ['op-1']}),
    {allowed: false, reason: 'UNKNOWN_EFFECT_READBACK_REQUIRED'});
  assert.deepEqual(mayDispatch({...lane, requires_host_mutation: true}, base),
    {allowed: false, reason: 'HOST_MUTATION_NOT_AUTHORIZED'});
  assert.deepEqual(mayDispatch({state: 'READY', production: true},
    base),
  {allowed: false, reason: 'PRODUCTION_HUMAN_GATE'});
  assert.deepEqual(mayDispatch({...lane, worker_provider_write_capability: true}, base),
    {allowed: false, reason: 'WORKER_PROVIDER_WRITE_CAPABILITY_FORBIDDEN'});
  assert.deepEqual(mayDispatch({...lane, state: 'FAILED_RETRYABLE', retry_allowed: true,
    retry_budget_remaining: 1, effect_status: 'NOT_APPLIED'}, base),
    {allowed: true, reason: 'READY_AND_AUTHORIZED'});
  assert.deepEqual(mayDispatch({...lane, state: 'FAILED_RETRYABLE', retry_allowed: true,
    retry_budget_remaining: 0, effect_status: 'NOT_APPLIED'}, base),
    {allowed: false, reason: 'UNIT_NOT_READY_OR_BOUNDED_RETRY_NOT_AUTHORIZED'});
  assert.deepEqual(mayDispatch({...lane, requires_effect_readback: true, related_effect_refs: ['op-2']},
    {...base, unresolved_effect_refs: ['op-1']}),
    {allowed: true, reason: 'READY_AND_AUTHORIZED'});
  assert.deepEqual(mayDispatch({...lane, requires_effect_readback: true, related_effect_refs: ['op-1']},
    {...base, unresolved_effect_refs: [{operation_id: 'op-1'}]}),
    {allowed: false, reason: 'UNKNOWN_EFFECT_READBACK_REQUIRED'});
  assert.deepEqual(mayDispatch({...lane, requires_effect_readback: true, related_effect_refs: ['op-2']},
    {...base, unresolved_effect_refs: [{operation_id: 'op-1'}]}),
    {allowed: true, reason: 'READY_AND_AUTHORIZED'});
});

test('checkpoint, task, attempt, and owner-generation rollover metadata is not a transport gate', () => {
  const unit = {state: 'READY', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']};
  const first = {canonical_state_fresh: true, mission_lifecycle: 'ACTIVE', stop_requested: false,
    checkpoint_seq: 200, mission_revision: 'M1', task_id: 'T1', attempt_id: 'A1', attempt_epoch: 1,
    owner_generation: 5, unresolved_effect_refs: []};
  const rolled = {...first, checkpoint_seq: 201, mission_revision: 'M2', task_id: 'T2', attempt_id: 'A2',
    attempt_epoch: 7, owner_generation: 12};
  assert.deepEqual(mayDispatch(unit, rolled), mayDispatch(unit, first));
  assert.equal(mayDispatch(unit, rolled).allowed, true);
});

test('canonical snapshot must bind Project Directory, pointer, checkpoint, Mission, Policy, and attempt', () => {
  assert.equal(validateCanonicalSnapshot(canonicalSnapshot()).checkpoint_seq, 200);
  const bad = canonicalSnapshot();
  bad.checkpoint.attempt_epoch = 3;
  assert.throws(() => validateCanonicalSnapshot(bad), {code: 'CHECKPOINT_RUN_ATTEMPT_BINDING_MISMATCH'});
});

test('owner lease expiry uses a trusted clock and never infers process liveness or revokes authority', () => {
  const snapshot = canonicalSnapshot();
  const owner = {principal_id: 'worker-1', owner_generation: 5, scope: 'unit-1',
    lease_until: '2026-09-29T18:44:11Z'};
  snapshot.checkpoint.owner = owner;
  snapshot.run.execution_owner = owner;

  const untrusted = validateCanonicalSnapshot(snapshot);
  assert.equal(untrusted.owner_authority, 'UNKNOWN');
  assert.equal(untrusted.owner_lease_status, 'UNKNOWN');
  assert.equal(untrusted.owner_process_liveness, 'UNKNOWN');

  const trustedClock = {trusted: true, source: 'fixture:verified-provider-time',
    observed_at_utc: '2026-10-03T00:00:00Z', uncertainty_seconds: 2};
  const expired = validateCanonicalSnapshot(snapshot, {trustedClock});
  assert.equal(expired.owner_authority, 'EXPIRED');
  assert.equal(expired.owner_lease_status, 'DEFINITELY_EXPIRED');
  assert.equal(expired.owner_process_liveness, 'UNKNOWN');

  const activeOwner = {...owner, lease_until: '2026-10-03T00:00:10Z'};
  snapshot.checkpoint.owner = activeOwner;
  snapshot.run.execution_owner = activeOwner;
  const liveLease = validateCanonicalSnapshot(snapshot, {trustedClock});
  assert.equal(liveLease.owner_authority, 'UNKNOWN');
  assert.equal(liveLease.owner_lease_status, 'NOT_EXPIRED');
  assert.equal(liveLease.owner_process_liveness, 'UNKNOWN');

  const boundaryOwner = {...owner, lease_until: '2026-10-03T00:00:01Z'};
  snapshot.checkpoint.owner = boundaryOwner;
  snapshot.run.execution_owner = boundaryOwner;
  const boundary = validateCanonicalSnapshot(snapshot, {trustedClock});
  assert.equal(boundary.owner_authority, 'UNKNOWN');
  assert.equal(boundary.owner_lease_status, 'CLOCK_SKEW_BOUNDARY');
});

test('a scheduled wake ignores stale action fields, rereads authority, and recomputes READY', async () => {
  const events = [];
  const snapshot = canonicalSnapshot();
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1',
    phase: 'V5.0-R3', task_id: 'OLD_TASK', next_action: 'REDISPATCH_OLD_EFFECT'}, {
    async readProjectDirectory(locator) { events.push(['directory', locator]); return snapshot.project_directory; },
    async readCurrentPointer(locator) { events.push(['pointer', locator]); return snapshot.pointer; },
    async readCanonicalSnapshot(directory, pointer) {
      events.push(['canonical', directory.project_id, pointer.checkpoint_seq]);
      return snapshot;
    },
    async readLiveObservation() { events.push(['live']); return {status: 'UNAVAILABLE', reason: 'NO_PROVIDER_ROUTE'}; },
    async recomputeReady(input) {
      events.push(['ready', input.authority.checkpoint_seq, input.liveObservation.status]);
      return {units: [
        {id: 'C1', state: 'WAITING_EXTERNAL', priority: 1},
        {id: 'C7', state: 'READY', priority: 2,
          execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']}
      ], recomputed_at: '2026-10-02T00:00:00Z'};
    },
    async appendLocalEvidence(evidence) {
      events.push(['persist', evidence.read_order.at(-1)]);
      return {durable: true, id: 'local-receipt-1'};
    }
  });

  assert.deepEqual(events.map(([name]) => name), ['directory', 'pointer', 'canonical', 'live', 'ready', 'persist']);
  assert.equal(result.readiness.selected.unit, 'C7');
  assert.deepEqual(result.stale_wake_fields_ignored, ['next_action', 'phase', 'task_id']);
  assert.equal(result.side_effects.host_dispatch, false);
  assert.equal(result.mission_lifecycle_changed, false);
  assert.equal(result.execution_allowed, false);
});

test('fresh reconciliation uses the bounded provider capacity for disjoint READY work', async () => {
  const snapshot = canonicalSnapshot();
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ', owner_authority: 'NONE'}; },
    async recomputeReady() { return {max_concurrency: 4, units: [
      {id: 'builder-active', state: 'RUNNING', owner_authority: 'VALID', mutable_scope: 'source-a'},
      {id: 'independent-source', state: 'READY', mutable_scope: 'source-b', priority: 1,
        execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']}
    ]}; },
    async appendLocalEvidence() { return {durable: true, id: 'durable-receipt'}; }
  });
  assert.equal(result.readiness.max_concurrency, 4);
  assert.deepEqual(result.readiness.selected, {
    decision: 'CONTINUE_READY', unit: 'independent-source', running_units: ['builder-active']
  });
  assert.equal(result.execution.status, 'DISPATCHER_NOT_CONFIGURED');
  assert.equal(result.side_effects.local_work_dispatch, false);
});

test('a higher-priority lane denied by its dispatch gate does not hide safe READY work', async () => {
  const snapshot = canonicalSnapshot();
  const dispatched = [];
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ', owner_authority: 'NONE'}; },
    async recomputeReady() { return {logical_work_fingerprint: sha('c'), units: [
      {id: 'host-mutation-lane', state: 'READY', priority: 1, mutable_scope: 'host',
        execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_SOURCE_WRITE'], requires_host_mutation: true},
      {id: 'safe-source-lane', state: 'READY', priority: 2, mutable_scope: 'source-b',
        execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']}
    ]}; },
    async appendLocalEvidence() { return {durable: true, id: 'pre-dispatch-receipt'}; },
    async readLocalWork(input) { return {status: 'NOT_FOUND_CONFIRMED', idempotency_key: input.idempotency_key}; },
    async dispatchLocalWork(input) {
      dispatched.push(input.unit.id);
      return {status: 'STARTED', idempotency_key: input.idempotency_key};
    }
  });
  assert.equal(result.readiness.selected.unit, 'safe-source-lane');
  assert.deepEqual(result.readiness.schedulable_units.map((unit) => [unit.id, unit.state]), [
    ['host-mutation-lane', 'WAITING_EXTERNAL'], ['safe-source-lane', 'READY']
  ]);
  assert.deepEqual(result.readiness.dispatch_assessments, [
    {unit: 'host-mutation-lane', allowed: false, reason: 'HOST_MUTATION_NOT_AUTHORIZED'},
    {unit: 'safe-source-lane', allowed: true, reason: 'READY_AND_AUTHORIZED'}
  ]);
  assert.deepEqual(dispatched, ['safe-source-lane']);
  assert.equal(result.execution_allowed, true);
  assert.equal(result.side_effects.host_mutation, false);
});

test('a dispatch-gated lane remains parked and receives no local launch', async () => {
  const snapshot = canonicalSnapshot();
  let dispatches = 0;
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ'}; },
    async recomputeReady() { return {units: [{id: 'production-lane', state: 'READY',
      production: true, execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']}]}; },
    async appendLocalEvidence() { return {durable: true, id: 'parked-lane-receipt'}; },
    async dispatchLocalWork() { dispatches++; return {status: 'STARTED'}; }
  });
  assert.equal(result.readiness.selected.decision, 'WAITING_EXTERNAL_NO_READY');
  assert.equal(result.readiness.schedulable_units[0].state, 'WAITING_HUMAN');
  assert.equal(result.readiness.dispatch_assessments[0].reason, 'PRODUCTION_HUMAN_GATE');
  assert.equal(dispatches, 0);
  assert.equal(result.execution_allowed, false);
  assert.equal(result.mission_lifecycle_changed, false);
});

test('a wake never claims durable evidence when its local append receipt is missing', async () => {
  const snapshot = canonicalSnapshot();
  const ports = {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ'}; },
    async recomputeReady() { return {units: [{id: 'C7', state: 'READY'}]}; },
    async appendLocalEvidence() { return {durable: false}; }
  };
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, ports);
  assert.equal(result.persistence.status, 'FAILED');
  assert.equal(result.execution_allowed, false);
});

test('a READY local lane proceeds after durable evidence despite an unrelated parked lane and effect', async () => {
  const events = [];
  const snapshot = canonicalSnapshot();
  snapshot.checkpoint.unresolved_effect_refs = ['unrelated-op'];
  snapshot.run.unresolved_operation_ids = ['unrelated-op'];
  const key = sha('a');
  const unit = {id: 'C7_LOCAL_SUPERVISOR_SOURCE', state: 'READY', priority: 5,
    execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_SOURCE_WRITE', 'LOCAL_TEST'],
    requires_effect_readback: true, related_effect_refs: ['c7-logical-work']};
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { events.push('directory'); return snapshot.project_directory; },
    async readCurrentPointer() { events.push('pointer'); return snapshot.pointer; },
    async readCanonicalSnapshot() { events.push('canonical'); return snapshot; },
    async readLiveObservation() { events.push('live'); return {status: 'READ'}; },
    async recomputeReady() { events.push('ready'); return {units: [
      {id: 'C1_LIVE', state: 'WAITING_EXTERNAL', priority: 1}, unit
    ], logical_work_fingerprint: key}; },
    async appendLocalEvidence(evidence) {
      events.push(`persist:${evidence.execution.status}`);
      return {durable: true, id: `receipt-${events.length}`};
    },
    async readLocalWork(input) {
      events.push('local-readback');
      assert.equal(input.idempotency_key, key);
      return {status: 'NOT_FOUND_CONFIRMED', idempotency_key: key};
    },
    async dispatchLocalWork(input) {
      events.push('local-dispatch');
      assert.equal(input.idempotency_key, key);
      return {status: 'STARTED', idempotency_key: key};
    }
  });
  assert.deepEqual(events, ['directory', 'pointer', 'canonical', 'live', 'ready', 'persist:NOT_DISPATCHED',
    'local-readback', 'local-dispatch', 'persist:STARTED']);
  assert.equal(result.execution.status, 'STARTED');
  assert.equal(result.execution_allowed, true);
  assert.equal(result.side_effects.host_dispatch, false);
  assert.equal(result.side_effects.host_mutation, false);
  assert.equal(result.side_effects.canonical_write, false);
  assert.equal(result.side_effects.local_work_dispatch, true);
});

test('unknown local dispatch is durably recorded and requires exact readback before any retry', async () => {
  const snapshot = canonicalSnapshot();
  const key = sha('b');
  const unit = {id: 'C7_LOCAL_TEST', state: 'READY', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE',
    effects: ['LOCAL_TEST']};
  let dispatchCount = 0;
  const events = [];
  const common = {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ'}; },
    async recomputeReady() { return {units: [unit], logical_work_fingerprint: key}; },
    async appendLocalEvidence(evidence) {
      events.push(evidence.execution.status);
      return {durable: true, id: `receipt-${events.length}`};
    }
  };
  const first = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    ...common,
    async readLocalWork() { return {status: 'NOT_FOUND_CONFIRMED', idempotency_key: key}; },
    async dispatchLocalWork() {
      dispatchCount++;
      return {status: 'UNKNOWN_EFFECT', idempotency_key: key};
    }
  });
  const second = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    ...common,
    async readLocalWork() { return {status: 'UNKNOWN', idempotency_key: key}; },
    async dispatchLocalWork() { dispatchCount++; return {status: 'STARTED', idempotency_key: key}; }
  });
  assert.equal(first.execution.status, 'UNKNOWN_EFFECT_READBACK_REQUIRED');
  assert.equal(first.persistence.status, 'DURABLE_LOCAL_PROJECTION');
  assert.equal(second.execution.status, 'UNKNOWN_EFFECT_READBACK_REQUIRED');
  assert.equal(second.execution_allowed, false);
  assert.equal(dispatchCount, 1);
  assert.ok(events.includes('UNKNOWN_EFFECT_READBACK_REQUIRED'));
});

test('local work readback identity mismatch blocks dispatch', async () => {
  const snapshot = canonicalSnapshot();
  const key = sha('c');
  let dispatchCount = 0;
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ'}; },
    async recomputeReady() { return {units: [{id: 'C7', state: 'READY', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE',
      effects: ['LOCAL_TEST']}], logical_work_fingerprint: key}; },
    async appendLocalEvidence() { return {durable: true, id: 'receipt'}; },
    async readLocalWork() { return {status: 'NOT_FOUND_CONFIRMED', idempotency_key: sha('d')}; },
    async dispatchLocalWork() { dispatchCount++; return {status: 'STARTED', idempotency_key: key}; }
  });
  assert.equal(result.execution.status, 'UNKNOWN_EFFECT_READBACK_REQUIRED');
  assert.equal(result.execution_allowed, false);
  assert.equal(dispatchCount, 0);
});

test('a confirmed non-applied local dispatch requires a bounded retry lane before repeating', async () => {
  const snapshot = canonicalSnapshot();
  const key = sha('e');
  let dispatchCount = 0;
  const unit = {id: 'C7_LOCAL_TEST', state: 'READY', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE',
    effects: ['LOCAL_TEST']};
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ'}; },
    async recomputeReady() { return {units: [unit], logical_work_fingerprint: key}; },
    async appendLocalEvidence() { return {durable: true, id: 'receipt'}; },
    async readLocalWork() { return {status: 'NOT_APPLIED_CONFIRMED', idempotency_key: key}; },
    async dispatchLocalWork() { dispatchCount++; return {status: 'STARTED', idempotency_key: key}; }
  });
  assert.equal(result.execution.status, 'NOT_APPLIED_REQUIRES_BOUNDED_RETRY');
  assert.equal(result.execution_allowed, false);
  assert.equal(dispatchCount, 0);
});

test('a bounded retry dispatches only after exact NOT_APPLIED readback', async () => {
  const snapshot = canonicalSnapshot();
  const key = sha('f');
  let dispatchCount = 0;
  const unit = {id: 'C7_RETRY', state: 'FAILED_RETRYABLE', retry_allowed: true,
    retry_budget_remaining: 1, effect_status: 'NOT_APPLIED', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE',
    effects: ['LOCAL_TEST']};
  const result = await reconcileOnWake({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'}, {
    async readProjectDirectory() { return snapshot.project_directory; },
    async readCurrentPointer() { return snapshot.pointer; },
    async readCanonicalSnapshot() { return snapshot; },
    async readLiveObservation() { return {status: 'READ'}; },
    async recomputeReady() { return {units: [unit], logical_work_fingerprint: key}; },
    async appendLocalEvidence() { return {durable: true, id: 'receipt'}; },
    async readLocalWork(input) {
      assert.equal(input.idempotency_key, key);
      return {status: 'NOT_APPLIED_CONFIRMED', idempotency_key: key};
    },
    async dispatchLocalWork(input) {
      dispatchCount++;
      assert.equal(input.idempotency_key, key);
      return {status: 'STARTED', idempotency_key: key};
    }
  });
  assert.equal(result.execution.status, 'STARTED');
  assert.equal(result.execution_allowed, true);
  assert.equal(dispatchCount, 1);
});
