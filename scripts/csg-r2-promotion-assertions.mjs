export function failWithCode(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function assertSourceBindingIdentity(record, expected) {
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
