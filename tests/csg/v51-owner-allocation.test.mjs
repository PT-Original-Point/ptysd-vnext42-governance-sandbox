import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  OWNER_ALLOCATION_INVARIANTS,
  MAX_OWNER_LEASE_DURATION_SECONDS,
  allocateOwnerAtCanonicalPromotion,
  assertCanonicalOwnerGenerationAllocatedAtSelection,
  assertCanonicalOwnerLeaseStartsAtOrAfterCheckpointRecordedAt,
  assertCanonicalPromotionSameSourceReadback,
  assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease,
  assertOwnerGenerationAllocationUsesFreshCanonicalPrestate
} from '../../scripts/csg-owner-allocation.mjs';

const regression = JSON.parse(fs.readFileSync(
  path.resolve('governance/csg/v51/regressions/OWNER_ALLOCATION_ARCHITECTURE_CORRECTION-v1.json'),
  'utf8'
));
const canonical = {
  control_ref: 'refs/heads/v45/factory-control',
  control_commit: 'd39486601d851e31256852a24e9c1393b9046fe5',
  checkpoint_seq: 200,
  checkpoint_digest: 'sha256:2cd708bb96179b7ef416ab5a7616f7dff50030567f56d7506a7182f6ceda600d',
  owner_generation: 5
};
const candidate = () => ({
  candidate_instance_id: '785b137a-083a-433f-bff9-c4ac97d07888',
  candidate_status: 'NONCANONICAL_PREPARED_NOT_DISPATCHED',
  proposed_owner_generation_policy: 'NEXT_AVAILABLE_AT_PROMOTION',
  owner_generation: null,
  lease_duration_seconds: 14_400,
  lease_until: null,
  execution_owner_allocated: false,
  owner_scope: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION'
});
const checkpoint = () => ({
  recorded_at: '2026-10-01T05:16:29Z',
  owner: null,
  atomic: {state: 'PREPARED_NOT_DISPATCHED'}
});
const casEvidence = ({transactionId = 'CAS-CP200-201-TEST', selectedAt = '2026-10-01T05:20:00Z'} = {}) => {
  const base = {
    transaction_id: transactionId,
    read_in_promotion_cas: true,
    same_source_readback: true,
    source_ref: canonical.control_ref,
    source_commit: canonical.control_commit,
    checkpoint_seq: canonical.checkpoint_seq,
    checkpoint_digest: canonical.checkpoint_digest,
    owner_generation: canonical.owner_generation,
    observed_at: '2026-10-01T05:19:59Z'
  };
  return {
    expectedCanonical: canonical,
    canonicalReadback: {...base},
    durableConsumedGenerationReadback: {...base, generation_values: [1, 2, 3, 4, 5]},
    promotion: {
      phase: 'CANONICAL_PROMOTION_CAS',
      transaction_id: transactionId,
      transaction_started_at: '2026-10-01T05:19:58Z',
      selected_at: selectedAt,
      canonical_write_required: true,
      same_source_readback_required: true
    }
  };
};

test('NONCANONICAL_PREPARED_CANDIDATE_MUST_NOT_HAVE_ACTIVE_OWNER_LEASE', () => {
  assert.equal(regression.required_verifier_invariants[0], OWNER_ALLOCATION_INVARIANTS.candidate);
  assert.equal(assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease(candidate(), checkpoint()).owner_generation, null);
  const invalidCandidate = {...candidate(), owner_generation: 9, lease_until: '2026-10-01T08:22:13Z'};
  const invalidCheckpoint = {...checkpoint(), owner: {
    principal_id: 'executor', owner_generation: 9,
    scope: invalidCandidate.owner_scope, lease_until: invalidCandidate.lease_until
  }};
  assert.throws(
    () => assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease(invalidCandidate, invalidCheckpoint),
    {code: regression.expected_failure_codes.candidate_has_active_owner}
  );
});

test('CANONICAL_OWNER_GENERATION_ALLOCATED_AT_SELECTION', () => {
  assert.equal(regression.required_verifier_invariants[1], OWNER_ALLOCATION_INVARIANTS.selectedAtPromotion);
  const c = candidate();
  const cp = checkpoint();
  const allocated = allocateOwnerAtCanonicalPromotion({
    candidate: c,
    checkpoint: cp,
    ...casEvidence(),
    selectedOwner: {principal_id: 'executor-selected-by-cas', scope: c.owner_scope}
  });
  assert.equal(allocated.canonical_selection_status, 'SELECTED');
  assert.equal(allocated.selection_phase, 'CANONICAL_PROMOTION_CAS');
  assert.equal(allocated.owner_generation, 6);
  assert.equal(allocated.allocated_at, '2026-10-01T05:20:00.000Z');
  assert.equal(allocated.canonical_checkpoint_recorded_at, allocated.recorded_at);
  assert.equal(c.owner_generation, null);
  assert.equal(c.lease_until, null);
  assert.equal(cp.owner, null);
  assert.ok(!casEvidence().durableConsumedGenerationReadback.generation_values.some((generation) =>
    regression.historical_candidate_generation_labels.some((entry) => entry.generation === generation && generation >= 6)
  ));
  assert.equal(assertCanonicalOwnerGenerationAllocatedAtSelection(c, allocated), allocated);
});

test('CANONICAL_OWNER_LEASE_STARTS_AT_OR_AFTER_CHECKPOINT_RECORDED_AT', () => {
  assert.equal(regression.required_verifier_invariants[2], OWNER_ALLOCATION_INVARIANTS.leaseTiming);
  const c = candidate();
  const allocated = allocateOwnerAtCanonicalPromotion({
    candidate: c,
    checkpoint: checkpoint(),
    ...casEvidence(),
    selectedOwner: {principal_id: 'executor-selected-by-cas', scope: c.owner_scope}
  });
  assert.equal(allocated.recorded_at, '2026-10-01T05:20:00.000Z');
  assert.equal(allocated.lease_starts_at, allocated.recorded_at);
  assert.equal(Date.parse(allocated.lease_until) - Date.parse(allocated.lease_starts_at),
    MAX_OWNER_LEASE_DURATION_SECONDS * 1000);
  assert.equal(assertCanonicalOwnerLeaseStartsAtOrAfterCheckpointRecordedAt(
    allocated, allocated.canonical_checkpoint_recorded_at
  ), allocated);
  assert.throws(
    () => assertCanonicalOwnerLeaseStartsAtOrAfterCheckpointRecordedAt(allocated, checkpoint().recorded_at),
    {code: regression.expected_failure_codes.invalid_lease_start}
  );
  assert.throws(
    () => assertCanonicalOwnerLeaseStartsAtOrAfterCheckpointRecordedAt(
      {...allocated, lease_starts_at: '2026-10-01T05:19:59Z'}, allocated.recorded_at
    ),
    {code: regression.expected_failure_codes.invalid_lease_start}
  );
});

test('OWNER_GENERATION_ALLOCATION_USES_FRESH_CANONICAL_PRESTATE', () => {
  assert.equal(regression.required_verifier_invariants[3], OWNER_ALLOCATION_INVARIANTS.freshPrestate);
  const evidence = casEvidence();
  assert.equal(assertOwnerGenerationAllocationUsesFreshCanonicalPrestate({
    candidate: candidate(), checkpoint: checkpoint(), ...evidence
  }), true);
  assert.throws(
    () => assertOwnerGenerationAllocationUsesFreshCanonicalPrestate({
      candidate: candidate(), checkpoint: checkpoint(),
      ...evidence,
      canonicalReadback: {...evidence.canonicalReadback, owner_generation: 4}
    }),
    {code: regression.expected_failure_codes.stale_or_mismatched_prestate}
  );
  assert.throws(
    () => assertOwnerGenerationAllocationUsesFreshCanonicalPrestate({
      candidate: candidate(), checkpoint: checkpoint(),
      ...evidence,
      durableConsumedGenerationReadback: {
        ...evidence.durableConsumedGenerationReadback,
        observed_at: '2026-10-01T05:19:00Z'
      }
    }),
    {code: regression.expected_failure_codes.stale_or_mismatched_prestate}
  );
});

test('post-write same-source readback binds the selection transaction and allocated identity', () => {
  const c = candidate();
  const allocated = allocateOwnerAtCanonicalPromotion({
    candidate: c,
    checkpoint: checkpoint(),
    ...casEvidence(),
    selectedOwner: {principal_id: 'executor-selected-by-cas', scope: c.owner_scope}
  });
  const readback = {
    transaction_id: allocated.transaction_id,
    read_after_canonical_write: true,
    candidate_instance_id: allocated.candidate_instance_id,
    owner_generation: allocated.owner_generation,
    recorded_at: allocated.recorded_at,
    lease_until: allocated.lease_until,
    canonical_control_commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    checkpoint_digest: 'sha256:' + 'b'.repeat(64)
  };
  assert.equal(assertCanonicalPromotionSameSourceReadback(allocated, readback), readback);
  assert.throws(() => assertCanonicalPromotionSameSourceReadback(allocated, {
    ...readback,
    owner_generation: 9
  }), {code: 'CANONICAL_OWNER_PROMOTION_SAME_SOURCE_READBACK_MISMATCH'});
});

test('generation labels 6 through 9 remain historical and do not allocate this candidate owner', () => {
  assert.deepEqual(regression.historical_candidate_generation_labels.map((item) => item.generation), [6, 7, 8, 9]);
  assert.ok(regression.historical_candidate_generation_labels.every((item) =>
    item.candidate_state === 'PREPARED_NOT_DISPATCHED' && item.canonical_selection === false &&
    item.execution_fence === null && item.active_job_refs.length === 0 && item.unresolved_effect_refs.length === 0
  ));
  assert.equal(candidate().owner_generation, null);
  assert.equal(candidate().lease_until, null);
});
