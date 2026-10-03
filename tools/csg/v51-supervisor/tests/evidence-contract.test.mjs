import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canReuseDeterministicEvidence, validateEvidenceRecord} from '../lib/evidence-contract.mjs';

const sha = (char) => `sha256:${char.repeat(64)}`;
const oid = (char) => char.repeat(40);

function evidence(overrides = {}) {
  const value = {
    verdict: 'LOCAL_TEST_PASS',
    target: {
      provider: 'LOCAL_WORKTREE',
      resource: 'tools/csg/v51-supervisor',
      revision: `codex/v51-r2-c7-supervisor-source-20261002@${oid('1')}`,
      content_manifest_digest: sha('2'),
      covered_bytes: [
        {path: 'lib/reconcile.mjs', sha256: sha('3')},
        {path: 'tests/reconcile-scheduler.test.mjs', sha256: sha('4')}
      ]
    },
    acceptance_contract: {id: 'R2-07+C8_LOCAL', digest: sha('5')},
    material_state_digest: sha('6'),
    test_run: {run_id: 'local-test-001', command: 'node --test tools/csg/v51-supervisor/tests/*.test.mjs',
      target_revision: `codex/v51-r2-c7-supervisor-source-20261002@${oid('1')}`,
      recorded_at: '2026-10-02T10:00:01Z',
      exit_code: 0, tests: 26, passed: 26, failed: 0},
    ...overrides
  };
  if (value.verdict !== 'LOCAL_TEST_PASS' && overrides.test_run === undefined) delete value.test_run;
  if (value.verdict === 'LOCAL_TEST_PASS' && overrides.test_run === undefined && overrides.target?.revision) {
    value.test_run = {...value.test_run, target_revision: value.target.revision};
  }
  return value;
}

test('evidence verdict classes remain separate and bind exact target bytes and contract', () => {
  const local = validateEvidenceRecord(evidence());
  const candidate = validateEvidenceRecord(evidence({verdict: 'CANDIDATE'}));
  assert.equal(local.verdict, 'LOCAL_TEST_PASS');
  assert.equal(candidate.verdict, 'CANDIDATE');
  assert.notEqual(local.id, candidate.id);
  assert.deepEqual(local.target.covered_bytes.map((item) => item.path),
    ['lib/reconcile.mjs', 'tests/reconcile-scheduler.test.mjs']);
});

test('provider verifier evidence requires an exact-head check run and job', () => {
  const input = evidence({verdict: 'STRUCTURAL_VERIFIER_PASS',
    target: {...evidence().target, revision: oid('7'), tree_oid: oid('8')},
    provider_check: {run_id: 36994805760, job_id: 110798974295, check_name: 'csg-trusted-verifier',
      target_revision: oid('7'), conclusion: 'success'}});
  assert.equal(validateEvidenceRecord(input).provider_check.target_revision, oid('7'));
  assert.throws(() => validateEvidenceRecord({...input, provider_check: undefined}),
    {code: 'EVIDENCE_VERDICT_REQUIRES_PROVIDER_CHECK'});
  assert.throws(() => validateEvidenceRecord({...input,
    provider_check: {...input.provider_check, target_revision: oid('9')}}),
  {code: 'EVIDENCE_PROVIDER_CHECK_INVALID'});
});

test('local test verdict requires one exact target-bound successful test run', () => {
  const input = evidence();
  assert.equal(validateEvidenceRecord(input).test_run.target_revision, input.target.revision);
  assert.throws(() => validateEvidenceRecord(evidence({test_run: undefined})),
    {code: 'EVIDENCE_VERDICT_REQUIRES_TEST_RUN'});
  assert.throws(() => validateEvidenceRecord(evidence({test_run: {...input.test_run, target_revision: oid('9')}})),
    {code: 'EVIDENCE_TEST_RUN_INVALID'});
});

test('live, system, canonical, and Production claims require their own evidence class', () => {
  const base = evidence({target: {...evidence().target, revision: oid('a'), tree_oid: oid('b')}});
  const missingLive = {...base, verdict: 'LIVE_ACCEPTANCE_PASS'};
  delete missingLive.test_run;
  assert.throws(() => validateEvidenceRecord(missingLive),
    {code: 'EVIDENCE_VERDICT_REQUIRES_RUNTIME_READBACK'});
  const liveInput = {...base, verdict: 'LIVE_ACCEPTANCE_PASS',
    runtime_readback: {provider: 'Factory MCP', resource: 'DESKTOP-1B6PD2P', target_revision: oid('a'),
      readback_id: 'receipt-17', observed_at: '2026-10-02T10:00:00Z'}};
  delete liveInput.test_run;
  const live = validateEvidenceRecord(liveInput);
  assert.equal(live.verdict, 'LIVE_ACCEPTANCE_PASS');
  const canonicalInput = {...base, verdict: 'CANONICALIZED'};
  delete canonicalInput.test_run;
  assert.throws(() => validateEvidenceRecord(canonicalInput),
    {code: 'EVIDENCE_VERDICT_REQUIRES_CANONICAL_RECORD'});
  const productionInput = {...base, verdict: 'PRODUCTION'};
  delete productionInput.test_run;
  assert.throws(() => validateEvidenceRecord(productionInput),
    {code: 'EVIDENCE_VERDICT_REQUIRES_HUMAN_AUTHORIZATION'});
});

test('evidence rejects malformed OIDs, byte digests, and non-project-relative paths', () => {
  assert.throws(() => validateEvidenceRecord(evidence({target: {...evidence().target, tree_oid: 'ABC'}})),
    {code: 'EVIDENCE_TREE_OID_INVALID'});
  assert.throws(() => validateEvidenceRecord(evidence({target: {...evidence().target,
    covered_bytes: [{path: '../outside.mjs', sha256: sha('3')} ]}})),
  {code: 'EVIDENCE_COVERED_BYTE_INVALID'});
  assert.throws(() => validateEvidenceRecord(evidence({target: {...evidence().target,
    covered_bytes: [{path: 'lib/reconcile.mjs', sha256: 'sha256:ABC'}]}})),
  {code: 'EVIDENCE_COVERED_BYTE_INVALID'});
});

test('cross-resource reuse requires identical contract, tree, covered bytes, and material state', () => {
  const original = evidence({target: {...evidence().target, tree_oid: oid('c')}});
  const equivalent = evidence({target: {...evidence().target, provider: 'GitHub', resource: 'pull/999',
    revision: oid('d'), tree_oid: oid('c')}});
  assert.equal(canReuseDeterministicEvidence(original, equivalent), true);
  assert.equal(canReuseDeterministicEvidence(original, evidence({target: {...evidence().target,
    tree_oid: oid('e')}})), false);
  assert.equal(canReuseDeterministicEvidence(original, evidence({acceptance_contract:{id:'OTHER',digest:sha('5')},
    target:{...evidence().target,tree_oid:oid('c')}})), false);
  assert.equal(canReuseDeterministicEvidence(original, evidence({material_state_digest:sha('f'),
    target:{...evidence().target,tree_oid:oid('c')}})), false);
});

test('evidence id is a deterministic digest of one exact verdict record', () => {
  const normalized = validateEvidenceRecord(evidence());
  const {id, ...payload} = normalized;
  const expected = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
  assert.match(id, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(id, expected); // evidence IDs use canonical JSON, not insertion-order JSON.
  assert.throws(() => validateEvidenceRecord({...evidence(), id: sha('9')}),
    {code: 'EVIDENCE_ID_DIGEST_MISMATCH'});
});
