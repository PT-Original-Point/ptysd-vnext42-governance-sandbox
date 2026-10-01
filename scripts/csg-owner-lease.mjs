export const ACTIVE_OWNER_LEASE_REGRESSION_ID =
  'ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT';

export const OWNER_LEASE_ALREADY_EXPIRED_AT_CHECKPOINT_CREATION =
  'OWNER_LEASE_ALREADY_EXPIRED_AT_CHECKPOINT_CREATION';

function ownerClaim(owner) {
  if (!owner) return null;
  return [owner.principal_id, owner.owner_generation, owner.scope, owner.lease_until];
}

/**
 * Enforce lease freshness when a checkpoint introduces or renews an owner
 * claim. A byte-for-byte carried owner may already be expired; that is valid
 * reconciliation evidence and must remain a stale-owner candidate.
 */
export function assertOwnerLeaseValidAtCheckpointCreation(checkpoint, previousCheckpoint = null) {
  if (checkpoint?.lifecycle !== 'ACTIVE' || checkpoint?.owner == null) return checkpoint;

  const currentClaim = ownerClaim(checkpoint.owner);
  const previousClaim = ownerClaim(previousCheckpoint?.owner);
  if (previousClaim && currentClaim.every((value, index) => value === previousClaim[index])) {
    return checkpoint;
  }

  const recordedAt = Date.parse(checkpoint.recorded_at);
  const leaseUntil = Date.parse(checkpoint.owner.lease_until);
  if (!Number.isFinite(recordedAt) || !Number.isFinite(leaseUntil) || leaseUntil <= recordedAt) {
    const error = new Error(OWNER_LEASE_ALREADY_EXPIRED_AT_CHECKPOINT_CREATION);
    error.code = OWNER_LEASE_ALREADY_EXPIRED_AT_CHECKPOINT_CREATION;
    error.regressionId = ACTIVE_OWNER_LEASE_REGRESSION_ID;
    throw error;
  }
  return checkpoint;
}
