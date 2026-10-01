import {
  assertOwnerGenerationIsNextAvailable,
  nextAvailableOwnerGeneration,
  failWithCode
} from './csg-r2-promotion-assertions.mjs';

export const OWNER_ALLOCATION_INVARIANTS = Object.freeze({
  candidate: 'NONCANONICAL_PREPARED_CANDIDATE_MUST_NOT_HAVE_ACTIVE_OWNER_LEASE',
  selectedAtPromotion: 'CANONICAL_OWNER_GENERATION_ALLOCATED_AT_SELECTION',
  leaseTiming: 'CANONICAL_OWNER_LEASE_STARTS_AT_OR_AFTER_CHECKPOINT_RECORDED_AT',
  freshPrestate: 'OWNER_GENERATION_ALLOCATION_USES_FRESH_CANONICAL_PRESTATE'
});

export const MAX_OWNER_LEASE_DURATION_SECONDS = 14_400;

const CANDIDATE_INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function validTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validLeaseDuration(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_OWNER_LEASE_DURATION_SECONDS;
}

function requireCandidateIdentity(candidate) {
  if (typeof candidate?.candidate_instance_id !== 'string' ||
      !CANDIDATE_INSTANCE_ID.test(candidate.candidate_instance_id)) {
    failWithCode('CANDIDATE_INSTANCE_ID_INVALID');
  }
}

export function assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease(candidate, checkpoint) {
  requireCandidateIdentity(candidate);
  if (candidate?.candidate_status !== 'NONCANONICAL_PREPARED_NOT_DISPATCHED' ||
      checkpoint?.atomic?.state !== 'PREPARED_NOT_DISPATCHED' ||
      candidate?.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION' ||
      candidate?.execution_owner_allocated !== false ||
      candidate?.owner_generation !== null || candidate?.lease_until !== null ||
      checkpoint?.owner !== null || !validLeaseDuration(candidate?.lease_duration_seconds)) {
    failWithCode(OWNER_ALLOCATION_INVARIANTS.candidate);
  }
  return candidate;
}

export function assertOwnerGenerationAllocationUsesFreshCanonicalPrestate({
  candidate,
  checkpoint,
  expectedCanonical,
  canonicalReadback,
  durableConsumedGenerationReadback,
  promotion
}) {
  assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease(candidate, checkpoint);
  const startedAt = validTime(promotion?.transaction_started_at);
  const selectedAt = validTime(promotion?.selected_at);
  const transactionId = promotion?.transaction_id;
  const exactCanonical = expectedCanonical &&
    typeof expectedCanonical.control_ref === 'string' &&
    SHA1.test(expectedCanonical.control_commit ?? '') &&
    Number.isSafeInteger(expectedCanonical.checkpoint_seq) &&
    SHA256.test(expectedCanonical.checkpoint_digest ?? '') &&
    Number.isSafeInteger(expectedCanonical.owner_generation);
  const matchesPrestate = (readback) => readback?.read_in_promotion_cas === true &&
    readback?.same_source_readback === true &&
    readback?.transaction_id === transactionId &&
    readback?.source_ref === expectedCanonical?.control_ref &&
    readback?.source_commit === expectedCanonical?.control_commit &&
    readback?.checkpoint_seq === expectedCanonical?.checkpoint_seq &&
    readback?.checkpoint_digest === expectedCanonical?.checkpoint_digest &&
    readback?.owner_generation === expectedCanonical?.owner_generation &&
    validTime(readback?.observed_at) !== null &&
    validTime(readback.observed_at) >= startedAt &&
    validTime(readback.observed_at) <= selectedAt;

  if (promotion?.phase !== 'CANONICAL_PROMOTION_CAS' ||
      typeof transactionId !== 'string' || transactionId.length === 0 ||
      startedAt === null || selectedAt === null || selectedAt < startedAt ||
      !exactCanonical || !matchesPrestate(canonicalReadback) ||
      !matchesPrestate(durableConsumedGenerationReadback) ||
      !Array.isArray(durableConsumedGenerationReadback?.generation_values) ||
      durableConsumedGenerationReadback.generation_values.some((value) => !Number.isSafeInteger(value) || value < 1) ||
      new Set(durableConsumedGenerationReadback.generation_values).size !== durableConsumedGenerationReadback.generation_values.length ||
      !durableConsumedGenerationReadback.generation_values.includes(expectedCanonical.owner_generation)) {
    failWithCode(OWNER_ALLOCATION_INVARIANTS.freshPrestate);
  }
  return true;
}

export function assertCanonicalOwnerGenerationAllocatedAtSelection(candidate, selection) {
  requireCandidateIdentity(candidate);
  if (candidate.owner_generation !== null || candidate.lease_until !== null ||
      selection?.candidate_instance_id !== candidate.candidate_instance_id ||
      selection?.selection_phase !== 'CANONICAL_PROMOTION_CAS' ||
      selection?.canonical_selection_status !== 'SELECTED' ||
      selection?.transaction_id !== selection?.prestate_transaction_id ||
      !Number.isSafeInteger(selection?.owner_generation) || selection.owner_generation < 1 ||
      selection?.allocated_at !== selection?.recorded_at ||
      selection?.canonical_checkpoint_recorded_at !== selection?.recorded_at ||
      selection?.owner?.owner_generation !== selection?.owner_generation ||
      selection?.owner?.lease_until !== selection?.lease_until) {
    failWithCode(OWNER_ALLOCATION_INVARIANTS.selectedAtPromotion);
  }
  return selection;
}

export function assertCanonicalOwnerLeaseStartsAtOrAfterCheckpointRecordedAt(selection, checkpointRecordedAt) {
  const checkpointTime = validTime(checkpointRecordedAt);
  const leaseStart = validTime(selection?.lease_starts_at);
  const leaseEnd = validTime(selection?.lease_until);
  if (checkpointTime === null || leaseStart === null || leaseEnd === null ||
      selection?.canonical_checkpoint_recorded_at !== checkpointRecordedAt ||
      selection?.recorded_at !== checkpointRecordedAt ||
      selection?.owner?.lease_until !== selection?.lease_until ||
      leaseStart < checkpointTime || leaseEnd <= leaseStart ||
      !validLeaseDuration(selection?.lease_duration_seconds) ||
      leaseEnd - leaseStart !== selection.lease_duration_seconds * 1000 ||
      selection?.recorded_at !== checkpointRecordedAt) {
    failWithCode(OWNER_ALLOCATION_INVARIANTS.leaseTiming);
  }
  return selection;
}

/**
 * Pure allocation contract for use inside a provider's canonical promotion
 * CAS transaction. This function does not write the provider or make a
 * noncanonical candidate authoritative.
 */
export function allocateOwnerAtCanonicalPromotion({
  candidate,
  checkpoint,
  expectedCanonical,
  canonicalReadback,
  durableConsumedGenerationReadback,
  promotion,
  selectedOwner
}) {
  assertOwnerGenerationAllocationUsesFreshCanonicalPrestate({
    candidate,
    checkpoint,
    expectedCanonical,
    canonicalReadback,
    durableConsumedGenerationReadback,
    promotion
  });
  if (!validLeaseDuration(candidate.lease_duration_seconds) ||
      promotion?.phase !== 'CANONICAL_PROMOTION_CAS' ||
      promotion?.canonical_write_required !== true ||
      promotion?.same_source_readback_required !== true ||
      typeof selectedOwner?.principal_id !== 'string' || selectedOwner.principal_id.length === 0 ||
      selectedOwner?.scope !== candidate.owner_scope) {
    failWithCode(OWNER_ALLOCATION_INVARIANTS.selectedAtPromotion);
  }

  const ownerGeneration = nextAvailableOwnerGeneration(
    expectedCanonical.owner_generation,
    durableConsumedGenerationReadback.generation_values
  );
  assertOwnerGenerationIsNextAvailable(
    ownerGeneration,
    expectedCanonical.owner_generation,
    durableConsumedGenerationReadback.generation_values
  );
  const recordedAt = new Date(Date.parse(promotion.selected_at)).toISOString();
  const leaseUntil = new Date(Date.parse(recordedAt) + candidate.lease_duration_seconds * 1000).toISOString();
  const selection = {
    candidate_instance_id: candidate.candidate_instance_id,
    selection_phase: 'CANONICAL_PROMOTION_CAS',
    canonical_selection_status: 'SELECTED',
    transaction_id: promotion.transaction_id,
    prestate_transaction_id: canonicalReadback.transaction_id,
    allocated_at: recordedAt,
    recorded_at: recordedAt,
    canonical_checkpoint_recorded_at: recordedAt,
    lease_starts_at: recordedAt,
    lease_duration_seconds: candidate.lease_duration_seconds,
    owner_generation: ownerGeneration,
    lease_until: leaseUntil,
    owner: {
      principal_id: selectedOwner.principal_id,
      owner_generation: ownerGeneration,
      scope: selectedOwner.scope,
      lease_until: leaseUntil
    },
    canonical_write_required: promotion.canonical_write_required,
    same_source_readback_required: promotion.same_source_readback_required
  };
  assertCanonicalOwnerGenerationAllocatedAtSelection(candidate, selection);
  assertCanonicalOwnerLeaseStartsAtOrAfterCheckpointRecordedAt(selection, recordedAt);
  return selection;
}

export function assertCanonicalPromotionSameSourceReadback(selection, readback) {
  if (readback?.transaction_id !== selection?.transaction_id ||
      readback?.read_after_canonical_write !== true ||
      readback?.candidate_instance_id !== selection?.candidate_instance_id ||
      readback?.owner_generation !== selection?.owner_generation ||
      readback?.recorded_at !== selection?.recorded_at ||
      readback?.lease_until !== selection?.lease_until ||
      SHA1.test(readback?.canonical_control_commit ?? '') !== true ||
      SHA256.test(readback?.checkpoint_digest ?? '') !== true) {
    failWithCode('CANONICAL_OWNER_PROMOTION_SAME_SOURCE_READBACK_MISMATCH');
  }
  return readback;
}
