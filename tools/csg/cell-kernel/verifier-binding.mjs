import { createHash } from 'node:crypto';
import path from 'node:path';

export const VERIFIER_BINDING_SCHEMA = 'v48.verifier-binding-receipt.v1';
const GIT_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const fail = (code, detail='') => { throw new Error(detail ? `${code}:${detail}` : code); };
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const digest = v => `sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const reqDigest = (v, name) => { if (typeof v !== 'string' || !DIGEST_RE.test(v)) fail(`INVALID_${name}`); return v; };
const reqGit = (v, name) => { if (typeof v !== 'string' || !GIT_RE.test(v)) fail(`INVALID_${name}`); return v; };
const reqPath = (v, name) => { if (typeof v !== 'string' || !v.trim()) fail(`INVALID_${name}`); return path.resolve(v); };

function exactWorktree(worktreeRoot, cwd) {
  const root = reqPath(worktreeRoot, 'WORKTREE_ROOT');
  const dir = reqPath(cwd, 'CWD');
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('CWD_OUTSIDE_WORKTREE');
  return { worktree_root: root, cwd: dir };
}

export function computeVerifierBundleDigest({ verifier_source_digest, expected_case_digests, anchor_digest } = {}) {
  const source = reqDigest(verifier_source_digest, 'VERIFIER_SOURCE_DIGEST');
  const anchor = reqDigest(anchor_digest, 'VERIFIER_ANCHOR_DIGEST');
  if (!Array.isArray(expected_case_digests) || expected_case_digests.length < 1) fail('EXPECTED_CASE_DIGESTS_REQUIRED');
  const cases = expected_case_digests.map(v => reqDigest(v, 'EXPECTED_CASE_DIGEST')).sort();
  return digest({ verifier_source_digest:source, expected_case_digests:cases, anchor_digest:anchor });
}

export function createVerifierBindingReceipt(input = {}) {
  const wt = exactWorktree(input.worktree_root, input.cwd);
  const receipt = {
    schema: VERIFIER_BINDING_SCHEMA,
    candidate_commit: reqGit(input.candidate_commit, 'CANDIDATE_COMMIT'),
    candidate_tree: reqGit(input.candidate_tree, 'CANDIDATE_TREE'),
    ...wt,
    contract_digest: reqDigest(input.contract_digest, 'CONTRACT_DIGEST'),
    verifier_digest: reqDigest(input.verifier_digest, 'VERIFIER_DIGEST'),
  };
  receipt.binding_digest = digest(receipt);
  return receipt;
}

export function validateVerifierBindingReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('VERIFIER_BINDING_RECEIPT_REQUIRED');
  if (receipt.schema !== VERIFIER_BINDING_SCHEMA) fail('UNSUPPORTED_VERIFIER_BINDING_SCHEMA');
  const normalized = createVerifierBindingReceipt(receipt);
  if (receipt.binding_digest !== normalized.binding_digest) fail('VERIFIER_BINDING_DIGEST_MISMATCH');
  return normalized;
}

function reqCount(v, name) {
  if (!Number.isSafeInteger(v) || v < 0) fail(`INVALID_${name}`);
  return v;
}

export function admitVerifierOutcome(receipt, observation = {}) {
  const bound = validateVerifierBindingReceipt(receipt);
  const observedWt = exactWorktree(observation.worktree_root, observation.cwd);
  for (const [field, actual] of [
    ['candidate_commit', reqGit(observation.candidate_commit, 'OBSERVED_CANDIDATE_COMMIT')],
    ['candidate_tree', reqGit(observation.candidate_tree, 'OBSERVED_CANDIDATE_TREE')],
    ['worktree_root', observedWt.worktree_root],
    ['cwd', observedWt.cwd],
    ['contract_digest', reqDigest(observation.contract_digest, 'OBSERVED_CONTRACT_DIGEST')],
    ['verifier_digest', reqDigest(observation.verifier_digest, 'OBSERVED_VERIFIER_DIGEST')],
  ]) if (bound[field] !== actual) fail(`VERIFIER_BINDING_MISMATCH_${field.toUpperCase()}`);

  const total = reqCount(observation.tests_total, 'TESTS_TOTAL');
  const pass = reqCount(observation.tests_pass, 'TESTS_PASS');
  const failCount = reqCount(observation.tests_fail, 'TESTS_FAIL');
  const skipped = reqCount(observation.tests_skipped, 'TESTS_SKIPPED');
  if (total === 0) fail('ZERO_TESTS_CANNOT_PASS');
  if (pass === 0 && skipped === total) fail('ALL_TESTS_SKIPPED_CANNOT_PASS');
  if (pass + failCount + skipped !== total) fail('TEST_COUNTS_INCONSISTENT');
  if (observation.candidate_verdict !== 'PASS' || observation.candidate_exit_code !== 0 || failCount !== 0 || pass === 0) fail('CANDIDATE_VERIFICATION_FAILED');

  return {
    accepted:true,
    binding_digest:bound.binding_digest,
    candidate_commit:bound.candidate_commit,
    candidate_tree:bound.candidate_tree,
    tests:{ total, pass, fail:failCount, skipped },
    source_checkout_verdict:observation.source_checkout_verdict ?? null,
  };
}
