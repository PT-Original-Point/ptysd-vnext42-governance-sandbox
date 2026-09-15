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

function canonicalJson(value, stack = new Set()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_JSON_VALUE');
    return value;
  }
  if (type !== 'object') throw new Error('INVALID_JSON_VALUE');
  if (stack.has(value)) throw new Error('INVALID_JSON_CYCLE');
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map(v => canonicalJson(v, stack));
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error('INVALID_JSON_OBJECT');
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalJson(value[k], stack)]));
  } finally {
    stack.delete(value);
  }
}

export function stableHash(value) {
  const canonical = canonicalJson(value);
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`INVALID_OPERATION_${field.toUpperCase()}`);
  return value;
}

export function operationEffectIdentity(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('INVALID_OPERATION');
  requiredString(operation.operation_id, 'operation_id');
  const kind = requiredString(operation.kind, 'kind');
  const provider = requiredString(operation.provider, 'provider');
  const target = requiredString(operation.target, 'target');
  if (!Object.hasOwn(operation, 'precondition')) throw new Error('INVALID_OPERATION_PRECONDITION');
  if (!Object.hasOwn(operation, 'payload')) throw new Error('INVALID_OPERATION_PAYLOAD');
  if (operation.precondition !== null && (typeof operation.precondition !== 'object' || Array.isArray(operation.precondition))) {
    throw new Error('INVALID_OPERATION_PRECONDITION');
  }
  return {
    material: {kind, provider, target, precondition: canonicalJson(operation.precondition), payload: canonicalJson(operation.payload)},
    digest: stableHash({kind, provider, target, precondition: operation.precondition, payload: operation.payload}),
  };
}

export function assertEffectPermit(run, operation) {
  if (!run || !operation) throw new Error('INVALID_EFFECT_PERMIT');
  if (operation.run_id !== run.run_id) throw new Error('RUN_MISMATCH');
  if (!Number.isInteger(operation.attempt_epoch) || operation.attempt_epoch !== run.attempt_epoch) throw new Error('STALE_EFFECT_PERMIT');
  if (run.stop_requested) throw new Error('STOP_BLOCKS_NEW_EFFECT');
  if (TERMINAL.has(run.state)) throw new Error('TERMINAL_RUN');
  return true;
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
  const {digest: effectIdentityDigest} = operationEffectIdentity(operation);
  const payloadDigest = stableHash(operation.payload);
  const existing = ops[operation.operation_id];
  if (!existing) {
    return {...ops, [operation.operation_id]: {...structuredClone(operation), payload_digest: payloadDigest, effect_identity_digest: effectIdentityDigest}};
  }
  if (!existing.effect_identity_digest) throw new Error('LEGACY_OPERATION_IDENTITY_INCOMPLETE');
  if (existing.effect_identity_digest !== effectIdentityDigest) {
    if (existing.payload_digest !== payloadDigest) throw new Error('OPERATION_ID_PAYLOAD_MISMATCH');
    throw new Error('OPERATION_ID_INTENT_MISMATCH');
  }
  return ops;
}
