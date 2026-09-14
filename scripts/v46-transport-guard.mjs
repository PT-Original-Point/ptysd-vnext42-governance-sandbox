export const TRANSPORT_QUEUE_MAX = 100;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

export function transportKey(event) {
  invariant(typeof event?.transport_run_id === 'string' && event.transport_run_id, 'TRANSPORT_RUN_ID_REQUIRED');
  invariant(Number.isInteger(event.transport_attempt) && event.transport_attempt >= 1, 'TRANSPORT_ATTEMPT_REQUIRED');
  return `${event.transport_run_id}#${event.transport_attempt}`;
}

export function enqueueTransport(queue, event) {
  invariant(Array.isArray(queue), 'QUEUE_REQUIRED');
  const key = transportKey(event);
  if (queue.some(item => item.key === key)) return { queue, duplicate: true, accepted: true };
  invariant(queue.length < TRANSPORT_QUEUE_MAX, 'TRANSPORT_QUEUE_FULL');
  const next = [...queue, { key, event: structuredClone(event) }];
  return { queue: next, duplicate: false, accepted: true };
}

export function persistStop(run, stop) {
  invariant(stop?.project_id === run.project_id, 'STOP_PROJECT_MISMATCH');
  invariant(stop?.run_id === run.run_id, 'STOP_RUN_MISMATCH');
  invariant(Number.isInteger(stop.expected_epoch), 'STOP_EPOCH_REQUIRED');
  invariant(stop.expected_epoch === run.attempt_epoch, 'STALE_STOP_EPOCH');
  if (run.stop_requested) return run;
  const out = structuredClone(run);
  out.stop_requested = true;
  if (!['SUCCEEDED','FAILED','STOPPED','QUARANTINED'].includes(out.state)) out.state = 'STOPPING';
  out.revision += 1;
  return out;
}

export function applyTransportObservation(run, event) {
  transportKey(event);
  const out = structuredClone(run);
  out.transport_observations ??= [];
  const key = transportKey(event);
  if (!out.transport_observations.some(x => x.key === key)) {
    out.transport_observations.push({ key, status: event.status ?? 'UNKNOWN' });
  }
  return out;
}

export function classifyTransportFailure(run, failure) {
  invariant(['THROTTLED','OUTAGE','EVENT_LOST','EVENT_DUPLICATE'].includes(failure), 'UNKNOWN_TRANSPORT_FAILURE');
  return {
    business_state_unchanged: true,
    run_id: run.run_id,
    attempt_epoch: run.attempt_epoch,
    active_task_index: run.active_task_index,
    action: failure === 'EVENT_DUPLICATE' ? 'DEDUPLICATE' : 'WAIT_AND_READ_CANONICAL'
  };
}

export function canStartBusinessAttempt(run) {
  if (run.stop_requested) return { allowed:false, reason:'STOP_BLOCKS_NEW_ATTEMPT' };
  if (run.unresolved_operation_ids?.length) return { allowed:false, reason:'UNRESOLVED_EFFECTS' };
  return { allowed:true, reason:'CURRENT_CANONICAL_STATE_ALLOWS_START' };
}
