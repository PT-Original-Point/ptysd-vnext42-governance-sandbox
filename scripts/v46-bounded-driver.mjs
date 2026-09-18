import fs from 'node:fs';
import path from 'node:path';
import {admitCommand, assertEffectPermit, recordOperation, stableHash} from './v45-state-core.mjs';
import {admitCompletion} from './v46-receipt-admission.mjs';

export const PHASES = Object.freeze(['ADMIT','PREPARE','IMPLEMENT','VERIFY','EXPORT','PUBLISH','READBACK']);
export const MAX_TASKS = 12;
export const MAX_ATTEMPTS = 3;
export const MAX_PENDING_TRANSPORTS = 100;
export const TRANSPORT_SCOPE = 'factory-governance-primary';
const COST_KEYS = Object.freeze(['trace','code','service']);
const STOP_TERMINAL = new Set(['STOPPED','QUARANTINED']);
const OTHER_TERMINAL = new Set(['SUCCEEDED','FAILED']);

function ensureDir(p) { fs.mkdirSync(p, {recursive:true}); }
function readJson(p, fallback = null) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function atomicJson(p, value) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value) + '\n', {encoding:'utf8'});
  fs.renameSync(tmp, p);
}
function requiredString(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`INVALID_${name}`);
  return v;
}
function requiredPositiveInteger(v, name) {
  if (!Number.isInteger(v) || v < 1) throw new Error(`INVALID_${name}`);
  return v;
}
function transportKey(transport) {
  return `${requiredString(transport.transport_run_id,'TRANSPORT_RUN_ID')}:${requiredPositiveInteger(transport.transport_run_attempt,'TRANSPORT_RUN_ATTEMPT')}`;
}

export function validateBoundedContract(contract) {
  if (!contract || contract.schema_version !== 'factory.contract.v1') throw new Error('FORMAL_CONTRACT_REQUIRED');
  requiredString(contract.contract_id, 'CONTRACT_ID');
  requiredString(contract.project_id, 'PROJECT_ID');
  if (!Number.isInteger(contract.revision) || contract.revision < 1) throw new Error('INVALID_CONTRACT_REVISION');
  if (!Array.isArray(contract.tasks) || contract.tasks.length < 1 || contract.tasks.length > MAX_TASKS) throw new Error('INVALID_TASK_COUNT');
  const ids = new Set();
  for (const task of contract.tasks) {
    requiredString(task.task_id, 'TASK_ID');
    if (ids.has(task.task_id)) throw new Error('DUPLICATE_TASK_ID');
    ids.add(task.task_id);
    const attempts = task.max_attempts ?? MAX_ATTEMPTS;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) throw new Error('INVALID_MAX_ATTEMPTS');
  }
  return true;
}

export function validateAcceptedCommand(command, contract) {
  validateBoundedContract(contract);
  if (!command || command.schema !== 'factory.command.v46') throw new Error('ACCEPTED_COMMAND_REQUIRED');
  for (const f of ['command_id','request_sha256','project_id','run_id','task_id','attempt_id','contract_id','contract_ref','contract_digest']) requiredString(command[f], f.toUpperCase());
  if (!Number.isInteger(command.contract_revision) || !Number.isInteger(command.attempt_epoch)) throw new Error('INVALID_COMMAND_REVISION');
  if (command.project_id !== contract.project_id) throw new Error('PROJECT_MISMATCH');
  if (command.contract_id !== contract.contract_id) throw new Error('CONTRACT_ID_MISMATCH');
  if (command.contract_revision !== contract.revision) throw new Error('CONTRACT_REVISION_MISMATCH');
  if (command.contract_digest !== stableHash(contract)) throw new Error('CONTRACT_DIGEST_MISMATCH');
  if (!contract.tasks.some(t => t.task_id === command.task_id)) throw new Error('TASK_NOT_IN_CONTRACT');
  return true;
}
function layout(root, runId) {
  const runDir = path.join(root, 'runtime', runId);
  return {
    intake: path.join(root, 'intake', 'commands.json'),
    run: path.join(runDir, 'run.json'),
    checkpoint: path.join(runDir, 'checkpoint.json'),
    stop: path.join(runDir, 'stop.json'),
    raw: path.join(runDir, 'raw'),
  };
}

export function acceptCommandDurably(root, command, contract) {
  validateAcceptedCommand(command, contract);
  const p = layout(root, command.run_id);
  const index = readJson(p.intake, {});
  const next = admitCommand(index, command);
  atomicJson(p.intake, next);
  return structuredClone(next[command.command_id]);
}

export function admitTransportDelivery(queue, transport) {
  const envelope = {
    delivery_id: requiredString(transport?.delivery_id, 'DELIVERY_ID'),
    scope: requiredString(transport?.scope, 'TRANSPORT_SCOPE'),
    transport_run_id: requiredString(transport?.transport_run_id, 'TRANSPORT_RUN_ID'),
    transport_run_attempt: requiredPositiveInteger(transport?.transport_run_attempt, 'TRANSPORT_RUN_ATTEMPT'),
  };
  if (transport.signature_verified !== true) throw new Error('TRANSPORT_SIGNATURE_REQUIRED');
  if (envelope.scope !== TRANSPORT_SCOPE) throw new Error('TRANSPORT_SCOPE_MISMATCH');
  const current = queue ? structuredClone(queue) : {schema:'factory.transport_queue.v46', pending:[], receipts:{}};
  if (!Array.isArray(current.pending) || !current.receipts || typeof current.receipts !== 'object') throw new Error('INVALID_TRANSPORT_QUEUE');
  const existing = current.receipts[envelope.delivery_id];
  if (existing) {
    if (stableHash(existing.envelope) !== stableHash(envelope)) throw new Error('DELIVERY_ID_ENVELOPE_MISMATCH');
    return {status:'DUPLICATE', duplicate:true, queue:current};
  }
  if (current.pending.length >= MAX_PENDING_TRANSPORTS) return {status:'BACKPRESSURE', duplicate:false, queue:current};
  current.pending.push(envelope);
  current.receipts[envelope.delivery_id] = {status:'PENDING', envelope};
  return {status:'ACCEPTED', duplicate:false, queue:current};
}

function initialRun(command) {
  return {
    schema:'factory.bounded_run.v1', project_id:command.project_id,
    run_id:command.run_id, command_id:command.command_id, task_id:command.task_id,
    attempt_id:command.attempt_id, attempt_epoch:command.attempt_epoch,
    contract_ref:command.contract_ref, contract_digest:command.contract_digest,
    contract_revision:command.contract_revision, state:'RUNNING', revision:1,
    phase_index:0, phase:'ADMIT', stop_requested:false,
    unresolved_operation_ids:[], operations:{}, transport_receipts:{},
    costs:{trace:0,code:0,service:0}, completed_phases:[]
  };
}

function assertRunBinding(run, command) {
  for (const f of ['project_id','run_id','command_id','task_id','attempt_id','attempt_epoch','contract_ref','contract_digest','contract_revision']) {
    if (run[f] !== command[f]) throw new Error(`RUN_BINDING_MISMATCH_${f.toUpperCase()}`);
  }
}
function addCosts(run, costs = {}) {
  for (const k of COST_KEYS) {
    const v = costs[k] ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`INVALID_${k.toUpperCase()}_COST`);
    if (v !== 0) throw new Error('INCREMENTAL_PAID_COST_FORBIDDEN');
    run.costs[k] += v;
  }
}

function persistCheckpoint(p, run, event) {
  atomicJson(p.checkpoint, {
    schema:'factory.bounded_checkpoint.v1', run_id:run.run_id,
    revision:run.revision, phase:run.phase, state:run.state,
    attempt_id:run.attempt_id, attempt_epoch:run.attempt_epoch,
    contract_digest:run.contract_digest, event
  });
}

function persistRaw(p, key, text) {
  ensureDir(p.raw);
  const safe = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  fs.writeFileSync(path.join(p.raw, `${safe}.log`), String(text ?? ''), 'utf8');
}

function nextPhase(run) {
  run.completed_phases.push(run.phase);
  run.phase_index += 1;
  run.revision += 1;
  if (run.phase_index >= PHASES.length) {
    run.state = 'SUCCEEDED';
    run.phase = 'COMPLETE';
  } else {
    run.state = 'RUNNING';
    run.phase = PHASES[run.phase_index];
  }
}

function validateStopForRun(stop, run) {
  if (!stop) return null;
  if (stop.schema !== 'factory.stop.v46') throw new Error('INVALID_STOP_SCHEMA');
  if (stop.run_id !== run.run_id) throw new Error('STOP_RUN_MISMATCH');
  if (stop.attempt_id !== run.attempt_id) throw new Error('STOP_ATTEMPT_MISMATCH');
  if (stop.attempt_epoch !== run.attempt_epoch) throw new Error('STOP_EPOCH_MISMATCH');
  requiredString(stop.stop_id, 'STOP_ID');
  requiredString(stop.reason, 'STOP_REASON');
  requiredString(stop.requested_at, 'STOP_REQUESTED_AT');
  return stop;
}

export function requestStopDurably(root, runId, request = {}) {
  requiredString(runId, 'RUN_ID');
  const p = layout(root, runId);
  const run = readJson(p.run);
  if (!run) throw new Error('RUN_NOT_FOUND');
  if (OTHER_TERMINAL.has(run.state)) throw new Error('TERMINAL_RUN');
  const existing = readJson(p.stop);
  if (existing) return structuredClone(validateStopForRun(existing, run));
  const stop = {
    schema:'factory.stop.v46',
    stop_id:requiredString(request.stop_id ?? `STOP-${runId}`, 'STOP_ID'),
    run_id:run.run_id,
    attempt_id:run.attempt_id,
    attempt_epoch:run.attempt_epoch,
    requested_at:request.requested_at ?? new Date().toISOString(),
    reason:requiredString(request.reason ?? 'HUMAN_OR_CONTROLLER_STOP', 'STOP_REASON'),
  };
  atomicJson(p.stop, stop);
  return structuredClone(stop);
}

function applyDurableStop(p, run, {key = null, result = null, event = 'STOP_READBACK'} = {}) {
  const stop = validateStopForRun(readJson(p.stop), run);
  if (!stop) return null;
  if (STOP_TERMINAL.has(run.state) && run.stop_requested) return {status:run.state, run};
  const next = structuredClone(run);
  next.stop_requested = true;
  next.stop_id = stop.stop_id;
  next.stop_requested_at = stop.requested_at;
  next.stop_reason = stop.reason;
  if (result?.operation) {
    const operationId = requiredString(result.operation.operation_id, 'OPERATION_ID');
    if (!next.unresolved_operation_ids.includes(operationId)) next.unresolved_operation_ids.push(operationId);
    next.state = 'QUARANTINED';
    next.wait_reason = 'STOP_WITH_INFLIGHT_EFFECT_READBACK_REQUIRED';
  } else {
    next.state = 'STOPPED';
    next.wait_reason = null;
  }
  if (key && next.transport_receipts[key]) {
    next.transport_receipts[key] = {
      ...next.transport_receipts[key],
      status:'COMPLETE',
      outcome:next.state,
      stop_id:stop.stop_id,
      ack_after_stop:Boolean(result),
    };
  }
  next.revision += 1;
  atomicJson(p.run, next);
  persistCheckpoint(p, next, `${event}:${stop.stop_id}`);
  return {status:next.state, run:next};
}

export async function wakeBoundedDriver({root, contract, command, transport, worker, expectedReceiptIdentity = null}) {
  validateAcceptedCommand(command, contract);
  if (typeof worker !== 'function') throw new Error('WORKER_REQUIRED');
  acceptCommandDurably(root, command, contract);
  const p = layout(root, command.run_id);
  let run = readJson(p.run);
  if (!run) {
    run = initialRun(command);
    atomicJson(p.run, run);
    persistCheckpoint(p, run, 'ACCEPTED_COMMAND_DURABLE');
  }
  assertRunBinding(run, command);
  const stoppedAtWake = applyDurableStop(p, run, {event:'STOP_BEFORE_WAKE'});
  if (stoppedAtWake) return {status:stoppedAtWake.status, duplicate:true, run:stoppedAtWake.run};
  if (run.state === 'SUCCEEDED') return {status:'SUCCEEDED', duplicate:false, run};
  if (run.phase === 'ADMIT') {
    nextPhase(run);
    atomicJson(p.run, run);
    persistCheckpoint(p, run, 'ADMIT_PASS');
  }

  const key = transportKey(transport);
  const prior = run.transport_receipts[key];
  if (prior?.status === 'COMPLETE') return {status:prior.outcome, duplicate:true, run};
  if (prior) return {status:'WAITING_CONTROLLER', duplicate:true, ambiguous:true, run};
  run.transport_receipts[key] = {status:'STARTED', phase:run.phase, transport_run_id:transport.transport_run_id, transport_run_attempt:transport.transport_run_attempt};
  atomicJson(p.run, run);
  persistCheckpoint(p, run, `TRANSPORT_STARTED:${key}`);

  const stoppedBeforeWorker = applyDurableStop(p, run, {key, event:'STOP_BEFORE_WORKER'});
  if (stoppedBeforeWorker) return {status:stoppedBeforeWorker.status, duplicate:false, run:stoppedBeforeWorker.run};

  const phase = run.phase;
  let result;
  try {
    result = await worker({phase, run:structuredClone(run), contract:structuredClone(contract), command:structuredClone(command)});
  } catch (error) {
    const stopAfterError = applyDurableStop(p, run, {key, event:'STOP_AFTER_WORKER_ERROR'});
    if (stopAfterError) return {status:stopAfterError.status, duplicate:false, run:stopAfterError.run};
    run.state = 'WAITING_CONTROLLER';
    run.wait_reason = 'WORKER_CALLBACK_ERROR_READBACK_REQUIRED';
    run.transport_receipts[key].status = 'AMBIGUOUS';
    run.transport_receipts[key].error = String(error?.message ?? error);
    run.revision += 1;
    atomicJson(p.run, run);
    persistCheckpoint(p, run, `WORKER_ERROR:${phase}`);
    throw error;
  }
  persistRaw(p, key, result?.raw_log ?? '');

  const latest = readJson(p.run);
  assertRunBinding(latest, command);
  const stoppedAfterWorker = applyDurableStop(p, latest, {key, result, event:'STOP_AFTER_WORKER'});
  if (stoppedAfterWorker) return {status:stoppedAfterWorker.status, duplicate:false, run:stoppedAfterWorker.run};
  run = latest;

  addCosts(run, result?.costs);
  if (result?.status === 'WAIT') {
    const waitState = result.wait_state ?? 'WAITING_RESOURCE';
    if (!['WAITING_RESOURCE','WAITING_CONTROLLER'].includes(waitState)) throw new Error('INVALID_WAIT_STATE');
    run.state = waitState;
    run.wait_reason = requiredString(result.wait_reason ?? 'BOUNDED_WAIT', 'WAIT_REASON');
    run.transport_receipts[key] = {...run.transport_receipts[key], status:'COMPLETE', outcome:waitState};
    run.revision += 1;
    atomicJson(p.run, run);
    persistCheckpoint(p, run, `WAIT:${phase}`);
    return {status:waitState, duplicate:false, run};
  }
  if (result?.status !== 'PASS') throw new Error('WORKER_RESULT_NOT_PASS');

  if (result.operation) {
    assertEffectPermit(run, result.operation);
    run.operations = recordOperation(run.operations, result.operation);
  }
  if (phase === 'READBACK') {
    if (!result.receipt) throw new Error('READBACK_RECEIPT_REQUIRED');
    if (!expectedReceiptIdentity) throw new Error('TRUSTED_RECEIPT_EXPECTATION_REQUIRED');
    const expected = {
      ...expectedReceiptIdentity,
      project_id:command.project_id, run_id:command.run_id, task_id:command.task_id,
      attempt_id:command.attempt_id, attempt_epoch:command.attempt_epoch,
      contract_ref:command.contract_ref, contract_digest:command.contract_digest
    };
    admitCompletion({...run, state:'VERIFYING'}, result.receipt, expected);
  }

  run.wait_reason = null;
  run.state = 'RUNNING';
  run.transport_receipts[key] = {...run.transport_receipts[key], status:'COMPLETE', outcome:'PASS'};
  nextPhase(run);
  atomicJson(p.run, run);
  persistCheckpoint(p, run, `PHASE_PASS:${phase}`);
  return {status:run.state, phase:run.phase, duplicate:false, run};
}

export function reconstructBoundedRun(root, runId) {
  const p = layout(root, requiredString(runId, 'RUN_ID'));
  const run = readJson(p.run);
  if (!run) throw new Error('RUN_NOT_FOUND');
  return {run, checkpoint:readJson(p.checkpoint), stop:readJson(p.stop), intake:readJson(p.intake, {})};
}
