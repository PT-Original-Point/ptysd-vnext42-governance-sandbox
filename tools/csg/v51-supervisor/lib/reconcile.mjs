import {mayDispatch, selectNextUnit} from './scheduler.mjs';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function ownersEqual(left, right) {
  const a = left ?? null;
  const b = right ?? null;
  if (a === null || b === null) return a === b;
  return a.principal_id === b.principal_id &&
    a.owner_generation === b.owner_generation &&
    a.scope === b.scope &&
    a.lease_until === b.lease_until;
}

function ownerAuthority(owner, trustedClock) {
  if (owner === null || owner === undefined) {
    return {authority: 'NONE', lease_status: 'NO_OWNER', process_liveness: 'NOT_APPLICABLE'};
  }
  const leaseUntil = Date.parse(owner.lease_until || '');
  const observedAt = Date.parse(trustedClock?.observed_at_utc || '');
  const uncertainty = trustedClock?.uncertainty_seconds;
  if (trustedClock?.trusted !== true || typeof trustedClock.source !== 'string' ||
      trustedClock.source.trim() !== trustedClock.source || trustedClock.source.length === 0 ||
      !Number.isFinite(leaseUntil) || !Number.isFinite(observedAt) ||
      !Number.isSafeInteger(uncertainty) || uncertainty < 0 || uncertainty > 300) {
    return {authority: 'UNKNOWN', lease_status: 'UNKNOWN', process_liveness: 'UNKNOWN'};
  }
  if (leaseUntil + uncertainty * 1000 <= observedAt) {
    return {authority: 'EXPIRED', lease_status: 'DEFINITELY_EXPIRED', process_liveness: 'UNKNOWN'};
  }
  if (leaseUntil - uncertainty * 1000 > observedAt) {
    return {authority: 'UNKNOWN', lease_status: 'NOT_EXPIRED', process_liveness: 'UNKNOWN'};
  }
  return {authority: 'UNKNOWN', lease_status: 'CLOCK_SKEW_BOUNDARY', process_liveness: 'UNKNOWN'};
}

export function validateCanonicalSnapshot(snapshot, {trustedClock = null} = {}) {
  validRecord(snapshot, 'CANONICAL_SNAPSHOT_REQUIRED');
  const directory = validRecord(snapshot.project_directory, 'PROJECT_DIRECTORY_REQUIRED');
  const locator = validRecord(directory.control_locator, 'PROJECT_DIRECTORY_CONTROL_LOCATOR_REQUIRED');
  const pointer = validRecord(snapshot.pointer, 'CANONICAL_POINTER_REQUIRED');
  const checkpoint = validRecord(snapshot.checkpoint, 'CANONICAL_CHECKPOINT_REQUIRED');
  const mission = validRecord(snapshot.mission, 'CANONICAL_MISSION_REQUIRED');
  const policy = validRecord(snapshot.policy, 'CANONICAL_POLICY_REQUIRED');
  const run = validRecord(snapshot.run, 'CANONICAL_RUN_REQUIRED');

  if (directory.project_id !== 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' ||
      locator.ref !== pointer.ref || locator.current_path !== pointer.path) {
    fail('PROJECT_DIRECTORY_POINTER_BINDING_MISMATCH');
  }
  if (pointer.checkpoint_seq !== checkpoint.checkpoint_seq ||
      pointer.checkpoint_path !== checkpoint.path ||
      pointer.checkpoint_digest !== checkpoint.payload_digest) {
    fail('CURRENT_POINTER_CHECKPOINT_BINDING_MISMATCH');
  }
  if (checkpoint.mission_anchor?.revision !== mission.mission_revision_id ||
      checkpoint.mission_anchor?.declared_hash !== mission.mission_hash ||
      checkpoint.policy_anchor?.revision !== policy.policy_revision_id ||
      checkpoint.policy_anchor?.declared_hash !== policy.policy_hash) {
    fail('CHECKPOINT_MISSION_POLICY_BINDING_MISMATCH');
  }
  if (checkpoint.run_ref?.path !== run.path ||
      checkpoint.task_id !== run.active_task_id ||
      checkpoint.attempt_id !== run.attempt_id ||
      checkpoint.attempt_epoch !== run.attempt_epoch ||
      !ownersEqual(checkpoint.owner, run.execution_owner ?? null)) {
    fail('CHECKPOINT_RUN_ATTEMPT_BINDING_MISMATCH');
  }
  if (!Array.isArray(checkpoint.unresolved_effect_refs) ||
      !Array.isArray(run.unresolved_operation_ids)) {
    fail('UNRESOLVED_EFFECT_READBACK_REQUIRED');
  }

  const ownerState = ownerAuthority(run.execution_owner ?? null, trustedClock);
  return {
    project_id: directory.project_id,
    directory_revision: directory.directory_revision,
    control_ref: pointer.ref,
    control_head: pointer.control_head,
    checkpoint_seq: checkpoint.checkpoint_seq,
    checkpoint_digest: checkpoint.payload_digest,
    mission_revision: mission.mission_revision_id,
    policy_revision: policy.policy_revision_id,
    run_id: run.run_id,
    task_id: run.active_task_id,
    attempt_id: run.attempt_id,
    attempt_epoch: run.attempt_epoch,
    owner: run.execution_owner ?? null,
    owner_authority: ownerState.authority,
    owner_lease_status: ownerState.lease_status,
    owner_process_liveness: ownerState.process_liveness,
    trusted_clock_observed_at_utc: trustedClock?.trusted === true ? trustedClock.observed_at_utc : null,
    trusted_clock_source: trustedClock?.trusted === true ? trustedClock.source : null,
    trusted_clock_uncertainty_seconds: trustedClock?.trusted === true ? trustedClock.uncertainty_seconds : null,
    mission_lifecycle: checkpoint.lifecycle,
    stop_requested: checkpoint.stop_requested === true || run.stop_requested === true,
    unresolved_effect_refs: checkpoint.unresolved_effect_refs,
    canonical_state_fresh: true
  };
}

export async function reconcileOnWake(wakePayload, ports) {
  validRecord(wakePayload, 'WAKE_LOCATOR_REQUIRED');
  validRecord(ports, 'SUPERVISOR_PORTS_REQUIRED');
  for (const name of ['readProjectDirectory', 'readCurrentPointer', 'readCanonicalSnapshot',
    'readLiveObservation', 'recomputeReady', 'appendLocalEvidence']) {
    if (typeof ports[name] !== 'function') fail(`SUPERVISOR_PORT_REQUIRED:${name}`);
  }
  if (typeof wakePayload.project_id !== 'string' || typeof wakePayload.locator !== 'string') {
    fail('WAKE_LOCATOR_REQUIRED');
  }

  const ignoredWakeFields = Object.keys(wakePayload)
    .filter((key) => !['project_id', 'locator'].includes(key)).sort();
  const trace = [];
  const directory = await ports.readProjectDirectory({
    project_id: wakePayload.project_id,
    locator: wakePayload.locator
  });
  trace.push('PROJECT_DIRECTORY');
  const pointer = await ports.readCurrentPointer(directory.control_locator);
  trace.push('CURRENT_POINTER');
  const snapshot = await ports.readCanonicalSnapshot(directory, pointer);
  trace.push('MISSION_POLICY_CHECKPOINT_RUN_TASK_ATTEMPT_OWNER_EFFECTS');
  let trustedClock = {trusted: false, source: 'TRUSTED_CLOCK_PORT_UNAVAILABLE'};
  if (typeof ports.readTrustedClock === 'function') {
    try {
      trustedClock = await ports.readTrustedClock();
    } catch (error) {
      trustedClock = {trusted: false, source: String(error?.code || error?.message || error)};
    }
  }
  const authority = validateCanonicalSnapshot({...snapshot,
    project_directory: directory,
    pointer
  }, {trustedClock});

  let liveObservation;
  try {
    liveObservation = await ports.readLiveObservation(authority);
    if (!liveObservation || typeof liveObservation !== 'object') {
      liveObservation = {status: 'UNAVAILABLE', attempted: true, reason: 'INVALID_LIVE_OBSERVATION'};
    } else {
      liveObservation = {...liveObservation, attempted: true};
    }
  } catch (error) {
    liveObservation = {status: 'UNAVAILABLE', attempted: true,
      reason: String(error?.code || error?.message || error)};
  }
  trace.push('FRESH_LIVE_PROVIDER_RUNTIME_OBSERVATION');

  const readiness = await ports.recomputeReady({authority, snapshot, liveObservation});
  trace.push('READY_RECOMPUTED_FROM_FRESH_READS');
  const dispatchAuthority = {
    canonical_state_fresh: authority.canonical_state_fresh,
    mission_lifecycle: authority.mission_lifecycle,
    stop_requested: authority.stop_requested,
    unresolved_effect_refs: authority.unresolved_effect_refs,
    execution_owner_authority: liveObservation?.owner_authority || authority.owner_authority,
    host_mutation_authorized: false,
    human_gate_passed: false
  };
  const dispatchAssessments = new Map();
  const schedulableUnits = readiness.units.map((unit) => {
    if (!unit || typeof unit !== 'object' || !['READY', 'FAILED_RETRYABLE'].includes(unit.state)) return unit;
    const permit = ports.shadowOnly === true
      ? {allowed: false, reason: 'SHADOW_PLAN_ONLY'}
      : mayDispatch(unit, dispatchAuthority);
    dispatchAssessments.set(unit.id, permit);
    if (permit.allowed) return unit;
    const blockedState = ['HUMAN_GATE_REQUIRED', 'PRODUCTION_HUMAN_GATE', 'STOP_REQUESTED'].includes(permit.reason)
      ? 'WAITING_HUMAN' : 'WAITING_EXTERNAL';
    return {...unit, state: blockedState, declared_state: unit.state, reason: permit.reason};
  });
  const decision = selectNextUnit(schedulableUnits, {max_concurrency: readiness.max_concurrency});
  const selectedUnit = ['CONTINUE_READY', 'RETRY_BOUNDED'].includes(decision.decision)
    ? readiness.units.find((unit) => unit.id === decision.unit)
    : null;
  const executionPermit = selectedUnit
    ? dispatchAssessments.get(selectedUnit.id) || mayDispatch(selectedUnit, dispatchAuthority)
    : {allowed: false, reason: 'NO_READY_UNIT_SELECTED'};
  const result = {
    schema: 'VNEXT5_1_R2_SUPERVISOR_RECONCILIATION_V1',
    project_id: authority.project_id,
    authority,
    live_observation: liveObservation,
    readiness: {
      units: readiness.units,
      schedulable_units: schedulableUnits,
      dispatch_assessments: [...dispatchAssessments.entries()].map(([unit, assessment]) => ({
        unit, allowed: assessment.allowed, reason: assessment.reason
      })),
      max_concurrency: readiness.max_concurrency === undefined ? 1 : readiness.max_concurrency,
      selected: decision,
      ...(readiness.shadow_status === undefined ? {} : {shadow_status: readiness.shadow_status}),
      recomputed_at: readiness.recomputed_at || null
    },
    execution: {
      unit_id: selectedUnit?.id || null,
      logical_work_fingerprint: readiness.logical_work_fingerprint || selectedUnit?.logical_work_fingerprint || null,
      permit: executionPermit,
      status: executionPermit.allowed ? 'NOT_DISPATCHED' : 'PARKED',
      pre_dispatch_readback: null
    },
    stale_wake_fields_ignored: ignoredWakeFields,
    read_order: trace,
    side_effects: {host_dispatch: false, host_mutation: false, canonical_write: false, local_work_dispatch: false},
    mission_lifecycle_changed: false
  };
  const receipt = await ports.appendLocalEvidence(result);
  if (!receipt || receipt.durable !== true) {
    return {...result, persistence: {status: 'FAILED', reason: 'LOCAL_EVIDENCE_NOT_DURABLE'},
      execution_allowed: false};
  }
  const persisted = {...result, persistence: {status: 'DURABLE_LOCAL_PROJECTION', receipt: receipt.id || null,
    new_record: receipt.existing !== true}};
  if (!executionPermit.allowed || typeof ports.dispatchLocalWork !== 'function') {
    return {...persisted, execution: {...persisted.execution,
      status: executionPermit.allowed ? 'DISPATCHER_NOT_CONFIGURED' : 'PARKED'}, execution_allowed: false};
  }
  if (typeof persisted.execution.logical_work_fingerprint !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(persisted.execution.logical_work_fingerprint)) {
    return {...persisted, execution: {...persisted.execution, status: 'LOGICAL_WORK_FINGERPRINT_REQUIRED',
      permit: {allowed: false, reason: 'LOGICAL_WORK_FINGERPRINT_REQUIRED'}}, execution_allowed: false};
  }

  if (typeof ports.readLocalWork !== 'function') {
    return {...persisted, execution: {...persisted.execution, status: 'LOCAL_WORK_READBACK_PORT_REQUIRED',
      permit: {allowed: false, reason: 'LOCAL_WORK_READBACK_PORT_REQUIRED'}}, execution_allowed: false};
  }

  const idempotencyKey = persisted.execution.logical_work_fingerprint;
  let priorWork;
  try {
    priorWork = await ports.readLocalWork({
      unit: selectedUnit,
      authority,
      idempotency_key: idempotencyKey
    });
  } catch (error) {
    priorWork = {status: 'UNKNOWN', idempotency_key: idempotencyKey,
      reason: String(error?.code || error?.message || error)};
  }
  if (!priorWork || priorWork.idempotency_key !== idempotencyKey) {
    priorWork = {status: 'READBACK_IDENTITY_MISMATCH', idempotency_key: priorWork?.idempotency_key || null};
  }
  const boundedRetryReadback = priorWork.status === 'NOT_APPLIED_CONFIRMED' &&
    selectedUnit.state === 'FAILED_RETRYABLE' && selectedUnit.retry_allowed === true &&
    Number.isSafeInteger(selectedUnit.retry_budget_remaining) && selectedUnit.retry_budget_remaining > 0 &&
    selectedUnit.effect_status !== 'UNKNOWN' && selectedUnit.effect_status !== 'PARTIAL_OR_AMBIGUOUS';
  if (priorWork.status !== 'NOT_FOUND_CONFIRMED' && !boundedRetryReadback) {
    const status = ['STARTED', 'ALREADY_RUNNING'].includes(priorWork.status)
      ? 'EXISTING_LOCAL_WORK_RUNNING'
      : priorWork.status === 'COMPLETED'
        ? 'EXISTING_LOCAL_WORK_COMPLETED_RECOMPUTE_REQUIRED'
        : priorWork.status === 'NOT_APPLIED_CONFIRMED'
          ? 'NOT_APPLIED_REQUIRES_BOUNDED_RETRY'
        : 'UNKNOWN_EFFECT_READBACK_REQUIRED';
    const readback = {...persisted,
      execution: {...persisted.execution, status, pre_dispatch_readback: priorWork},
      side_effects: {...persisted.side_effects,
        local_work_dispatch: ['STARTED', 'ALREADY_RUNNING', 'COMPLETED'].includes(priorWork.status)
          ? 'EXISTS' : false}};
    const readbackReceipt = await ports.appendLocalEvidence(readback);
    return {...readback, persistence: {status: readbackReceipt?.durable === true
      ? 'DURABLE_LOCAL_PROJECTION' : 'LOCAL_READBACK_RECEIPT_MISSING', receipt: readbackReceipt?.id || null,
      new_record: readbackReceipt?.existing !== true},
    execution_allowed: false};
  }

  let dispatch;
  try {
    dispatch = await ports.dispatchLocalWork({
      unit: selectedUnit,
      authority,
      liveObservation,
      idempotency_key: idempotencyKey
    });
  } catch (error) {
    dispatch = {status: 'UNKNOWN_EFFECT', idempotency_key: idempotencyKey,
      reason: String(error?.code || error?.message || error)};
  }
  if (!dispatch || dispatch.idempotency_key !== idempotencyKey ||
      !['STARTED', 'ALREADY_RUNNING', 'NOT_APPLIED'].includes(dispatch.status)) {
    const unknown = {...persisted,
      execution: {...persisted.execution, status: 'UNKNOWN_EFFECT_READBACK_REQUIRED',
        pre_dispatch_readback: priorWork, dispatch: dispatch || null},
      side_effects: {...persisted.side_effects, local_work_dispatch: 'UNKNOWN'}};
    const readbackReceipt = await ports.appendLocalEvidence(unknown);
    return {...unknown, persistence: {status: readbackReceipt?.durable === true
      ? 'DURABLE_LOCAL_PROJECTION' : 'POST_DISPATCH_RECEIPT_MISSING', receipt: readbackReceipt?.id || null,
      new_record: readbackReceipt?.existing !== true},
    execution_allowed: false};
  }
  if (dispatch.status === 'NOT_APPLIED') {
    const notApplied = {...persisted, execution: {...persisted.execution, status: 'NOT_APPLIED',
      pre_dispatch_readback: priorWork, dispatch}};
    const readbackReceipt = await ports.appendLocalEvidence(notApplied);
    return {...notApplied, persistence: {status: readbackReceipt?.durable === true
      ? 'DURABLE_LOCAL_PROJECTION' : 'POST_DISPATCH_RECEIPT_MISSING', receipt: readbackReceipt?.id || null,
      new_record: readbackReceipt?.existing !== true},
    execution_allowed: false};
  }
  const started = {...persisted,
    execution: {...persisted.execution, status: dispatch.status,
      pre_dispatch_readback: priorWork, dispatch},
    side_effects: {...persisted.side_effects, local_work_dispatch: true}};
  const readbackReceipt = await ports.appendLocalEvidence(started);
  if (!readbackReceipt || readbackReceipt.durable !== true) {
    return {...started, persistence: {status: 'POST_DISPATCH_RECEIPT_MISSING'},
      execution: {...started.execution, status: 'STARTED_READBACK_REQUIRED'}, execution_allowed: false};
  }
  return {...started, persistence: {status: 'DURABLE_LOCAL_PROJECTION', receipt: readbackReceipt.id || null,
    new_record: readbackReceipt.existing !== true},
    execution_allowed: true};
}
