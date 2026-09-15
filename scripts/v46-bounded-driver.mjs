import fs from 'node:fs';
import path from 'node:path';
import {admitCommand, assertEffectPermit, recordOperation, stableHash} from './v45-state-core.mjs';
import {admitCompletion} from './v46-receipt-admission.mjs';

export const PHASES = Object.freeze(['ADMIT','PREPARE','IMPLEMENT','VERIFY','EXPORT','PUBLISH','READBACK']);
export const MAX_TASKS = 12;
export const MAX_ATTEMPTS = 3;
const COST_KEYS = Object.freeze(['trace','code','service']);

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
function transportKey(transport) {
  return `${requiredString(transport.transport_run_id,'TRANSPORT_RUN_ID')}:${String(transport.transport_run_attempt)}`;
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

  const phase = run.phase;
  let result;
  try {
    result = await worker({phase, run:structuredClone(run), contract:structuredClone(contract), command:structuredClone(command)});
  } catch (error) {
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
  return {run, checkpoint:readJson(p.checkpoint), intake:readJson(p.intake, {})};
}
