export function failWithCode(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

const NORMALIZED_GIT_OID = /^[0-9a-f]{40}$/;

export function assertNormalizedGitOid(value) {
  if (typeof value !== 'string' || !NORMALIZED_GIT_OID.test(value) ||
      Buffer.byteLength(value, 'ascii') !== 40 || Buffer.from(value, 'ascii').toString('ascii') !== value) {
    failWithCode('GIT_OID_NOT_NORMALIZED_LOWERCASE_40_HEX');
  }
  return value;
}

/**
 * Parse the exact bytes emitted by `git rev-parse`. Only its single line
 * terminator is accepted; arbitrary whitespace is never trimmed into an OID.
 */
export function gitOidBytesFromStdout(stdoutBytes) {
  if (!Buffer.isBuffer(stdoutBytes)) failWithCode('GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL');
  const raw = Buffer.from(stdoutBytes);
  let oidLength = raw.length;
  if (oidLength === 41 && raw[40] === 0x0a) {
    oidLength = 40;
  } else if (oidLength === 42 && raw[40] === 0x0d && raw[41] === 0x0a) {
    oidLength = 40;
  }
  if (oidLength !== 40) failWithCode('GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL');
  const oidBytes = raw.subarray(0, 40);
  for (const byte of oidBytes) {
    if (!((byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66))) {
      failWithCode('GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL');
    }
  }
  const oid = oidBytes.toString('ascii');
  assertNormalizedGitOid(oid);
  return Buffer.from(oidBytes);
}

export function assertOwnerGenerationAvailable(newGeneration, canonicalGeneration, durablyConsumedGenerations) {
  if (!Number.isSafeInteger(newGeneration) || newGeneration < 1 ||
      !Number.isSafeInteger(canonicalGeneration) || canonicalGeneration < 1 ||
      !Array.isArray(durablyConsumedGenerations) ||
      durablyConsumedGenerations.some((generation) => !Number.isSafeInteger(generation) || generation < 1)) {
    failWithCode('OWNER_GENERATION_ALLOCATION_INPUT_INVALID');
  }
  if (newGeneration <= canonicalGeneration) {
    failWithCode('NEW_OWNER_GENERATION_NOT_GREATER_THAN_CANONICAL');
  }
  if (durablyConsumedGenerations.includes(newGeneration)) {
    failWithCode('NEW_OWNER_GENERATION_ALREADY_DURABLY_CONSUMED');
  }
  return newGeneration;
}

export function assertSourceBindingIdentity(record, expected) {
  for (const key of ['origin_exact_sha', 'base_sha', 'tree_sha']) {
    assertNormalizedGitOid(record?.[key]);
    assertNormalizedGitOid(expected?.[key]);
  }
  for (const key of ['pr_number', 'origin_exact_sha', 'base_sha', 'tree_sha']) {
    if (record?.[key] !== expected[key]) failWithCode('EXACT_SOURCE_BINDING_MISMATCH');
  }
  return record;
}

export function assertVerifierClassification(record) {
  const verifier = record?.checks?.find((check) => check.name === 'csg-trusted-verifier');
  const bounded = record?.checks?.find((check) => check.name === 'bounded-driver-acceptance');
  if (verifier?.conclusion !== 'success' || verifier?.verdict !== 'PASS_EXACT_HEAD') {
    failWithCode('EXACT_HEAD_TRUSTED_VERIFIER_NOT_PASS');
  }
  if (bounded?.conclusion !== 'skipped' || bounded?.verdict !== 'SKIPPED_NOT_PASS') {
    failWithCode('SKIPPED_CHECK_MUST_NOT_BE_PROMOTED_TO_PASS');
  }
  if (record?.semantic_review?.verdict !== 'PENDING_CURRENT_HEAD') {
    failWithCode('SEMANTIC_REVIEW_STATUS_MISMATCH');
  }
  return record;
}
