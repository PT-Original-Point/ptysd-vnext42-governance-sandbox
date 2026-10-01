import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ACTIVE_OWNER_LEASE_REGRESSION_ID,
  OWNER_LEASE_ALREADY_EXPIRED_AT_CHECKPOINT_CREATION,
  assertOwnerLeaseValidAtCheckpointCreation
} from '../../scripts/csg-owner-lease.mjs';
import {
  assertSourceBindingIdentity,
  assertVerifierClassification,
  assertNormalizedGitOid,
  assertOwnerGenerationAvailable,
  gitOidBytesFromStdout
} from '../../scripts/csg-r2-promotion-assertions.mjs';

const regression = JSON.parse(fs.readFileSync(
  path.resolve('governance/csg/v51/regressions/ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT-v1.json'),
  'utf8'
));
const generationRegression = JSON.parse(fs.readFileSync(
  path.resolve('governance/csg/v51/regressions/NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION-v1.json'),
  'utf8'
));
const oidRegression = JSON.parse(fs.readFileSync(
  path.resolve('governance/csg/v51/regressions/GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX-v1.json'),
  'utf8'
));

const owner = (generation, leaseUntil) => ({
  principal_id: 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',
  owner_generation: generation,
  scope: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION',
  lease_until: leaseUntil
});
const checkpoint = (generation, leaseUntil, recordedAt = '2026-10-01T02:10:02Z') => ({
  lifecycle: 'ACTIVE',
  recorded_at: recordedAt,
  owner: owner(generation, leaseUntil)
});

test('ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT rejects the expired CP201 candidate', () => {
  const bad = checkpoint(6, '2026-09-30T06:14:26Z', '2026-09-30T10:43:20.359Z');
  const previous = {owner: owner(5, '2026-09-29T18:44:11Z')};
  assert.equal(regression.regression_id, ACTIVE_OWNER_LEASE_REGRESSION_ID);
  assert.throws(
    () => assertOwnerLeaseValidAtCheckpointCreation(bad, previous),
    (error) => error.code === regression.expected_failure_code &&
      error.code === OWNER_LEASE_ALREADY_EXPIRED_AT_CHECKPOINT_CREATION &&
      error.regressionId === regression.regression_id
  );
});

test('a fresh owner lease must extend strictly beyond checkpoint recorded_at', () => {
  const good = checkpoint(8, '2026-10-01T07:10:02Z');
  const previous = {owner: owner(5, '2026-09-29T18:44:11Z')};
  assert.equal(assertOwnerLeaseValidAtCheckpointCreation(good, previous), good);
});

test('generation 8 is the next available identity after provider-published generations 6 and 7', () => {
  assert.equal(generationRegression.regression_id, 'NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION');
  assert.equal(generationRegression.candidate_fixture.prior_generation_six_classification, 'GEN6_BURNED_DURABLE_IDENTITY');
  assert.equal(assertOwnerGenerationAvailable(8, 5, [1, 2, 3, 4, 5, 6, 7]), 8);
});

test('owner generation must be greater than the current canonical generation', () => {
  assert.throws(
    () => assertOwnerGenerationAvailable(5, 5, [1, 2, 3, 4, 5]),
    {code: generationRegression.expected_failure_codes.not_greater_than_canonical}
  );
});

test('owner generation must not collide with any durably consumed generation', () => {
  assert.throws(
    () => assertOwnerGenerationAvailable(7, 5, [1, 2, 3, 4, 5, 6, 7]),
    {code: generationRegression.expected_failure_codes.already_durably_consumed}
  );
});

test('an unchanged expired owner remains a stale-owner candidate when carried forward', () => {
  const carried = checkpoint(5, '2026-09-29T18:44:11Z', '2026-09-30T02:52:35Z');
  const previous = {owner: owner(5, '2026-09-29T18:44:11Z')};
  assert.equal(assertOwnerLeaseValidAtCheckpointCreation(carried, previous), carried);
});

test('exact source binding rejects a nearby head or tree', () => {
  const exact = {pr_number: 342, origin_exact_sha: '3cf057c4b28d3c7f225823ede198ac9845e050e0', base_sha: 'd39486601d851e31256852a24e9c1393b9046fe5', tree_sha: '31914fc0473fc339a71f6b06c5a5ca745f74aa1f'};
  assert.equal(assertSourceBindingIdentity(exact, exact), exact);
  assert.throws(() => assertSourceBindingIdentity({...exact, origin_exact_sha: '84ab8ea8ca0bb54ef2af8ced7f71ec65e84570c5'}, exact), {code: 'EXACT_SOURCE_BINDING_MISMATCH'});
});

test('Git OID evidence uses exact lowercase 40-hex bytes and rejects permissive trimming', () => {
  const valid = '0123456789abcdef0123456789abcdef01234567';
  const produced = gitOidBytesFromStdout(Buffer.from(`${valid}\n`, 'ascii'));
  assert.equal(oidRegression.regression_id, 'GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX');
  assert.equal(Buffer.isBuffer(produced), true);
  assert.equal(produced.length, 40);
  assert.equal(produced.toString('ascii'), valid);
  assert.equal(assertNormalizedGitOid(valid), valid);
  assert.equal(gitOidBytesFromStdout(Buffer.from(`${valid}\r\n`, 'ascii')).toString('ascii'), valid);
  for (const malformed of [` ${valid}`, `${valid} `, valid.toUpperCase(), valid.slice(1), `${valid.slice(0, 39)}g`]) {
    assert.throws(() => assertNormalizedGitOid(malformed), {code: oidRegression.verifier_failure_code});
    assert.throws(() => gitOidBytesFromStdout(Buffer.from(`${malformed}\n`, 'ascii')), {code: 'GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL'});
  }
  const highBitOid = Buffer.from(`${valid}\n`, 'ascii');
  highBitOid[0] |= 0x80;
  assert.throws(() => gitOidBytesFromStdout(highBitOid), {code: 'GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL'});
  assert.throws(() => gitOidBytesFromStdout(valid), {code: 'GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL'});
  assert.throws(() => gitOidBytesFromStdout(Buffer.from(`${valid}\n\n`, 'ascii')), {code: 'GIT_OID_PRODUCER_OUTPUT_NOT_CANONICAL'});
});

test('a skipped bounded-driver check is never classified as PASS', () => {
  const candidate = {
    checks: [
      {name: 'csg-trusted-verifier', conclusion: 'success', verdict: 'PASS_EXACT_HEAD'},
      {name: 'bounded-driver-acceptance', conclusion: 'skipped', verdict: 'SKIPPED_NOT_PASS'}
    ],
    semantic_review: {verdict: 'PENDING_CURRENT_HEAD'}
  };
  assert.equal(assertVerifierClassification(candidate), candidate);
  assert.throws(() => assertVerifierClassification({...candidate, checks: candidate.checks.map((item) => item.name === 'bounded-driver-acceptance' ? {...item, verdict: 'PASS'} : item)}), {code: 'SKIPPED_CHECK_MUST_NOT_BE_PROMOTED_TO_PASS'});
});
