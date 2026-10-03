import {createHash} from 'node:crypto';
import {canonicalJson} from './fingerprint.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;
const VERDICTS = Object.freeze([
  'CANDIDATE',
  'LOCAL_TEST_PASS',
  'STRUCTURAL_VERIFIER_PASS',
  'SEMANTIC_REVIEW_PASS',
  'LIVE_ACCEPTANCE_PASS',
  'SYSTEM_ACCEPTANCE_PASS',
  'CANONICALIZED',
  'PRODUCTION',
  'SKIPPED_NOT_PASS'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function record(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function nonempty(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function sha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function evidenceDigest(payload) {
  return `sha256:${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}`;
}

function normalizeTarget(target) {
  record(target, 'EVIDENCE_TARGET_REQUIRED');
  if (!nonempty(target.provider) || !nonempty(target.resource) || !nonempty(target.revision)) {
    fail('EVIDENCE_TARGET_IDENTITY_REQUIRED');
  }
  if (target.tree_oid !== undefined && !GIT_OID.test(target.tree_oid)) fail('EVIDENCE_TREE_OID_INVALID');
  if (target.content_manifest_digest !== undefined && !sha256(target.content_manifest_digest)) {
    fail('EVIDENCE_CONTENT_MANIFEST_DIGEST_INVALID');
  }
  if (target.tree_oid === undefined && target.content_manifest_digest === undefined) {
    fail('EVIDENCE_CONTENT_IDENTITY_REQUIRED');
  }
  if (!Array.isArray(target.covered_bytes) || target.covered_bytes.length === 0) {
    fail('EVIDENCE_COVERED_BYTES_REQUIRED');
  }
  const coveredBytes = target.covered_bytes.map((item) => {
    record(item, 'EVIDENCE_COVERED_BYTE_INVALID');
    if (!nonempty(item.path) || item.path.startsWith('/') || item.path.includes('\\') ||
        item.path.split('/').some((part) => part === '..' || part.length === 0) || !sha256(item.sha256)) {
      fail('EVIDENCE_COVERED_BYTE_INVALID');
    }
    return {path: item.path, sha256: item.sha256};
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));
  if (new Set(coveredBytes.map((item) => item.path)).size !== coveredBytes.length) {
    fail('EVIDENCE_COVERED_BYTE_DUPLICATE');
  }
  return {
    provider: target.provider,
    resource: target.resource,
    revision: target.revision,
    ...(target.ref === undefined ? {} : {ref: nonempty(target.ref) ? target.ref : fail('EVIDENCE_REF_INVALID')}),
    ...(target.tree_oid === undefined ? {} : {tree_oid: target.tree_oid}),
    ...(target.content_manifest_digest === undefined ? {} : {content_manifest_digest: target.content_manifest_digest}),
    covered_bytes: coveredBytes
  };
}

function normalizeContract(contract) {
  record(contract, 'EVIDENCE_ACCEPTANCE_CONTRACT_REQUIRED');
  if (!nonempty(contract.id) || !sha256(contract.digest)) fail('EVIDENCE_ACCEPTANCE_CONTRACT_INVALID');
  return {id: contract.id, digest: contract.digest};
}

function normalizeProviderCheck(check, target) {
  record(check, 'EVIDENCE_PROVIDER_CHECK_REQUIRED');
  if ((!Number.isSafeInteger(check.run_id) && !nonempty(check.run_id)) ||
      (!Number.isSafeInteger(check.job_id) && !nonempty(check.job_id)) ||
      !nonempty(check.check_name) || check.target_revision !== target.revision ||
      check.conclusion !== 'success') fail('EVIDENCE_PROVIDER_CHECK_INVALID');
  return {run_id: check.run_id, job_id: check.job_id, check_name: check.check_name,
    target_revision: check.target_revision, conclusion: check.conclusion};
}

function normalizeTestRun(run, target) {
  record(run, 'EVIDENCE_TEST_RUN_REQUIRED');
  if (!nonempty(run.run_id) || !nonempty(run.command) || run.target_revision !== target.revision ||
      !Number.isFinite(Date.parse(run.recorded_at)) ||
      run.exit_code !== 0 || !Number.isSafeInteger(run.tests) || run.tests < 0 ||
      run.passed !== run.tests || run.failed !== 0) fail('EVIDENCE_TEST_RUN_INVALID');
  return {run_id: run.run_id, command: run.command, target_revision: run.target_revision,
    recorded_at: run.recorded_at, exit_code: run.exit_code,
    tests: run.tests, passed: run.passed, failed: run.failed};
}

function normalizeRuntimeReadback(readback, target) {
  record(readback, 'EVIDENCE_RUNTIME_READBACK_REQUIRED');
  if (!nonempty(readback.provider) || !nonempty(readback.resource) ||
      readback.target_revision !== target.revision || !nonempty(readback.readback_id) ||
      !Number.isFinite(Date.parse(readback.observed_at))) fail('EVIDENCE_RUNTIME_READBACK_INVALID');
  return {provider: readback.provider, resource: readback.resource,
    target_revision: readback.target_revision, readback_id: readback.readback_id,
    observed_at: readback.observed_at};
}

function normalizeCanonicalRecord(value) {
  record(value, 'EVIDENCE_CANONICAL_RECORD_INVALID');
  if (!nonempty(value.ref) || !GIT_OID.test(value.revision || '') ||
      !Number.isSafeInteger(value.checkpoint_seq) || value.checkpoint_seq < 0 || !sha256(value.digest)) {
    fail('EVIDENCE_CANONICAL_RECORD_INVALID');
  }
  return {ref: value.ref, revision: value.revision, checkpoint_seq: value.checkpoint_seq, digest: value.digest};
}

function normalizeHumanAuthorization(value) {
  record(value, 'EVIDENCE_HUMAN_AUTHORIZATION_INVALID');
  if (value.approved_by !== 'HUMAN' || !nonempty(value.authorization_ref) || !nonempty(value.scope) ||
      !Number.isFinite(Date.parse(value.approved_at))) fail('EVIDENCE_HUMAN_AUTHORIZATION_INVALID');
  return {approved_by: value.approved_by, authorization_ref: value.authorization_ref,
    scope: value.scope, approved_at: value.approved_at};
}

export function validateEvidenceRecord(input) {
  record(input, 'EVIDENCE_RECORD_REQUIRED');
  if (!VERDICTS.includes(input.verdict)) fail('EVIDENCE_VERDICT_INVALID');
  const target = normalizeTarget(input.target);
  const acceptanceContract = normalizeContract(input.acceptance_contract);
  const payload = {
    schema: 'VNEXT5_1_R2_EXACT_TARGET_EVIDENCE_V1',
    verdict: input.verdict,
    target,
    acceptance_contract: acceptanceContract,
    ...(input.material_state_digest === undefined ? {} : {
      material_state_digest: sha256(input.material_state_digest)
        ? input.material_state_digest : fail('EVIDENCE_MATERIAL_STATE_DIGEST_INVALID')
    }),
    ...(input.test_run === undefined ? {} : {test_run: normalizeTestRun(input.test_run, target)}),
    ...(input.provider_check === undefined ? {} : {provider_check: normalizeProviderCheck(input.provider_check, target)}),
    ...(input.runtime_readback === undefined ? {} : {runtime_readback: normalizeRuntimeReadback(input.runtime_readback, target)}),
    ...(input.canonical_record === undefined ? {} : {canonical_record: normalizeCanonicalRecord(input.canonical_record)}),
    ...(input.human_authorization === undefined ? {} : {human_authorization: normalizeHumanAuthorization(input.human_authorization)})
  };

  if (payload.verdict === 'LOCAL_TEST_PASS' && !payload.test_run) fail('EVIDENCE_VERDICT_REQUIRES_TEST_RUN');
  if (payload.test_run && payload.verdict !== 'LOCAL_TEST_PASS') fail('EVIDENCE_TEST_RUN_VERDICT_MISMATCH');
  if (payload.provider_check && !['STRUCTURAL_VERIFIER_PASS', 'SEMANTIC_REVIEW_PASS'].includes(payload.verdict)) {
    fail('EVIDENCE_PROVIDER_CHECK_VERDICT_MISMATCH');
  }
  if (payload.runtime_readback && !['LIVE_ACCEPTANCE_PASS', 'SYSTEM_ACCEPTANCE_PASS'].includes(payload.verdict)) {
    fail('EVIDENCE_RUNTIME_READBACK_VERDICT_MISMATCH');
  }
  if (payload.canonical_record && payload.verdict !== 'CANONICALIZED') fail('EVIDENCE_CANONICAL_RECORD_VERDICT_MISMATCH');
  if (payload.human_authorization && payload.verdict !== 'PRODUCTION') fail('EVIDENCE_HUMAN_AUTHORIZATION_VERDICT_MISMATCH');
  if (['STRUCTURAL_VERIFIER_PASS', 'SEMANTIC_REVIEW_PASS'].includes(payload.verdict) && !payload.provider_check) {
    fail('EVIDENCE_VERDICT_REQUIRES_PROVIDER_CHECK');
  }
  if (['LIVE_ACCEPTANCE_PASS', 'SYSTEM_ACCEPTANCE_PASS'].includes(payload.verdict) && !payload.runtime_readback) {
    fail('EVIDENCE_VERDICT_REQUIRES_RUNTIME_READBACK');
  }
  if (payload.verdict === 'CANONICALIZED' && !payload.canonical_record) fail('EVIDENCE_VERDICT_REQUIRES_CANONICAL_RECORD');
  if (payload.verdict === 'PRODUCTION' && !payload.human_authorization) fail('EVIDENCE_VERDICT_REQUIRES_HUMAN_AUTHORIZATION');

  const id = evidenceDigest(payload);
  if (input.id !== undefined && input.id !== id) fail('EVIDENCE_ID_DIGEST_MISMATCH');
  return Object.freeze({...payload, id});
}

export function canReuseDeterministicEvidence(existing, requested) {
  const left = validateEvidenceRecord(existing);
  const right = validateEvidenceRecord(requested);
  if (left.verdict !== right.verdict ||
      left.acceptance_contract.id !== right.acceptance_contract.id ||
      left.acceptance_contract.digest !== right.acceptance_contract.digest ||
      !left.material_state_digest || left.material_state_digest !== right.material_state_digest ||
      left.target.tree_oid !== right.target.tree_oid ||
      left.target.content_manifest_digest !== right.target.content_manifest_digest ||
      canonicalJson(left.target.covered_bytes) !== canonicalJson(right.target.covered_bytes)) return false;
  return true;
}

export const EXACT_TARGET_EVIDENCE_VERDICTS = VERDICTS;
