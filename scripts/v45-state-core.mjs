import crypto from 'node:crypto';

export const STATES = new Set(['READY','RUNNING','VERIFYING','WAITING_CONTROLLER','WAITING_RESOURCE','STOPPING','STOPPED','QUARANTINED','SUCCEEDED','FAILED']);
const TERMINAL = new Set(['STOPPED','QUARANTINED','SUCCEEDED','FAILED']);
const ALLOWED = new Map([
  ['READY', new Set(['RUNNING','WAITING_RESOURCE','STOPPING','FAILED'])],
  ['RUNNING', new Set(['VERIFYING','WAITING_CONTROLLER','WAITING_RESOURCE','STOPPING','FAILED'])],
  ['VERIFYING', new Set(['RUNNING','WAITING_CONTROLLER','STOPPING','SUCCEEDED','FAILED'])],
  ['WAITING_CONTROLLER', new Set(['RUNNING','WAITING_RESOURCE','STOPPING','FAILED'])],
  ['WAITING_RESOURCE', new Set(['READY','RUNNING','STOPPING','FAILED'])],
  ['STOPPING', new Set(['STOPPED','QUARANTINED'])],
]);

export function stableHash(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function admitCommand(index, command) {
  if (!command.command_id || !command.request_sha256) throw new Error('INVALID_COMMAND');
  const existing = index[command.command_id];
  if (!existing) return {...index, [command.command_id]: structuredClone(command)};
  if (existing.request_sha256 !== command.request_sha256) throw new Error('COMMAND_ID_PAYLOAD_MISMATCH');
  return index;
}

export function applyTransition(run, req) {
  if (!STATES.has(run.state) || !STATES.has(req.next_state)) throw new Error('INVALID_STATE');
  if (run.revision !== req.expected_revision) throw new Error('STALE_REVISION');
  if (run.attempt_epoch !== req.expected_epoch) throw new Error('STALE_EPOCH');
  if (TERMINAL.has(run.state)) throw new Error('TERMINAL_RUN');
  if (run.stop_requested && !['STOPPING','STOPPED','QUARANTINED'].includes(req.next_state)) throw new Error('STOP_STICKY');
  if (!ALLOWED.get(run.state)?.has(req.next_state)) throw new Error('ILLEGAL_TRANSITION');
  const out = structuredClone(run);
  out.state = req.next_state;
  out.revision += 1;
  if ('wait_reason' in req) out.wait_reason = req.wait_reason;
  if (req.request_stop) out.stop_requested = true;
  if (req.increment_epoch) out.attempt_epoch += 1;
  return out;
}

export function requestStop(run, expectedRevision, expectedEpoch) {
  const base = structuredClone(run);
  if (base.revision !== expectedRevision) throw new Error('STALE_REVISION');
  if (base.attempt_epoch !== expectedEpoch) throw new Error('STALE_EPOCH');
  if (base.state === 'STOPPED') return base;
  if (TERMINAL.has(base.state) && base.state !== 'STOPPED') throw new Error('TERMINAL_RUN');
  base.stop_requested = true;
  if (base.state !== 'STOPPING') {
    base.state = 'STOPPING';
    base.revision += 1;
  }
  return base;
}

export function acceptAttemptReceipt(run, receipt) {
  if (receipt.run_id !== run.run_id) throw new Error('RUN_MISMATCH');
  if (receipt.attempt_epoch !== run.attempt_epoch) throw new Error('STALE_ATTEMPT_RECEIPT');
  if (run.stop_requested && receipt.external_effect_requested) throw new Error('STOP_BLOCKS_NEW_EFFECT');
  return true;
}

export function recordOperation(ops, operation) {
  const digest = stableHash(operation.payload);
  const existing = ops[operation.operation_id];
  if (!existing) return {...ops, [operation.operation_id]: {...operation, payload_digest: digest}};
  if (existing.payload_digest !== digest) throw new Error('OPERATION_ID_PAYLOAD_MISMATCH');
  return ops;
}
