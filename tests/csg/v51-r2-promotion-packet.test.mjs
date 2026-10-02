import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPromotionEvidence,
  loadPromotionEvidence,
  verifyPromotionPacket
} from '../../scripts/csg-verify-v51-r2-promotion-packet.mjs';
import {canonicalDigest} from '../../scripts/csg-schema.mjs';

const root = process.cwd();
const basePacket = loadPromotionEvidence(root);
const clone = (value) => structuredClone(value);

test('CP201 promotion packet and exact frozen open source pair qualify locally', () => {
  const result = verifyPromotionPacket(root);
  assert.equal(result.result, 'PASS');
  assert.equal(result.scope, 'CANDIDATE_LOCAL_ONLY');
  assert.equal(result.candidate_parent, 'd39486601d851e31256852a24e9c1393b9046fe5');
  assert.deepEqual(result.source_heads, [
    {pr_number: 381, head: 'e16cd05e821572061321f807841ae0145ff69bc1'},
    {pr_number: 377, head: '491493627bd6ffcd51b0cd9287ab2cb465fbf9ee'}
  ]);
  const packet = clone(basePacket);
  assert.equal(packet.bindings.source_candidates.find((candidate) => candidate.pr_number === 377).covered_paths.length, 12);
  assert.equal(packet.bindings.source_candidates.find((candidate) => candidate.pr_number === 381).covered_paths.find((entry) =>
    entry.path === 'tools/csg/factory-mcp/broker/owner-liveness-publisher.ps1').blob_oid, 'a396ea8d6ffcefcc1d5ba374af2da19d63a4a3df');
  assert.equal(result.protected_trust_root_enforcement, 'NOT_YET_IMPLEMENTED');
  assert.equal(result.trust_root_upgrade_lane, 'REQUIRED_SEPARATE_LANE_NOT_STARTED');
  assert.equal(result.live_acceptance, 'NOT_ACCEPTED');
});

test('owner-allocation trusted-verifier upgrade is a separate parked lane with the exact frozen source pair', () => {
  const packet = clone(basePacket);
  assertPromotionEvidence(packet);
  assert.equal(packet.trustRootLane.lane_id, 'TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED');
  assert.equal(packet.trustRootLane.status, 'REQUIRED_SEPARATE_LANE_NOT_STARTED');
  assert.equal(packet.trustRootLane.procedure_and_gate.provider_admin_prestate, 'NOT_CAPTURED');
  assert.equal(packet.trustRootLane.procedure_and_gate.trust_root_or_workflow_mutation_performed, false);
  assert.equal(packet.trustRootLane.current_trusted_verifier.owner_allocation_invariants_enforced, false);
});

test('trust-root lane cannot claim its provider-admin gate was completed without prestate evidence', () => {
  const packet = clone(basePacket);
  packet.trustRootLane.procedure_and_gate.provider_admin_prestate = 'CAPTURED';
  assert.throws(() => assertPromotionEvidence(packet), {code: 'TRUST_ROOT_UPGRADE_GATE_STATUS_MISREPRESENTED'});
});

test('trust-root lane bytes are bound to their exact candidate blob and digest', () => {
  const packet = clone(basePacket);
  const laneDocument = packet.bindings.candidate_documents.find((document) =>
    document.path === 'governance/csg/v51/trust-root-lanes/TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED-v1.json');
  laneDocument.sha256 = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'TRUST_ROOT_UPGRADE_LANE_BLOB_MISMATCH'});
});

test('a noncanonical candidate cannot allocate an owner generation or lease', () => {
  const packet = clone(basePacket);
  packet.bindings.promotion_candidate.owner_generation = 10;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'NONCANONICAL_PREPARED_CANDIDATE_MUST_NOT_HAVE_ACTIVE_OWNER_LEASE'});
});

test('an exact source binding rejects a nearby head', () => {
  const packet = clone(basePacket);
  packet.bindings.source_candidates[0].origin_exact_sha = 'b26d400af6c232ad8bc1e61adac72efaf683e202';
  assert.throws(() => assertPromotionEvidence(packet), {code: 'EXACT_FROZEN_SOURCE_IDENTITY_MISMATCH'});
});

test('a skipped bounded-driver result cannot be promoted to PASS', () => {
  const packet = clone(basePacket);
  const bounded = packet.bindings.source_candidates[0].checks.find((check) => check.name === 'bounded-driver-acceptance');
  bounded.conclusion = 'success';
  bounded.verdict = 'PASS';
  assert.throws(() => assertPromotionEvidence(packet), {code: 'SKIPPED_CHECK_MUST_NOT_BE_PROMOTED_TO_PASS'});
});

test('old or nonportable review evidence cannot be presented as current exact-head approval', () => {
  const packet = clone(basePacket);
  packet.bindings.source_candidates[1].semantic_review.verdict = 'PASS_OLD_SHA';
  assert.throws(() => assertPromotionEvidence(packet), {code: 'SOURCE_SEMANTIC_REVIEW_STATUS_NOT_CURRENT_PENDING'});
});

test('synthetic integration and unavailable HostGuard smoke cannot become live acceptance', () => {
  const packet = clone(basePacket);
  packet.bindings.candidate_local_qualification.synthetic_integration_is_live_acceptance = true;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'SYNTHETIC_OR_LOCAL_RESULTS_OVERCLAIMED'});
  packet.bindings.candidate_local_qualification.synthetic_integration_is_live_acceptance = false;
  packet.bindings.candidate_local_qualification.source_pr381.live_status_smoke.provider_response_isError = true;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'CANDIDATE_LOCAL_TEST_OR_LIVE_SMOKE_CLASSIFICATION_MISMATCH'});
  packet.bindings.candidate_local_qualification.source_pr381.live_status_smoke.provider_response_isError = false;
  packet.bindings.candidate_local_qualification.source_pr381.live_status_smoke.classification = 'LIVE_ACCEPTANCE';
  assert.throws(() => assertPromotionEvidence(packet), {code: 'CANDIDATE_LOCAL_TEST_OR_LIVE_SMOKE_CLASSIFICATION_MISMATCH'});
});

test('CP200 remains the selected canonical pointer while this branch proposes CP201', () => {
  const packet = clone(basePacket);
  packet.basePointer.checkpoint_seq = 201;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'FRESH_CP200_PRESTATE_MISMATCH'});
});

test('gen5 remains a stale-owner candidate with no revoke, dispatch, or Host mutation', () => {
  const packet = clone(basePacket);
  packet.bindings.acceptance_boundary.owner_revoke = true;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'LIVE_ACCEPTANCE_OR_SIDE_EFFECT_BOUNDARY_MISMATCH'});
});

test('R2-03 is candidate source qualification and does not inherit R2-06 or R2-07 acceptance gates', () => {
  const packet = clone(basePacket);
  assertPromotionEvidence(packet);
  assert.equal(packet.mission.payload.r2_03_acceptance.live_install_acceptance_required, false);
  assert.equal(packet.mission.payload.r2_03_acceptance.live_install_acceptance_owner, 'R2_06');
  assert.equal(packet.mission.payload.r2_03_acceptance.host_mutation, false);
  assert.equal(packet.mission.payload.r2_03_acceptance.mutation_fence, 'NOT_REQUIRED');
  assert.deepEqual(packet.policy.payload.phase_dag.phase_dependencies.R2_03, ['R2_02A']);
  assert.deepEqual(packet.policy.payload.phase_dag.r2_03_acceptance_excludes, ['R2_04', 'R2_05', 'R2_06', 'R2_07']);
  assert.equal(packet.mission.payload.r2_03_acceptance.semantic_review_by_source.pr381, 'PENDING_CURRENT_HEAD');
  assert.equal(packet.mission.payload.r2_03_acceptance.semantic_review_by_source.pr377, 'PENDING_CURRENT_SOURCE_PAIR');
});

test('R2-04 through R2-07 acceptance stays with its phase and cannot gate R2-03', () => {
  const packet = clone(basePacket);
  assertPromotionEvidence(packet);
  const expected = {
    R2_04: {
      phase_owner: 'UNIQUE_TRUSTED_CALLER',
      trust_provisioning: 'NOT_ACCEPTED',
      provider_session_route: 'NOT_ACCEPTED',
      signed_evidence_path: 'NOT_ACCEPTED'
    },
    R2_05: {
      phase_owner: 'NONCIRCULAR_HOST_REPAIR',
      noncircular_host_repair: 'NOT_ACCEPTED'
    },
    R2_06: {
      phase_owner: 'LIVE_FACTORY_MCP_INSTALL_AND_HOST_ACCEPTANCE',
      factory_mcp_install_acceptance: 'NOT_ACCEPTED'
    },
    R2_07: {
      phase_owner: 'SUPERVISOR_24X7_AND_HEARTBEAT_DURABILITY',
      supervisor_24x7: 'NOT_ACCEPTED',
      supervisor_heartbeat_route: 'NOT_ACCEPTED',
      heartbeat_durability: 'NOT_ACCEPTED'
    }
  };
  assert.deepEqual(packet.mission.payload.future_phase_acceptance_state, expected);
  assert.deepEqual(packet.policy.payload.future_phase_acceptance_state, expected);
  assert.deepEqual(packet.run.future_phase_acceptance_state, expected);
  assert.deepEqual(packet.contract.future_phase_acceptance_state, expected);
  assert.deepEqual(packet.bindings.future_phase_acceptance_state, expected);
  assert.equal(packet.mission.payload.r2_03_acceptance.live_install_acceptance_required, false);
  assert.ok(!packet.checkpoint.blockers.some((blocker) => blocker.startsWith('R2_03_LIVE_')));

  packet.checkpoint.blockers.push('R2_03_LIVE_SUPERVISOR_HEARTBEAT_ROUTE_NOT_ACCEPTED');
  packet.checkpoint.payload_digest = canonicalDigest(packet.checkpoint);
  assert.throws(() => assertPromotionEvidence(packet), {
    code: 'R2_03_ACCEPTANCE_MUST_NOT_INHERIT_FUTURE_PHASE_GATES'
  });
});

test('the selected policy projection matches CP201 while CP200 policy remains the exact prestate', () => {
  const packet = clone(basePacket);
  assertPromotionEvidence(packet);
  assert.deepEqual(packet.currentExecutionPolicy, packet.policy);
  assert.equal(packet.baseCurrentExecutionPolicy.policy_revision_id, '20260930T104733+0800-EP80');
  assert.equal(packet.baseCurrentExecutionPolicy.payload.coordination.owner_liveness_reconciliation.exact_cross_source_liveness_observation_required, true);
  assert.equal(packet.currentExecutionPolicy.payload.coordination.owner_liveness_reconciliation.exact_cross_source_liveness_observation_required, false);
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.strictly_stronger_than_spec, false);
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.owner_authority_validity, 'EXPIRED');
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.active_factory_job, 'NONE_OBSERVED');
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.executor_process_existence, 'UNKNOWN');
  assert.equal(packet.mission.payload.owner_liveness_reconciliation.human_spec_criteria.owner_authority_validity, 'EXPIRED');
  assert.equal(packet.mission.payload.owner_liveness_reconciliation.human_spec_criteria.active_factory_job, 'NONE_OBSERVED');
  assert.equal(packet.mission.payload.owner_liveness_reconciliation.human_spec_criteria.executor_process_existence, 'UNKNOWN');
  assert.equal(packet.bindings.candidate_policy_alignment.combined_human_spec_criteria_status, 'SATISFIED_PENDING_CONTROL_TRANSITION');
  assert.equal(packet.bindings.candidate_policy_alignment.stale_owner_control_transition_status, 'NOT_EXECUTED');
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.stale_owner_confirmed, false);
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.revocation, false);
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.host_dispatch, false);
});

test('every published phase DAG is acyclic and a source cycle is rejected', () => {
  const packet = clone(basePacket);
  assertPromotionEvidence(packet);
  packet.mission.payload.phase_dag.phase_dependencies.R2_02A.push('R2_07');
  assert.throws(() => assertPromotionEvidence(packet), {code: 'PHASE_DAG_ACYCLIC'});
});

test('the current policy projection cannot retain the superseded cross-source gate', () => {
  const packet = clone(basePacket);
  packet.currentExecutionPolicy.payload.coordination.owner_liveness_reconciliation.exact_cross_source_liveness_observation_required = true;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'CURRENT_EXECUTION_POLICY_PROJECTION_MISMATCH'});
});

test('Human Spec stale-owner criteria accept unknown process existence without combining control and dispatch', () => {
  const packet = clone(basePacket);
  assertPromotionEvidence(packet);
  assert.equal(packet.policy.payload.coordination.owner_liveness_reconciliation.exact_cross_source_liveness_observation_required, false);
  assert.equal(packet.run.liveness_reconciliation.executor_process_existence, 'UNKNOWN');
  assert.equal(packet.run.liveness_reconciliation.unknown_executor_process_extends_expired_owner_authority, false);
  assert.deepEqual(packet.checkpoint.next_legal_transition.stale_owner_control_sequence, [
    'FRESH_PRESTATE_AND_CAS',
    'STALE_OWNER_CONTROL_TRANSITION_ONLY',
    'SAME_SOURCE_READBACK',
    'RECOMPUTE_READY',
    'NEXT_OWNER_DISPATCH_AS_SEPARATE_LATER_TRANSITION'
  ]);

  packet.policy.payload.coordination.owner_liveness_reconciliation.exact_cross_source_liveness_observation_required = true;
  assert.throws(() => assertPromotionEvidence(packet), {code: 'SPEC_POLICY_MONOTONICITY_OR_STALE_OWNER_CRITERIA_MISMATCH'});
});
