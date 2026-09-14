import crypto from 'node:crypto';

export const FIXED_STAGES = Object.freeze([
  'ADMIT','PREPARE','IMPLEMENT','VERIFY','EXPORT','PUBLISH','READBACK'
]);
export const MAX_TASKS = 12;
export const MAX_ATTEMPTS_PER_TASK = 3;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

export function stableJson(value) {
  const walk = (v) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      invariant(Number.isFinite(v), 'NON_FINITE_NUMBER');
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    invariant(v && typeof v === 'object', 'UNSUPPORTED_JSON_VALUE');
    const out = {};
    for (const k of Object.keys(v).sort()) {
      invariant(v[k] !== undefined, 'UNDEFINED_JSON_VALUE');
      out[k] = walk(v[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

export function admitCommand({ existing, command }) {
  invariant(command && typeof command === 'object', 'INVALID_COMMAND');
  invariant(typeof command.command_id === 'string' && command.command_id, 'MISSING_COMMAND_ID');
  invariant(typeof command.project_id === 'string' && command.project_id, 'MISSING_PROJECT_ID');
  invariant(typeof command.contract_digest === 'string' && command.contract_digest, 'MISSING_CONTRACT_DIGEST');
  invariant(Array.isArray(command.tasks), 'TASKS_REQUIRED');
  invariant(command.tasks.length >= 1 && command.tasks.length <= MAX_TASKS, 'TASK_COUNT_OUT_OF_RANGE');
  const ids = new Set();
  for (const task of command.tasks) {
    invariant(task && typeof task.task_id === 'string' && task.task_id, 'INVALID_TASK_ID');
    invariant(!ids.has(task.task_id), 'DUPLICATE_TASK_ID');
    ids.add(task.task_id);
  }
  const request_digest = digest(command);
  if (!existing) {
    return Object.freeze({
      command_id: command.command_id,
      project_id: command.project_id,
      contract_digest: command.contract_digest,
      request_digest,
      tasks: command.tasks.map(t => Object.freeze({ ...t })),
      accepted: true
    });
  }
  invariant(existing.command_id === command.command_id, 'COMMAND_ID_MISMATCH');
  invariant(existing.request_digest === request_digest, 'COMMAND_ID_PAYLOAD_MISMATCH');
  return existing;
}

export function createBusinessRun({ acceptedCommand, run_id, revision = 1, attempt_epoch = 1 }) {
  invariant(acceptedCommand?.accepted === true, 'COMMAND_NOT_ADMITTED');
  invariant(typeof run_id === 'string' && run_id, 'RUN_ID_REQUIRED');
  return {
    schema: 'factory.run.v46-candidate',
    run_id,
    project_id: acceptedCommand.project_id,
    command_id: acceptedCommand.command_id,
    contract_digest: acceptedCommand.contract_digest,
    revision,
    attempt_epoch,
    state: 'READY',
    stage: 'ADMIT',
    stop_requested: false,
    active_task_index: 0,
    tasks: acceptedCommand.tasks.map(t => ({
      task_id: t.task_id,
      business_attempt: 0,
      state: 'PENDING'
    })),
    unresolved_operation_ids: [],
    transport_observations: []
  };
}

export function observeTransport(run, transport) {
  invariant(typeof transport?.transport_run_id === 'string' && transport.transport_run_id, 'TRANSPORT_RUN_ID_REQUIRED');
  invariant(Number.isInteger(transport.transport_attempt) && transport.transport_attempt >= 1, 'TRANSPORT_ATTEMPT_REQUIRED');
  const out = structuredClone(run);
  out.transport_observations.push({
    transport_run_id: transport.transport_run_id,
    transport_attempt: transport.transport_attempt
  });
  return out;
}

export function startTaskAttempt(run) {
  invariant(run.state !== 'SUCCEEDED' && run.state !== 'FAILED', 'TERMINAL_RUN');
  invariant(!run.stop_requested, 'STOP_BLOCKS_NEW_ATTEMPT');
  const out = structuredClone(run);
  const task = out.tasks[out.active_task_index];
  invariant(task, 'NO_ACTIVE_TASK');
  invariant(task.business_attempt < MAX_ATTEMPTS_PER_TASK, 'TASK_ATTEMPT_LIMIT');
  task.business_attempt += 1;
  task.state = 'RUNNING';
  out.state = 'RUNNING';
  out.stage = 'PREPARE';
  out.revision += 1;
  return out;
}

export function advanceStage(run, nextStage) {
  invariant(FIXED_STAGES.includes(nextStage), 'UNKNOWN_STAGE');
  invariant(run.state !== 'SUCCEEDED' && run.state !== 'FAILED', 'TERMINAL_RUN');
  invariant(!run.stop_requested || nextStage === 'READBACK', 'STOP_BLOCKS_STAGE_ADVANCE');
  const current = FIXED_STAGES.indexOf(run.stage);
  const next = FIXED_STAGES.indexOf(nextStage);
  invariant(next === current + 1, 'NON_LINEAR_STAGE_TRANSITION');
  const out = structuredClone(run);
  out.stage = nextStage;
  out.revision += 1;
  return out;
}

export function completeCurrentTask(run) {
  invariant(run.stage === 'READBACK', 'READBACK_REQUIRED');
  invariant(run.unresolved_operation_ids.length === 0, 'UNRESOLVED_EFFECTS');
  invariant(!run.stop_requested, 'STOP_BLOCKS_SUCCESS');
  const out = structuredClone(run);
  const task = out.tasks[out.active_task_index];
  invariant(task?.state === 'RUNNING', 'TASK_NOT_RUNNING');
  task.state = 'SUCCEEDED';
  if (out.active_task_index + 1 < out.tasks.length) {
    out.active_task_index += 1;
    out.state = 'READY';
    out.stage = 'ADMIT';
  } else {
    out.state = 'SUCCEEDED';
  }
  out.revision += 1;
  return out;
}

export function requestStop(run) {
  if (run.stop_requested) return run;
  const out = structuredClone(run);
  out.stop_requested = true;
  if (out.state !== 'SUCCEEDED' && out.state !== 'FAILED') out.state = 'STOPPING';
  out.revision += 1;
  return out;
}
