import { createHash } from 'node:crypto';

export const OWNERS = Object.freeze(['CHAT', 'CODEX', 'HOST_SUPERVISOR', 'CI']);
export const HANDOFF_STATES = Object.freeze([
  'CHAT_PREPARES',
  'HANDOFF_SEALED',
  'CODEX_OWNS',
  'HOST_SUPERVISOR_OWNS',
  'CI_OWNS',
  'CODEX_RELEASED',
  'OWNER_RELEASED',
  'CHAT_RECLAIMS',
]);

const ACTIVE_STATE_BY_OWNER = Object.freeze({
  CHAT: new Set(['CHAT_PREPARES', 'CHAT_RECLAIMS']),
  CODEX: new Set(['CODEX_OWNS']),
  HOST_SUPERVISOR: new Set(['HOST_SUPERVISOR_OWNS']),
  CI: new Set(['CI_OWNS']),
});

const SCOPE_KEYS = Object.freeze([
  'projectId',
  'repository',
  'branchRef',
  'baseHead',
  'pathSet',
  'writeSurface',
]);

const RECORD_KEYS = Object.freeze([
  'schema',
  'atomicUnitId',
  'owner',
  'ownerEpoch',
  'exactScope',
  'scopeDigest',
  'currentHead',
  'revision',
  'handoffState',
  'pendingOwner',
  'readbackRequired',
  'releaseRevision',
  'lastReadback',
  'lastWriteReadback',
]);

const READBACK_KEYS = Object.freeze([
  'sourceRef',
  'head',
  'scopeDigest',
  'afterOwnershipRevision',
  'evidenceDigest',
]);

const WRITE_READBACK_KEYS = Object.freeze([
  'atomicUnitId',
  'owner',
  'ownerEpoch',
  'handoffState',
  'sourceRef',
  'parentHead',
  'head',
  'scopeDigest',
  'afterOwnershipRevision',
  'changedPaths',
  'evidenceDigest',
]);

const CAS_RESULT_KEYS = Object.freeze([
  'decision',
  'atomicUnitId',
  'ownerEpoch',
  'expectedRecordRevision',
  'parentHead',
  'head',
  'scopeDigest',
  'afterOwnershipRevision',
]);

function reject(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    reject(code);
  }
  return value;
}

function requireOwner(owner) {
  if (!OWNERS.includes(owner)) reject('UNKNOWN_OWNER');
  return owner;
}

function normalizeOid(oid, code) {
  requireText(oid, code);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(oid)) reject(code);
  return oid.toLowerCase();
}

function normalizePath(path) {
  requireText(path, 'INVALID_SCOPE_PATH');
  if (path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) {
    reject('INVALID_SCOPE_PATH');
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    reject('INVALID_SCOPE_PATH');
  }
  if (path.includes('\0')) reject('INVALID_SCOPE_PATH');
  return path;
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    reject('INVALID_SCOPE');
  }
  for (const key of Object.keys(scope)) {
    if (!SCOPE_KEYS.includes(key)) reject('UNKNOWN_SCOPE_FIELD');
  }
  for (const key of SCOPE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(scope, key)) reject('MISSING_SCOPE_FIELD');
  }

  if (!Array.isArray(scope.pathSet) || scope.pathSet.length === 0) {
    reject('EMPTY_WRITE_SURFACE');
  }
  const pathSet = scope.pathSet.map(normalizePath);
  if (new Set(pathSet).size !== pathSet.length) reject('DUPLICATE_SCOPE_PATH');

  const writeSurface = requireText(scope.writeSurface, 'INVALID_WRITE_SURFACE');
  if (writeSurface !== 'REPOSITORY_PATH_SET') reject('UNKNOWN_WRITE_SURFACE');

  return {
    projectId: requireText(scope.projectId, 'INVALID_PROJECT_ID'),
    repository: requireText(scope.repository, 'INVALID_REPOSITORY'),
    branchRef: requireText(scope.branchRef, 'INVALID_BRANCH_REF'),
    baseHead: normalizeOid(scope.baseHead, 'INVALID_BASE_HEAD'),
    pathSet: [...pathSet].sort(),
    writeSurface,
  };
}

function requireExactKeys(value, keys, code) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject(code);
  }
}

function validateReadback(readback, record) {
  if (!readback || typeof readback !== 'object' || Array.isArray(readback)) {
    reject('INVALID_SAME_SOURCE_READBACK');
  }
  requireExactKeys(readback, READBACK_KEYS, 'INVALID_SAME_SOURCE_READBACK_FIELDS');
  requireText(readback.sourceRef, 'INVALID_READBACK_REF');
  if (readback.sourceRef !== record.exactScope.branchRef) reject('READBACK_REF_MISMATCH');
  if (readback.head !== normalizeOid(readback.head, 'INVALID_READBACK_HEAD')) {
    reject('INVALID_READBACK_HEAD');
  }
  if (readback.head.length !== record.currentHead.length) reject('OID_ALGORITHM_MISMATCH');
  if (readback.scopeDigest !== record.scopeDigest) reject('READBACK_SCOPE_MISMATCH');
  if (!Number.isSafeInteger(readback.afterOwnershipRevision) || readback.afterOwnershipRevision < 1) {
    reject('INVALID_READBACK_REVISION');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(readback.evidenceDigest ?? '')) {
    reject('INVALID_READBACK_DIGEST');
  }
}

function validateStoredWriteReadback(readback, record) {
  if (!readback || typeof readback !== 'object' || Array.isArray(readback)) {
    reject('INVALID_WRITE_READBACK');
  }
  requireExactKeys(readback, WRITE_READBACK_KEYS, 'INVALID_WRITE_READBACK_FIELDS');
  requireText(readback.atomicUnitId, 'INVALID_WRITE_READBACK_UNIT');
  if (readback.atomicUnitId !== record.atomicUnitId) reject('WRITE_READBACK_UNIT_MISMATCH');
  requireOwner(readback.owner);
  if (
    !HANDOFF_STATES.includes(readback.handoffState) ||
    !ACTIVE_STATE_BY_OWNER[readback.owner].has(readback.handoffState)
  ) reject('UNKNOWN_WRITE_READBACK_STATE');
  if (
    !Number.isSafeInteger(readback.ownerEpoch) ||
    readback.ownerEpoch < 1 ||
    readback.ownerEpoch > record.ownerEpoch
  ) reject('INVALID_WRITE_READBACK_EPOCH');
  requireText(readback.sourceRef, 'INVALID_WRITE_READBACK_REF');
  if (readback.sourceRef !== record.exactScope.branchRef) reject('WRITE_READBACK_REF_MISMATCH');
  const parentHead = normalizeOid(readback.parentHead, 'INVALID_WRITE_READBACK_PARENT');
  const head = normalizeOid(readback.head, 'INVALID_WRITE_READBACK_HEAD');
  if (readback.parentHead !== parentHead || readback.head !== head) {
    reject('NONCANONICAL_WRITE_READBACK_OID');
  }
  if (parentHead.length !== record.currentHead.length || head.length !== record.currentHead.length) {
    reject('OID_ALGORITHM_MISMATCH');
  }
  if (head === parentHead) reject('WRITE_READBACK_NO_HEAD_CHANGE');
  if (readback.scopeDigest !== record.scopeDigest) reject('WRITE_READBACK_SCOPE_MISMATCH');
  if (!Number.isSafeInteger(readback.afterOwnershipRevision) || readback.afterOwnershipRevision < 1) {
    reject('INVALID_WRITE_READBACK_REVISION');
  }
  if (!Array.isArray(readback.changedPaths) || readback.changedPaths.length === 0) {
    reject('INVALID_WRITE_READBACK_PATHS');
  }
  const normalizedPaths = readback.changedPaths.map(normalizePath);
  if (new Set(normalizedPaths).size !== normalizedPaths.length) reject('DUPLICATE_WRITE_READBACK_PATH');
  const allowed = new Set(record.exactScope.pathSet);
  if (normalizedPaths.some((path) => !allowed.has(path))) reject('WRITE_READBACK_OUTSIDE_SCOPE');
  const sortedPaths = [...normalizedPaths].sort();
  if (normalizedPaths.some((path, index) => path !== sortedPaths[index])) {
    reject('NONCANONICAL_WRITE_READBACK_PATHS');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(readback.evidenceDigest ?? '')) {
    reject('INVALID_WRITE_READBACK_DIGEST');
  }
}

function scopeDigest(atomicUnitId, scope) {
  const canonical = {
    schema: 'vnext5.execution-ownership.scope.v1',
    atomicUnitId,
    projectId: scope.projectId,
    repository: scope.repository,
    branchRef: scope.branchRef,
    baseHead: scope.baseHead,
    pathSet: scope.pathSet,
    writeSurface: scope.writeSurface,
  };
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function activeState(owner, initial = false) {
  if (owner === 'CHAT') return initial ? 'CHAT_PREPARES' : 'CHAT_RECLAIMS';
  return owner + '_OWNS';
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    reject('INVALID_OWNERSHIP_RECORD');
  }
  requireExactKeys(record, RECORD_KEYS, 'INVALID_OWNERSHIP_RECORD_FIELDS');
  if (record.schema !== 'vnext5.execution-ownership.v1') reject('UNKNOWN_OWNERSHIP_SCHEMA');
  requireText(record.atomicUnitId, 'INVALID_ATOMIC_UNIT_ID');
  if (!Number.isSafeInteger(record.ownerEpoch) || record.ownerEpoch < 1) {
    reject('INVALID_OWNER_EPOCH');
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
    reject('INVALID_RECORD_REVISION');
  }
  if (!HANDOFF_STATES.includes(record.handoffState)) reject('UNKNOWN_HANDOFF_STATE');
  if (!Array.isArray(record.exactScope?.pathSet) || record.exactScope.pathSet.length === 0) {
    reject('INVALID_OWNERSHIP_SCOPE');
  }
  const normalized = normalizeScope(record.exactScope);
  if (
    record.exactScope.projectId !== normalized.projectId ||
    record.exactScope.repository !== normalized.repository ||
    record.exactScope.branchRef !== normalized.branchRef ||
    record.exactScope.baseHead !== normalized.baseHead ||
    record.exactScope.writeSurface !== normalized.writeSurface ||
    record.exactScope.pathSet.length !== normalized.pathSet.length ||
    record.exactScope.pathSet.some((path, index) => path !== normalized.pathSet[index])
  ) reject('NONCANONICAL_OWNERSHIP_SCOPE');
  const digest = scopeDigest(record.atomicUnitId, normalized);
  if (digest !== record.scopeDigest) reject('SCOPE_DIGEST_MISMATCH');
  if (record.currentHead !== normalizeOid(record.currentHead, 'INVALID_CURRENT_HEAD')) {
    reject('INVALID_CURRENT_HEAD');
  }
  if (record.currentHead.length !== normalized.baseHead.length) reject('OID_ALGORITHM_MISMATCH');

  if (record.lastReadback !== null) validateReadback(record.lastReadback, record);
  if (record.lastWriteReadback !== null) {
    validateStoredWriteReadback(record.lastWriteReadback, record);
    if (record.lastWriteReadback.afterOwnershipRevision > record.revision) {
      reject('WRITE_READBACK_FROM_FUTURE_REVISION');
    }
  }

  if (record.handoffState === 'HANDOFF_SEALED') {
    if (record.owner !== null || !OWNERS.includes(record.pendingOwner)) {
      reject('INVALID_SEALED_HANDOFF');
    }
    if (record.readbackRequired !== false || record.releaseRevision !== null) {
      reject('INVALID_SEALED_HANDOFF');
    }
  } else if (record.handoffState === 'CODEX_RELEASED' || record.handoffState === 'OWNER_RELEASED') {
    if (record.owner !== null || record.pendingOwner !== null || record.readbackRequired !== true) {
      reject('INVALID_RELEASED_OWNERSHIP');
    }
    if (record.releaseRevision !== record.revision || record.lastReadback !== null) {
      reject('INVALID_RELEASED_OWNERSHIP');
    }
  } else {
    const owner = requireOwner(record.owner);
    if (!ACTIVE_STATE_BY_OWNER[owner].has(record.handoffState) || record.pendingOwner !== null) {
      reject('OWNER_STATE_MISMATCH');
    }
    if (record.readbackRequired !== false) reject('ACTIVE_OWNER_REQUIRES_NO_READBACK');
    if (record.releaseRevision !== null) reject('INVALID_ACTIVE_OWNERSHIP');
    if (record.handoffState === 'CHAT_RECLAIMS' && record.lastReadback === null) {
      reject('CHAT_RECLAIM_REQUIRES_READBACK');
    }
  }
  return record;
}

function requireVersion(record, { expectedOwnerEpoch, expectedRevision, expectedScopeDigest }) {
  validateRecord(record);
  if (!Number.isSafeInteger(expectedOwnerEpoch)) reject('OWNER_EPOCH_REQUIRED');
  if (!Number.isSafeInteger(expectedRevision)) reject('RECORD_REVISION_REQUIRED');
  requireText(expectedScopeDigest, 'SCOPE_DIGEST_REQUIRED');
  if (expectedOwnerEpoch !== record.ownerEpoch) reject('STALE_OWNER_EPOCH');
  if (expectedRevision !== record.revision) reject('STALE_RECORD_REVISION');
  if (expectedScopeDigest !== record.scopeDigest) reject('SCOPE_DIGEST_MISMATCH');
}

export function createOwnershipRecord({
  atomicUnitId,
  scope,
  owner = 'CHAT',
  ownerEpoch = 1,
}) {
  requireText(atomicUnitId, 'INVALID_ATOMIC_UNIT_ID');
  if (owner !== 'CHAT') reject('INITIAL_OWNER_MUST_BE_CHAT');
  if (!Number.isSafeInteger(ownerEpoch) || ownerEpoch < 1) reject('INVALID_OWNER_EPOCH');

  const exactScope = normalizeScope(scope);
  const record = {
    schema: 'vnext5.execution-ownership.v1',
    atomicUnitId,
    owner: 'CHAT',
    ownerEpoch,
    exactScope,
    scopeDigest: scopeDigest(atomicUnitId, exactScope),
    currentHead: exactScope.baseHead,
    revision: 0,
    handoffState: 'CHAT_PREPARES',
    pendingOwner: null,
    readbackRequired: false,
    releaseRevision: null,
    lastReadback: null,
    lastWriteReadback: null,
  };
  return validateRecord(record);
}

export function sealHandoff(record, {
  actor,
  expectedOwnerEpoch,
  expectedRevision,
  expectedScopeDigest,
  targetOwner,
}) {
  requireVersion(record, { expectedOwnerEpoch, expectedRevision, expectedScopeDigest });
  requireOwner(actor);
  requireOwner(targetOwner);
  if (record.owner !== actor) reject('NOT_CURRENT_OWNER');
  if (!ACTIVE_STATE_BY_OWNER[actor].has(record.handoffState)) reject('HANDOFF_STATE_NOT_ACTIVE');
  if (targetOwner === actor) reject('SAME_OWNER_HANDOFF');
  return validateRecord({
    ...record,
    owner: null,
    pendingOwner: targetOwner,
    handoffState: 'HANDOFF_SEALED',
    revision: record.revision + 1,
  });
}

export function acceptHandoff(record, {
  actor,
  expectedOwnerEpoch,
  expectedRevision,
  expectedScopeDigest,
}) {
  requireVersion(record, { expectedOwnerEpoch, expectedRevision, expectedScopeDigest });
  requireOwner(actor);
  if (record.handoffState !== 'HANDOFF_SEALED') reject('HANDOFF_NOT_SEALED');
  if (record.pendingOwner !== actor) reject('NOT_SEALED_RECEIVER');
  return validateRecord({
    ...record,
    owner: actor,
    ownerEpoch: record.ownerEpoch + 1,
    pendingOwner: null,
    handoffState: activeState(actor),
    revision: record.revision + 1,
  });
}

export function releaseOwnership(record, {
  actor,
  expectedOwnerEpoch,
  expectedRevision,
  expectedScopeDigest,
}) {
  requireVersion(record, { expectedOwnerEpoch, expectedRevision, expectedScopeDigest });
  requireOwner(actor);
  if (record.owner !== actor) reject('NOT_CURRENT_OWNER');
  if (!ACTIVE_STATE_BY_OWNER[actor].has(record.handoffState)) reject('HANDOFF_STATE_NOT_ACTIVE');

  const revision = record.revision + 1;
  return validateRecord({
    ...record,
    owner: null,
    pendingOwner: null,
    handoffState: actor === 'CODEX' ? 'CODEX_RELEASED' : 'OWNER_RELEASED',
    revision,
    readbackRequired: true,
    releaseRevision: revision,
    lastReadback: null,
  });
}

export function reclaimByChat(record, {
  actor,
  expectedOwnerEpoch,
  expectedRevision,
  expectedScopeDigest,
  sameSourceReadback,
}) {
  requireVersion(record, { expectedOwnerEpoch, expectedRevision, expectedScopeDigest });
  if (actor !== 'CHAT') reject('CHAT_RECLAIM_REQUIRES_CHAT');
  if (record.owner !== null || !['CODEX_RELEASED', 'OWNER_RELEASED'].includes(record.handoffState)) {
    reject('RELEASE_REQUIRED_BEFORE_RECLAIM');
  }
  if (!sameSourceReadback || typeof sameSourceReadback !== 'object') reject('SAME_SOURCE_READBACK_REQUIRED');
  validateReadback(sameSourceReadback, record);
  if (sameSourceReadback.head !== record.currentHead) reject('READBACK_HEAD_MISMATCH');
  if (sameSourceReadback.afterOwnershipRevision !== record.releaseRevision) {
    reject('READBACK_NOT_AFTER_RELEASE');
  }
  return validateRecord({
    ...record,
    owner: 'CHAT',
    ownerEpoch: record.ownerEpoch + 1,
    pendingOwner: null,
    handoffState: 'CHAT_RECLAIMS',
    revision: record.revision + 1,
    readbackRequired: false,
    releaseRevision: null,
    lastReadback: {
      sourceRef: sameSourceReadback.sourceRef,
      head: sameSourceReadback.head,
      scopeDigest: sameSourceReadback.scopeDigest,
      afterOwnershipRevision: sameSourceReadback.afterOwnershipRevision,
      evidenceDigest: sameSourceReadback.evidenceDigest,
    },
  });
}

/**
 * Return a local authorization proposal. This function does not write or persist.
 * A provider-backed writer must still perform an atomic compare-and-swap against
 * expectedRecordRevision and expectedHead, then read back the resulting head.
 */
export function authorizeWrite(record, {
  actor,
  expectedOwnerEpoch,
  expectedRevision,
  expectedScopeDigest,
  branchRef,
  observedHead,
  changedPaths,
}) {
  requireVersion(record, { expectedOwnerEpoch, expectedRevision, expectedScopeDigest });
  requireOwner(actor);
  if (record.owner === null) reject('NO_ACTIVE_WRITE_OWNER');
  if (record.owner !== actor) reject('NOT_CURRENT_OWNER');
  if (!ACTIVE_STATE_BY_OWNER[actor].has(record.handoffState)) reject('HANDOFF_STATE_NOT_ACTIVE');
  if (branchRef !== record.exactScope.branchRef) reject('BRANCH_SCOPE_MISMATCH');
  if (observedHead !== record.currentHead) reject('STALE_SOURCE_HEAD');
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) reject('EMPTY_WRITE_SET');

  const allowed = new Set(record.exactScope.pathSet);
  const normalized = changedPaths.map(normalizePath);
  if (new Set(normalized).size !== normalized.length) reject('DUPLICATE_WRITE_PATH');
  for (const path of normalized) if (!allowed.has(path)) reject('WRITE_OUTSIDE_EXACT_SCOPE');

  return {
    decision: 'CAS_REQUIRED',
    atomicUnitId: record.atomicUnitId,
    actor,
    ownerEpoch: record.ownerEpoch,
    expectedRecordRevision: record.revision,
    expectedHead: record.currentHead,
    branchRef: record.exactScope.branchRef,
    scopeDigest: record.scopeDigest,
    changedPaths: [...new Set(normalized)].sort(),
  };
}

/**
 * Execute a scoped write only through a provider adapter that atomically checks
 * the ownership revision and source head. The adapter's successful response is
 * not enough: an exact same-source readback must confirm the parent, resulting
 * head, revision, scope, and changed paths before the returned record advances.
 * An adapter error after invocation is an unknown effect; callers must read back
 * before retrying.
 */
export async function executeOwnedWrite(record, writeArgs, provider) {
  const proposal = authorizeWrite(record, writeArgs);
  if (
    !provider ||
    typeof provider !== 'object' ||
    typeof provider.compareAndSwapWrite !== 'function' ||
    typeof provider.readSameSource !== 'function'
  ) reject('PROVIDER_CAS_ADAPTER_REQUIRED');

  let result;
  try {
    result = await provider.compareAndSwapWrite(proposal);
  } catch {
    reject('WRITE_EFFECT_OUTCOME_UNKNOWN');
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    reject('WRITE_EFFECT_OUTCOME_UNKNOWN');
  }
  try {
    requireExactKeys(result, CAS_RESULT_KEYS, 'INVALID_PROVIDER_CAS_RESULT');
    if (
      result.atomicUnitId !== proposal.atomicUnitId ||
      result.ownerEpoch !== proposal.ownerEpoch ||
      result.expectedRecordRevision !== proposal.expectedRecordRevision ||
      result.parentHead !== proposal.expectedHead ||
      result.scopeDigest !== proposal.scopeDigest
    ) reject('PROVIDER_CAS_BINDING_MISMATCH');
    normalizeOid(result.parentHead, 'INVALID_PROVIDER_CAS_PARENT');
    const committedHead = normalizeOid(result.head, 'INVALID_PROVIDER_CAS_HEAD');
    if (result.parentHead !== proposal.expectedHead || result.head !== committedHead) {
      reject('NONCANONICAL_PROVIDER_CAS_OID');
    }
    if (committedHead.length !== proposal.expectedHead.length) reject('OID_ALGORITHM_MISMATCH');
    if (result.decision === 'CAS_CONFLICT') reject('PROVIDER_CAS_CONFLICT');
    if (result.decision !== 'CAS_APPLIED') reject('WRITE_EFFECT_OUTCOME_UNKNOWN');
    if (committedHead === proposal.expectedHead) reject('PROVIDER_CAS_NO_HEAD_CHANGE');
    if (result.afterOwnershipRevision !== record.revision + 1) {
      reject('PROVIDER_CAS_REVISION_MISMATCH');
    }
  } catch (error) {
    if (error?.code === 'PROVIDER_CAS_CONFLICT') throw error;
    reject('WRITE_EFFECT_OUTCOME_UNKNOWN');
  }

  let readback;
  try {
    readback = await provider.readSameSource(proposal);
  } catch {
    reject('WRITE_APPLIED_READBACK_UNCONFIRMED');
  }
  try {
    validateStoredWriteReadback(readback, record);
    if (
      readback.atomicUnitId !== proposal.atomicUnitId ||
      readback.owner !== proposal.actor ||
      readback.ownerEpoch !== proposal.ownerEpoch ||
      readback.handoffState !== record.handoffState ||
      readback.parentHead !== proposal.expectedHead ||
      readback.head !== result.head ||
      readback.scopeDigest !== proposal.scopeDigest ||
      readback.afterOwnershipRevision !== record.revision + 1 ||
      readback.changedPaths.length !== proposal.changedPaths.length ||
      readback.changedPaths.some((path, index) => path !== proposal.changedPaths[index])
    ) reject('WRITE_READBACK_BINDING_MISMATCH');
  } catch {
    reject('WRITE_APPLIED_READBACK_UNCONFIRMED');
  }

  return validateRecord({
    ...record,
    currentHead: readback.head,
    revision: readback.afterOwnershipRevision,
    lastWriteReadback: { ...readback },
  });
}
