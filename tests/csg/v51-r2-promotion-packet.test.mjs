import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
  assertOwnerGenerationIsNextAvailable,
  nextAvailableOwnerGeneration,
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
const ownerAllocationArchitecture = JSON.parse(fs.readFileSync(
  path.resolve('governance/csg/v51/regressions/OWNER_ALLOCATION_ARCHITECTURE_CORRECTION-v1.json'),
  'utf8'
));
const trustRootUpgradeLane = JSON.parse(fs.readFileSync(
  path.resolve('governance/csg/v51/trust-root-lanes/TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED-v1.json'),
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

test('separate CP201 promotion packet keeps canonical CP200 selected and binds the frozen source pair', () => {
  const canonicalPointer = JSON.parse(fs.readFileSync(path.resolve('governance/csg/current.json'), 'utf8'));
  const canonicalCheckpoint = JSON.parse(fs.readFileSync(path.resolve('governance/csg/checkpoints/000200.json'), 'utf8'));
  const candidateCheckpoint = JSON.parse(fs.readFileSync(path.resolve('governance/csg/checkpoints/000201.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.resolve('governance/csg/v51/readbacks/R2-03-CP201-PROMOTION-CANDIDATE-MANIFEST-20261001.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.resolve(manifest.source_bindings_path), 'utf8'));

  assert.equal(canonicalPointer.checkpoint_seq, 200);
  assert.equal(canonicalPointer.checkpoint_path, 'governance/csg/checkpoints/000200.json');
  assert.equal(canonicalPointer.checkpoint_digest, canonicalCheckpoint.payload_digest);
  assert.equal(candidateCheckpoint.checkpoint_seq, 201);
  assert.equal(candidateCheckpoint.previous_checkpoint_ref.revision, manifest.base_commit);
  assert.equal(candidateCheckpoint.owner, null);
  assert.equal(manifest.candidate_status, 'NONCANONICAL_PREPARED_NOT_DISPATCHED');
  assert.equal(manifest.owner_generation, null);
  assert.equal(manifest.lease_until, null);
  assert.equal(manifest.execution_owner_allocated, false);
  assert.equal(manifest.proposed_owner_generation_policy, 'NEXT_AVAILABLE_AT_PROMOTION');
  assert.equal(manifest.control_pointer_changes_canonical_authority, false);
  const basePointerBlob = execFileSync('git', ['rev-parse', manifest.base_commit + ':governance/csg/current.json'], {encoding: 'utf8'}).trim();
  const candidatePointerBlob = execFileSync('git', ['rev-parse', ':governance/csg/current.json'], {encoding: 'utf8'}).trim();
  assert.equal(candidatePointerBlob, basePointerBlob);

  assert.deepEqual(
    binding.source_candidates.map(({pr_number, origin_exact_sha, tree_sha}) => ({pr_number, origin_exact_sha, tree_sha})),
    [
      {pr_number: 342, origin_exact_sha: 'b26d400af6c232ad7fcf253c48f9066cbddc2d12', tree_sha: 'a49a9686bde16155a3b3463f5cd4e5be4d3cd86f'},
      {pr_number: 377, origin_exact_sha: 'a5a2b134eb1501dc644678ab5ad1e6700f99bff6', tree_sha: '3477dace4e602a9e9a77cf7c86a3884c65c1ac2d'}
    ]
  );
  for (const source of binding.source_candidates) {
    assert.equal(source.pr_state, 'OPEN');
    assert.equal(source.draft, true);
    assert.equal(source.merged, false);
    assert.equal(source.commit_count, 1);
    assert.equal(source.semantic_review.verdict, 'PENDING_CURRENT_HEAD');
    assert.equal(source.semantic_review.target_source_pair.length, 2);
    assert.equal(source.checks.find((item) => item.name === 'csg-trusted-verifier').verdict, 'PASS_EXACT_HEAD');
    assert.equal(source.checks.find((item) => item.name === 'bounded-driver-acceptance').verdict, 'SKIPPED_NOT_PASS');
  }
  assert.equal(binding.qualification_state.synthetic_integration, 'PASS');
  assert.equal(binding.qualification_state.synthetic_integration_is_live_acceptance, false);
  assert.equal(binding.qualification_state.live_trust_provisioning, 'NOT_ACCEPTED');
  assert.equal(binding.qualification_state.live_provider_session_route, 'NOT_ACCEPTED');
  assert.equal(binding.qualification_state.live_supervisor_heartbeat_route, 'NOT_ACCEPTED');
  assert.equal(binding.qualification_state.live_signed_evidence_path, 'NOT_ACCEPTED');
  assert.equal(binding.owner_allocation.owner_generation, null);
  assert.equal(binding.owner_allocation.lease_until, null);
  assert.equal(binding.owner_allocation.gen10_created, false);
  const historical378 = binding.historical_observation_evidence.find((item) => item.pr_number === 378);
  assert.equal(historical378.classification, 'HISTORICAL_OBSERVATION_EVIDENCE');
  assert.equal(historical378.verdict_portability, 'VERDICT_NOT_PORTABLE_TO_CURRENT_SOURCE_PAIR');
  assert.equal(historical378.original_bytes_preserved, true);
  assert.equal(historical378.rebuilt_for_source_sha_drift, false);
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
  const good = checkpoint(9, '2026-10-01T08:22:13Z', '2026-10-01T04:22:13Z');
  const previous = {owner: owner(5, '2026-09-29T18:44:11Z')};
  assert.equal(assertOwnerLeaseValidAtCheckpointCreation(good, previous), good);
});

test('a lease equal to checkpoint recorded_at is rejected', () => {
  const equal = checkpoint(9, '2026-10-01T04:22:13Z', '2026-10-01T04:22:13Z');
  const previous = {owner: owner(5, '2026-09-29T18:44:11Z')};
  assert.throws(
    () => assertOwnerLeaseValidAtCheckpointCreation(equal, previous),
    {code: regression.expected_failure_code}
  );
});

test('an unconsumed generation 6 remains the next available identity when policy does not require skipping rejected candidates', () => {
  const fixture = generationRegression.unconsumed_candidate_fixture;
  assert.equal(fixture.classification, 'GEN6_UNCONSUMED_CANDIDATE');
  assert.equal(fixture.provider_addressable_owner_claim, false);
  assert.equal(fixture.durable_lease_or_fence_or_job_or_receipt_or_effect, false);
  assert.equal(fixture.policy_monotonic_nonreuse_required, false);
  assert.equal(nextAvailableOwnerGeneration(fixture.canonical_generation, fixture.durably_consumed_generations), 6);
  assert.throws(
    () => assertOwnerGenerationIsNextAvailable(7, 5, [1, 2, 3, 4, 5]),
    {code: 'NEW_OWNER_GENERATION_NOT_NEXT_AVAILABLE'}
  );
});

test('the prior gen9 allocation regression remains preserved as historical candidate evidence', () => {
  assert.equal(generationRegression.regression_id, 'NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION');
  assert.equal(generationRegression.candidate_fixture.prior_generation_six_classification, 'GEN6_BURNED_DURABLE_IDENTITY');
  assert.equal(generationRegression.candidate_fixture.expected_available_generation, 9);
  assert.ok(ownerAllocationArchitecture.historical_documents_to_preserve_unchanged.includes(
    'governance/csg/v51/regressions/NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION-v1.json'
  ));
  assert.deepEqual(ownerAllocationArchitecture.historical_candidate_generation_labels.map((item) => item.generation), [6, 7, 8, 9]);
  assert.ok(ownerAllocationArchitecture.historical_candidate_generation_labels.every((item) =>
    item.classification === 'HISTORICAL_CANDIDATE_ONLY_NOT_CONSUMED_EXECUTION_OWNER'
  ));
});

test('candidate-local owner allocation evidence is not classified as protected trust-root enforcement', () => {
  assert.equal(trustRootUpgradeLane.lane_id, 'TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED');
  assert.equal(trustRootUpgradeLane.status, 'REQUIRED_SEPARATE_LANE_NOT_STARTED');
  assert.equal(trustRootUpgradeLane.evidence_boundary.OWNER_ALLOCATION_ARCHITECTURE_SOURCE, 'IMPLEMENTED');
  assert.equal(trustRootUpgradeLane.evidence_boundary.CANDIDATE_LOCAL_OWNER_ALLOCATION_REGRESSION, 'PASS');
  assert.equal(trustRootUpgradeLane.evidence_boundary.CANDIDATE_LOCAL_PROMOTION_PACKET_VERIFIER, 'PASS');
  assert.equal(
    trustRootUpgradeLane.evidence_boundary.PROTECTED_TRUST_ROOT_ENFORCEMENT_OF_OWNER_ALLOCATION_INVARIANTS,
    'NOT_YET_IMPLEMENTED'
  );
  assert.equal(trustRootUpgradeLane.evidence_boundary.candidate_local_evidence_is_protected_enforcement, false);
  assert.equal(trustRootUpgradeLane.separation_guard.trust_root_or_workflow_change_in_candidate_pr_prohibited, true);
  assert.equal(trustRootUpgradeLane.separation_guard.trust_root_or_workflow_mutation_performed, false);
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
  const exact = {pr_number: 342, origin_exact_sha: 'b26d400af6c232ad7fcf253c48f9066cbddc2d12', base_sha: 'd39486601d851e31256852a24e9c1393b9046fe5', tree_sha: 'a49a9686bde16155a3b3463f5cd4e5be4d3cd86f'};
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
