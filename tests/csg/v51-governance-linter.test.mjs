import assert from 'node:assert/strict';
import test from 'node:test';
import {assertPromotionEvidence, loadPromotionEvidence} from '../../scripts/csg-verify-v51-r2-promotion-packet.mjs';
import {lintGovernanceCandidate} from '../../scripts/csg-v51-governance-linter.mjs';

const root = process.cwd();
const basePacket = loadPromotionEvidence(root);
const clonePacket = () => structuredClone(basePacket);

test('governance linter passes the normalized CP201 candidate without promoting evidence classes', () => {
  const packet = clonePacket();
  assert.deepEqual(lintGovernanceCandidate(packet), {
    result: 'PASS',
    scope: 'CANDIDATE_LOCAL_STATIC_GOVERNANCE_REGRESSION_ONLY',
    protected_trust_root_enforcement: false
  });
});

test('an unapproved stricter stale-owner policy is rejected', () => {
  const packet = clonePacket();
  packet.policy.payload.coordination.owner_liveness_reconciliation
    .exact_cross_source_liveness_observation_required = true;
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'POLICY_NOT_STRONGER_THAN_HUMAN_SPEC'});
});

test('the phase DAG is acyclic and R2-02B does not wait for R2-03', () => {
  const packet = clonePacket();
  packet.policy.payload.phase_dag.phase_dependencies.R2_02A.push('R2_07');
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'PHASE_DAG_ACYCLIC'});

  const valid = clonePacket();
  valid.policy.payload.phase_dag.phase_dependencies.R2_02B = ['R2_03'];
  assert.throws(() => lintGovernanceCandidate(valid), {
    code: 'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE'
  });
});

test('future phases and R2-06 cannot gate R2-03 or its own Host route', () => {
  const packet = clonePacket();
  packet.policy.payload.phase_dag.r2_03_acceptance_requires.push('R2_06_LIVE_INSTALL_ACCEPTANCE_PASS');
  assert.throws(() => lintGovernanceCandidate(packet), {
    code: 'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE'
  });

  const route = clonePacket();
  route.policy.payload.factory_mcp.host_powershell
    .authorized_scope_requires.push('R2_06_LIVE_INSTALL_ACCEPTANCE_PASS');
  assert.throws(() => lintGovernanceCandidate(route), {code: 'NO_METADATA_TRANSPORT_DENIAL'});
});

test('stale R1 phase names are rejected from the current candidate payload', () => {
  const packet = clonePacket();
  packet.policy.payload.factory_mcp.host_powershell
    .authorized_scope_requires.push('R1_04_QUALIFICATION');
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_STALE_PHASE_NAMES'});
});

test('pending semantic review is metadata and does not block R2-03', () => {
  const packet = clonePacket();
  packet.mission.payload.r2_03_acceptance.semantic_review_required = true;
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_INVENTED_REVIEW_GATE'});

  const represented = clonePacket();
  represented.bindings.source_candidates[0].semantic_review.review_route_available = false;
  assert.equal(lintGovernanceCandidate(represented).result, 'PASS');
});

test('pending semantic reviews cannot remain in either R2-03 not-pass reason field', () => {
  const packet = clonePacket();
  packet.run.goal_lifecycle_recovery.r2_03_not_pass_reason =
    'CURRENT_EXACT_HEAD_SEMANTIC_REVIEWS_PENDING';
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_INVENTED_REVIEW_GATE'});

  const topLevel = clonePacket();
  topLevel.run.r2_03_not_pass_reason = 'SEMANTIC_REVIEW_PENDING';
  assert.throws(() => lintGovernanceCandidate(topLevel), {code: 'NO_INVENTED_REVIEW_GATE'});
});

test('noncanonical candidate cannot retain an active execution owner or lease', () => {
  const packet = clonePacket();
  packet.policy.payload.coordination.active_execution_owner = 'CODEX_THREAD_STALE';
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_CANDIDATE_CANONICAL_OWNER'});
});

test('mission and policy filenames must match their declared revisions', () => {
  const packet = clonePacket();
  packet.mission.mission_revision_id = '20261001T174401+0800';
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_PATH_REVISION_ID_MISMATCH'});
});

test('superseded PR382 is historical and cannot remain the current packet authority', () => {
  const packet = clonePacket();
  packet.trustRootLane.packet_pr_number = 382;
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_STALE_PR_OR_SHA_AUTHORITY'});
});

test('duplicate blockers, parked lanes, and evidence refs are rejected', () => {
  const packet = clonePacket();
  packet.run.goal_lifecycle_recovery.parked_lanes.push(
    packet.run.goal_lifecycle_recovery.parked_lanes[0]);
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_DUPLICATE_BLOCKED_LANE'});
});

test('candidate evidence preserves the four-tool capability baseline without claiming live acceptance', () => {
  const packet = clonePacket();
  packet.bindings.r2_03_candidate_acceptance_scope.public_tool_count = 5;
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_CAPABILITY_REGRESSION'});
});

test('metadata rollover reuses existing Human authorization when scope is unchanged', () => {
  const packet = clonePacket();
  packet.mission.payload.authorization.metadata_rollover_creates_new_human_gate = true;
  assert.throws(() => lintGovernanceCandidate(packet), {code: 'NO_INVENTED_HUMAN_GATE'});
});

test('candidate SHA and reviewer/session state cannot reset the loop fuse', () => {
  const packet = clonePacket();
  packet.governanceNormalization.rules.logical_work_fingerprint_forbidden_fields =
    packet.governanceNormalization.rules.logical_work_fingerprint_forbidden_fields
      .filter((field) => field !== 'candidate_output_sha');
  assert.throws(() => lintGovernanceCandidate(packet), {
    code: 'NO_SELF_RESETTING_CHURN_FINGERPRINT'
  });
});

test('the user-supplied C0-to-C11 continuation plan remains bound to exact candidate bytes', () => {
  const packet = clonePacket();
  assert.equal(lintGovernanceCandidate(packet).result, 'PASS');

  packet.continuationPlan.sha256 = 'sha256:' + '0'.repeat(64);
  assert.throws(() => lintGovernanceCandidate(packet), {
    code: 'CONTINUATION_CONTRACT_IDENTITY_MISMATCH'
  });
});

test('the promotion verifier runs the governance linter as candidate-local evidence only', () => {
  const packet = clonePacket();
  assert.equal(assertPromotionEvidence(packet).governance_linter, 'PASS_CANDIDATE_LOCAL_ONLY');
});
