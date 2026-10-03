import assert from 'node:assert/strict';
import test from 'node:test';
import {reconcileOnWake} from '../lib/reconcile.mjs';

const sha = (letter) => `sha256:${letter.repeat(64)}`;
const oid = (letter) => letter.repeat(40);

const scenarios = [
  {name: 'clean idle'},
  {name: 'Builder running', running: {id: 'builder-running', mutable_scope: 'builder-slice'}},
  {name: 'Reviewer running', running: {id: 'reviewer-running', mutable_scope: 'review-slice'}},
  {name: 'owner lease expired', expiredOwner: true},
  {name: 'Agent UI closed', live: {agent_ui: 'CLOSED'}},
  {name: 'GPT Web gone', live: {gpt_web: 'UNAVAILABLE'}},
  {name: 'Supervisor restart', live: {supervisor_process: 'RESTARTED'}},
  {name: 'Windows reboot', live: {host_boot: 'CHANGED'}},
  {name: 'VM reboot', live: {vm_state: 'REBOOTED'}},
  {name: 'WAITING_EXTERNAL', parked: {id: 'live-route', reason: 'REMOTE_ROUTE_UNAVAILABLE'}},
  {name: 'provider quota 429', parked: {id: 'provider-read', reason: 'PROVIDER_RATE_LIMITED'}},
  {name: 'Muse 403', parked: {id: 'muse-builder', reason: 'MUSE_FORBIDDEN'}},
  {name: 'unknown side effect', unknownEffect: true},
  {name: 'orphan present', parked: {id: 'orphan-reconcile', reason: 'ORPHAN_IDENTITY_UNAVAILABLE'}, live: {orphan_count: 1}},
  {name: 'stale scheduled wake fires', staleWake: true},
  {name: 'Mission updated while worker is old', missionUpdated: true},
  {name: 'Policy updated while worker is old', policyUpdated: true},
  {name: 'deterministic test already PASS', deterministicPass: true},
  {name: 'provider readback unavailable', liveUnavailable: true},
  {name: 'integration conflict', integrationConflict: true}
];

function canonicalSnapshot(scenario) {
  const missionRevision = scenario.missionUpdated ? '20261002T120000+0800' : '20260930T104733+0800';
  const policyRevision = scenario.policyUpdated ? '20261002T120000+0800-EP89' : '20260930T104733+0800-EP80';
  const unresolved = scenario.unknownEffect ? ['effect-unknown'] : [];
  const owner = scenario.expiredOwner ? {
    principal_id: 'executor-old', owner_generation: 5,
    scope: 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION', lease_until: '2026-09-29T18:44:11Z'
  } : null;
  const directory = {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', directory_revision: 5,
    control_locator: {ref: 'refs/heads/v45/factory-control', current_path: 'governance/csg/current.json'}};
  const pointer = {project_id: directory.project_id, ref: directory.control_locator.ref,
    path: directory.control_locator.current_path, control_head: oid('d'), checkpoint_seq: 200,
    checkpoint_path: 'governance/csg/checkpoints/000200.json', checkpoint_digest: sha('a')};
  const mission = {mission_revision_id: missionRevision, mission_hash: sha('b')};
  const policy = {policy_revision_id: policyRevision, policy_hash: sha('c')};
  const checkpoint = {checkpoint_seq: 200, path: pointer.checkpoint_path, payload_digest: pointer.checkpoint_digest,
    mission_anchor: {revision: missionRevision, declared_hash: mission.mission_hash},
    policy_anchor: {revision: policyRevision, declared_hash: policy.policy_hash},
    run_ref: {path: 'governance/csg/v51/runs/V51-R2-001/run-r2-02.json'},
    task_id: 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION', attempt_id: 'V51-R2-02-ATTEMPT-002',
    attempt_epoch: 2, owner, recorded_at: '2026-10-02T12:00:00Z', lifecycle: 'ACTIVE', stop_requested: false,
    unresolved_effect_refs: unresolved};
  const run = {path: checkpoint.run_ref.path, run_id: 'V51-R2-001', active_task_id: checkpoint.task_id,
    attempt_id: checkpoint.attempt_id, attempt_epoch: checkpoint.attempt_epoch, execution_owner: owner,
    unresolved_operation_ids: unresolved, stop_requested: false};
  return {project_directory: directory, pointer, checkpoint, mission, policy, run};
}

function scenarioUnits(scenario) {
  const units = [];
  if (scenario.parked) units.push({id: scenario.parked.id, state: 'WAITING_EXTERNAL', priority: 1,
    reason: scenario.parked.reason});
  if (scenario.unknownEffect) units.push({id: 'effect-dependent-lane', state: 'READY', priority: 1,
    execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST'], requires_effect_readback: true,
    related_effect_refs: ['effect-unknown'], mutable_scope: 'effect-slice'});
  if (scenario.running) units.push({id: scenario.running.id, state: 'RUNNING', owner_authority: 'VALID',
    mutable_scope: scenario.running.mutable_scope});
  if (scenario.expiredOwner) units.push({id: 'expired-owner-lane', state: 'RUNNING', owner_authority: 'EXPIRED'});
  if (scenario.deterministicPass) units.push({id: 'already-passed-test', state: 'DONE'});
  if (scenario.integrationConflict) {
    units.push({id: 'integration-running', state: 'RUNNING', owner_authority: 'VALID',
      mutable_scope: 'integration-a', integration_lane: true});
    units.push({id: 'integration-ready', state: 'READY', priority: 1, mutable_scope: 'integration-b',
      integration_lane: true, execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']});
  }
  units.push({id: 'independent-ready', state: 'READY', priority: scenario.integrationConflict ? 3 : 2,
    mutable_scope: 'safe-source-slice', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']});
  return units;
}

for (const scenario of scenarios) {
  test(`any-state recovery rereads authority and continues safe work: ${scenario.name}`, async () => {
    const events = [];
    const snapshot = canonicalSnapshot(scenario);
    const dispatched = [];
    const wake = {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'};
    if (scenario.staleWake) Object.assign(wake, {phase: 'VNEXT5.0-R3', task_id: 'OLD_TASK',
      attempt_id: 'OLD_ATTEMPT', next_action: 'REPLAY_OLD_EFFECT'});
    const result = await reconcileOnWake(wake, {
      async readProjectDirectory() { events.push('PROJECT_DIRECTORY'); return snapshot.project_directory; },
      async readCurrentPointer() { events.push('CURRENT_POINTER'); return snapshot.pointer; },
      async readCanonicalSnapshot() { events.push('MISSION_POLICY_CHECKPOINT_RUN_TASK_ATTEMPT_OWNER_EFFECTS'); return snapshot; },
      async readLiveObservation() {
        events.push('FRESH_LIVE_PROVIDER_RUNTIME_OBSERVATION');
        if (scenario.liveUnavailable) throw Object.assign(new Error('provider readback unavailable'), {code: 'PROVIDER_READBACK_UNAVAILABLE'});
        return {status: 'FRESH', owner_authority: 'NONE', ...(scenario.live || {})};
      },
      async recomputeReady() {
        events.push('READY_RECOMPUTED_FROM_FRESH_READS');
        return {max_concurrency: 4, logical_work_fingerprint: sha('d'), units: scenarioUnits(scenario),
          recomputed_at: '2026-10-02T12:30:00Z'};
      },
      async appendLocalEvidence(evidence) {
        assert.deepEqual(evidence.read_order, events);
        assert.equal(evidence.side_effects.host_dispatch, false);
        assert.equal(evidence.side_effects.host_mutation, false);
        return {durable: true, id: `receipt-${scenario.name}`};
      },
      async readLocalWork(input) {
        return {status: 'NOT_FOUND_CONFIRMED', idempotency_key: input.idempotency_key};
      },
      async dispatchLocalWork(input) {
        dispatched.push(input.unit.id);
        return {status: 'STARTED', idempotency_key: input.idempotency_key};
      }
    });

    assert.deepEqual(events, [
      'PROJECT_DIRECTORY', 'CURRENT_POINTER', 'MISSION_POLICY_CHECKPOINT_RUN_TASK_ATTEMPT_OWNER_EFFECTS',
      'FRESH_LIVE_PROVIDER_RUNTIME_OBSERVATION', 'READY_RECOMPUTED_FROM_FRESH_READS'
    ]);
    assert.equal(result.readiness.selected.unit, 'independent-ready');
    assert.equal(result.execution.status, 'STARTED');
    assert.deepEqual(dispatched, ['independent-ready']);
    assert.equal(result.side_effects.host_dispatch, false);
    assert.equal(result.side_effects.host_mutation, false);
    assert.equal(result.side_effects.canonical_write, false);
    assert.equal(result.mission_lifecycle_changed, false);
    if (scenario.staleWake) {
      assert.deepEqual(result.stale_wake_fields_ignored, ['attempt_id', 'next_action', 'phase', 'task_id']);
    }
    if (scenario.unknownEffect) {
      assert.equal(result.readiness.schedulable_units.find((unit) => unit.id === 'effect-dependent-lane').state,
        'WAITING_EXTERNAL');
    }
    if (scenario.liveUnavailable) {
      assert.equal(result.live_observation.reason, 'PROVIDER_READBACK_UNAVAILABLE');
    }
  });
}
