import crypto from 'node:crypto';

function canonicalJson(value) {
  const walk = (v) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('INVALID_CANONICAL_JSON');
      return Object.is(v, -0) ? 0 : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) throw new Error('INVALID_CANONICAL_JSON');
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (typeof v[k] === 'undefined') throw new Error('INVALID_CANONICAL_JSON');
      out[k] = walk(v[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export function strictHash(value) {
  return 'sha256:' + crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function effectFingerprint(operation) {
  for (const k of ['project_id','provider','operation_kind','target_resource_id']) {
    if (typeof operation[k] !== 'string' || !operation[k]) throw new Error(`INVALID_EFFECT_FIELD:${k}`);
  }
  if (!('payload' in operation)) throw new Error('INVALID_EFFECT_FIELD:payload');
  const identity = {
    project_id: operation.project_id,
    provider: operation.provider,
    operation_kind: operation.operation_kind,
    target_resource_id: operation.target_resource_id,
    logical_scope_id: operation.logical_scope_id ?? null,
    precondition: operation.precondition ?? null,
    payload: operation.payload,
  };
  return strictHash(identity);
}

function existingFingerprint(existing) {
  if (existing.effect_fingerprint) return existing.effect_fingerprint;
  const required=['project_id','provider','operation_kind','target_resource_id','payload'];
  if (!required.every(k => k in existing)) throw new Error('LEGACY_OPERATION_IDENTITY_AMBIGUOUS');
  return effectFingerprint(existing);
}

export function recordOperationV46(ops, operation) {
  if (typeof operation.operation_id !== 'string' || !operation.operation_id) throw new Error('INVALID_OPERATION_ID');
  const effect_fingerprint = effectFingerprint(operation);
  const payload_digest = strictHash(operation.payload);
  const existing = ops[operation.operation_id];
  if (!existing) return {...ops, [operation.operation_id]: {...structuredClone(operation), effect_fingerprint, payload_digest}};
  if (existingFingerprint(existing) !== effect_fingerprint) throw new Error('OPERATION_ID_INTENT_MISMATCH');
  return ops;
}
