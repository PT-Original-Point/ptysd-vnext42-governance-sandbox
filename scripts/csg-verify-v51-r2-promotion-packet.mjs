import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import canonicalize from '../tools/csg/node_modules/canonicalize/lib/canonicalize.js';
import {validateCsg} from './csg-schema.mjs';

export const PROMOTION_BINDING_PATH = 'governance/csg/v51/readbacks/R2-03-PROMOTION-EVIDENCE-BINDINGS-20261001.json';
export const TRUST_ROOT_LANE_PATH = 'governance/csg/v51/trust-root-lanes/TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED-v1.json';
export const PROMOTION_CHECKPOINT_PATH = 'governance/csg/checkpoints/000201.json';
export const PROMOTION_POINTER_PATH = 'governance/csg/current.json';
export const PROMOTION_BASE = 'd39486601d851e31256852a24e9c1393b9046fe5';

const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const SOURCE_IDENTITIES = [
  {
    pr_number: 381,
    role: 'R2_03_SOURCE_ONLY_FACTORY_MCP',
    origin_exact_sha: 'af50480a00f8a307058ef171468d553a0ef61101',
    base_sha: PROMOTION_BASE,
    tree_sha: '61cf8c22e34b63803dbc4bba2c3b3641411b1000',
    covered_path_count: 19,
    base_branch: 'v45/factory-control',
    origin_branch: 'codex/v51-r2-03-source-only-20261001'
  },
  {
    pr_number: 377,
    role: 'R2_02_RUNTIME_CROSS_SOURCE_INTEGRATION',
    origin_exact_sha: '070555ab3753f35fa250f651f5175adb9bd5cd25',
    base_sha: '06da5fa224b65b9346e8b250dcea686d0ed458ee',
    tree_sha: '011247a2a18606dcc74dd4313d3b2a2974175c96',
    covered_path_count: 12,
    base_branch: 'main',
    origin_branch: 'codex/r2-02-cross-source-liveness-runtime-direct-parent-20260930'
  }
];

const EXPECTED_PROMOTION_PATHS = [
  'governance/csg/checkpoints/000201.json',
  'governance/csg/current.json',
  'governance/csg/v51/missions/20261001T174401+0800.json',
  'governance/csg/v51/policies/20261001T174401+0800-EP88.json',
  'governance/csg/v51/current-execution-policy.json',
  PROMOTION_BINDING_PATH,
  TRUST_ROOT_LANE_PATH,
  'governance/csg/v51/runs/V51-R2-001/contract-r2-03-attempt-002.json',
  'governance/csg/v51/runs/V51-R2-001/run-r2-03.json',
  'governance/csg/v51/regressions/LOCAL_CODEX_GOAL_DISAPPEARS_WHILE_MISSION_ACTIVE-v1.json',
  'scripts/csg-v51-goal-lifecycle.mjs',
  'scripts/csg-verify-v51-r2-promotion-packet.mjs',
  'tests/csg/v51-goal-disappears-regression.test.mjs',
  'tests/csg/v51-r2-promotion-packet.test.mjs'
].sort();

const EXPECTED_RUN = 'governance/csg/v51/runs/V51-R2-001/run-r2-03.json';
const EXPECTED_CONTRACT = 'governance/csg/v51/runs/V51-R2-001/contract-r2-03-attempt-002.json';
const EXPECTED_MISSION = 'governance/csg/v51/missions/20261001T174401+0800.json';
const EXPECTED_POLICY = 'governance/csg/v51/policies/20261001T174401+0800-EP88.json';
const EXPECTED_CURRENT_POLICY = 'governance/csg/v51/current-execution-policy.json';
const OID = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REQUIRED_TRUST_ROOT_INVARIANTS = [
  'NONCANONICAL_PREPARED_CANDIDATE_MUST_NOT_HAVE_ACTIVE_OWNER_LEASE',
  'CANONICAL_OWNER_GENERATION_ALLOCATED_AT_SELECTION',
  'CANONICAL_OWNER_LEASE_STARTS_AT_OR_AFTER_CHECKPOINT_RECORDED_AT',
  'OWNER_GENERATION_ALLOCATION_USES_FRESH_CANONICAL_PRESTATE'
];
const EXPECTED_PHASE_DAG = {
  schema: 'VNEXT5_1_R2_PHASE_DAG_V1',
  phase_dependencies: {
    R2_02A: [],
    R2_03: ['R2_02A'],
    R2_02B: ['R2_03'],
    R2_02: ['R2_02B'],
    R2_04: ['R2_02'],
    R2_05: ['R2_04'],
    R2_06: ['R2_03', 'R2_04', 'R2_05'],
    R2_07: ['R2_06']
  },
  phase_ownership: {
    R2_03: 'FIXED_PURPOSE_READONLY_OBSERVATION',
    R2_04: 'UNIQUE_TRUSTED_CALLER',
    R2_05: 'NONCIRCULAR_HOST_REPAIR',
    R2_06: 'LIVE_FACTORY_MCP_INSTALL_AND_HOST_ACCEPTANCE',
    R2_07: 'SUPERVISOR_24X7_AND_HEARTBEAT_DURABILITY'
  },
  r2_03_acceptance_requires: [
    'EXACTLY_FOUR_PUBLIC_MCP_TOOLS',
    'FIXED_PURPOSE_READONLY_FACTORY_STATUS_AND_DIAGNOSTICS',
    'EXACT_FROZEN_SOURCE_AND_RUNTIME_HEAD_TREE_BLOB_BINDINGS',
    'CAPABILITY_NON_REGRESSION_CANDIDATE_EVIDENCE',
    'NO_ARBITRARY_HOST_MUTATION_THROUGH_R2_03',
    'CANDIDATE_LOCAL_REGRESSIONS_PASS',
    'EXACT_HEAD_STRUCTURAL_VERIFIER_PASS',
    'CURRENT_EXACT_HEAD_SEMANTIC_REVIEW_STATUS_REPRESENTED'
  ],
  r2_03_acceptance_excludes: ['R2_04', 'R2_05', 'R2_06', 'R2_07'],
  r2_03_host_mutation: false,
  r2_03_mutation_fence: 'NOT_REQUIRED'
};
const EXPECTED_FUTURE_PHASE_ACCEPTANCE_STATE = {
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
const EXPECTED_STALE_OWNER_CONTROL_SEQUENCE = [
  'FRESH_PRESTATE_AND_CAS',
  'STALE_OWNER_CONTROL_TRANSITION_ONLY',
  'SAME_SOURCE_READBACK',
  'RECOMPUTE_READY',
  'NEXT_OWNER_DISPATCH_AS_SEPARATE_LATER_TRANSITION'
];

function ensure(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPhaseDagAcyclic(dag) {
  const dependencies = dag?.phase_dependencies;
  ensure(isRecord(dependencies), 'PHASE_DAG_ACYCLIC');
  const visiting = new Set();
  const visited = new Set();
  const visit = (phase) => {
    if (visiting.has(phase)) ensure(false, 'PHASE_DAG_ACYCLIC');
    if (visited.has(phase)) return;
    ensure(Object.hasOwn(dependencies, phase) && Array.isArray(dependencies[phase]), 'PHASE_DAG_ACYCLIC');
    visiting.add(phase);
    for (const dependency of dependencies[phase]) {
      ensure(Object.hasOwn(dependencies, dependency), 'PHASE_DAG_ACYCLIC');
      visit(dependency);
    }
    visiting.delete(phase);
    visited.add(phase);
  };
  for (const phase of Object.keys(dependencies)) visit(phase);
}

function sameSorted(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalPayloadDigest(payload) {
  return sha256(Buffer.from(canonicalize(payload), 'utf8'));
}

function assertOid(value, code = 'GIT_OID_NOT_NORMALIZED') {
  ensure(typeof value === 'string' && OID.test(value) && Buffer.byteLength(value, 'ascii') === 40, code);
}

function assertVerifierEvidence(candidate) {
  const verifier = candidate.checks?.find((check) => check.name === 'csg-trusted-verifier');
  const bounded = candidate.checks?.find((check) => check.name === 'bounded-driver-acceptance');
  ensure(verifier?.status === 'completed' && verifier.conclusion === 'success' &&
    verifier.verdict === 'PASS_EXACT_HEAD' && verifier.scope === 'IMMUTABLE_STRUCTURAL_VERIFIER_ONLY',
  'SOURCE_EXACT_HEAD_VERIFIER_NOT_PASS');
  ensure(Number.isSafeInteger(verifier.run_id) && Number.isSafeInteger(verifier.job_id),
    'SOURCE_VERIFIER_IDENTITY_MISSING');
  ensure(bounded?.status === 'completed' && bounded.conclusion === 'skipped' &&
    bounded.verdict === 'SKIPPED_NOT_PASS', 'SKIPPED_CHECK_MUST_NOT_BE_PROMOTED_TO_PASS');
  ensure(Number.isSafeInteger(bounded.run_id) && Number.isSafeInteger(bounded.job_id),
    'BOUNDED_DRIVER_IDENTITY_MISSING');
  const expectedReview = candidate.pr_number === 377 ? 'PENDING_CURRENT_SOURCE_PAIR' : 'PENDING_CURRENT_HEAD';
  ensure(candidate.semantic_review?.requested === true &&
    candidate.semantic_review?.verdict === expectedReview &&
    candidate.semantic_review?.review_route_available === true,
  'SOURCE_SEMANTIC_REVIEW_STATUS_NOT_CURRENT_PENDING');
}

function assertSourcePair(bindings, facts) {
  const candidates = bindings.source_candidates;
  ensure(Array.isArray(candidates) && candidates.length === SOURCE_IDENTITIES.length,
    'SOURCE_CANDIDATE_COUNT_MISMATCH');

  for (let index = 0; index < SOURCE_IDENTITIES.length; index += 1) {
    const expected = SOURCE_IDENTITIES[index];
    const actual = candidates[index];
    const observed = facts.sources[index];
    ensure(actual.pr_number === expected.pr_number && actual.role === expected.role &&
      actual.origin_exact_sha === expected.origin_exact_sha && actual.base_sha === expected.base_sha &&
      actual.tree_sha === expected.tree_sha && actual.base_branch === expected.base_branch &&
      actual.origin_branch === expected.origin_branch,
    'EXACT_FROZEN_SOURCE_IDENTITY_MISMATCH');
    for (const value of [actual.origin_exact_sha, actual.base_sha, actual.tree_sha]) assertOid(value);
    ensure(actual.pr_state === 'OPEN' && actual.draft === false && actual.merged === false &&
      actual.commit_count === 1, 'SOURCE_PR_NOT_OPEN_READY_FOR_REVIEW_ONE_COMMIT');
    ensure(observed.head_ref === expected.origin_exact_sha && observed.base_ref === expected.base_sha &&
      observed.tree === expected.tree_sha && observed.parents.length === 1 &&
      observed.parents[0] === expected.base_sha && observed.commit_count === 1,
    'SOURCE_COMMIT_TOPOLOGY_MISMATCH');
    ensure(sameSorted(observed.paths, actual.covered_paths.map((entry) => entry.path)),
      'SOURCE_COVERED_PATH_SET_MISMATCH');
    ensure(actual.covered_paths.length === expected.covered_path_count,
      'SOURCE_COVERED_PATH_COUNT_MISMATCH');
    if (expected.pr_number === 381) {
      ensure(actual.covered_paths.every((entry) => entry.path.startsWith('tools/csg/factory-mcp/')),
        'R2_03_SOURCE_PR_SCOPE_MIXED');
    }
    assertVerifierEvidence(actual);
    for (const item of actual.covered_paths) {
      assertOid(item.blob_oid);
      ensure(DIGEST.test(item.sha256), 'SOURCE_BLOB_SHA256_MALFORMED');
      const observedBlob = observed.blobs[item.path];
      ensure(observedBlob?.oid === item.blob_oid && observedBlob.sha256 === item.sha256,
        'SOURCE_BLOB_IDENTITY_MISMATCH');
    }
  }

  const requiredPublisher = candidates[0].covered_paths.find((entry) => entry.path === 'tools/csg/factory-mcp/broker/owner-liveness-publisher.ps1');
  ensure(requiredPublisher?.blob_oid === 'a396ea8d6ffcefcc1d5ba374af2da19d63a4a3df', 'R2_03_REQUIRED_PUBLISHER_BLOB_MISMATCH');

  const runtimeReview = candidates[1].semantic_review;
  ensure(runtimeReview.verdict === 'PENDING_CURRENT_SOURCE_PAIR' &&
    runtimeReview.prior_reviews?.some((review) => review.disposition === 'NONPORTABLE_OLD_SHA'),
  'RUNTIME_REVIEW_OLD_SHA_PORTABILITY_MISMATCH');
  ensure(bindings.verifier_boundary?.verifier_scope === 'IMMUTABLE_STRUCTURAL_VERIFIER_ONLY' &&
    bindings.verifier_boundary?.protected_trust_root_enforcement_of_owner_allocation_invariants === 'NOT_YET_IMPLEMENTED' &&
    bindings.verifier_boundary?.bounded_driver === 'SKIPPED_NOT_PASS' &&
    bindings.verifier_boundary?.semantic_review === 'PENDING_CURRENT_EXACT_HEADS',
  'PROTECTED_VERIFIER_BOUNDARY_MISCLASSIFIED');
  const localVerifier = bindings.verifier_boundary?.candidate_local_promotion_verifier;
  ensure(isRecord(localVerifier) &&
    localVerifier.implementation_path === 'scripts/csg-verify-v51-r2-promotion-packet.mjs' &&
    localVerifier.regression_path === 'tests/csg/v51-r2-promotion-packet.test.mjs' &&
    localVerifier.scope === 'CANDIDATE_LOCAL_ONLY' &&
    localVerifier.protected_trust_root_enforcement === false,
  'CANDIDATE_LOCAL_VERIFIER_SCOPE_MISCLASSIFIED');
}

function assertTrustRootLane(bindings, lane, facts) {
  ensure(isRecord(lane) && lane.lane_id === 'TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED' &&
    lane.status === 'REQUIRED_SEPARATE_LANE_NOT_STARTED' && lane.packet_pr_number === 382,
  'TRUST_ROOT_UPGRADE_LANE_IDENTITY_MISMATCH');
  ensure(lane.canonical_prestate?.control_ref === 'refs/heads/v45/factory-control' &&
    lane.canonical_prestate?.control_commit === PROMOTION_BASE && lane.canonical_prestate?.checkpoint_seq === 200,
  'TRUST_ROOT_UPGRADE_PRESTATE_MISMATCH');
  ensure(sameSorted(lane.required_invariants, REQUIRED_TRUST_ROOT_INVARIANTS),
    'TRUST_ROOT_UPGRADE_INVARIANTS_MISMATCH');
  ensure(Array.isArray(lane.frozen_source_pair) && lane.frozen_source_pair.length === SOURCE_IDENTITIES.length,
    'TRUST_ROOT_UPGRADE_SOURCE_PAIR_MISMATCH');
  for (let index = 0; index < SOURCE_IDENTITIES.length; index += 1) {
    const source = lane.frozen_source_pair[index];
    const expected = SOURCE_IDENTITIES[index];
    const expectedReview = expected.pr_number === 381 ? 'PENDING_CURRENT_HEAD' : 'PENDING_CURRENT_SOURCE_PAIR';
    ensure(source.pr_number === expected.pr_number && source.role === expected.role &&
      source.head === expected.origin_exact_sha && source.tree === expected.tree_sha &&
      source.semantic_review === expectedReview,
    'TRUST_ROOT_UPGRADE_SOURCE_PAIR_MISMATCH');
  }
  ensure(lane.evidence_boundary?.candidate_packet_ownerless_contract === 'IMPLEMENTED' &&
    lane.evidence_boundary?.candidate_local_promotion_packet_verifier === 'PASS_CANDIDATE_LOCAL_ONLY' &&
    lane.evidence_boundary?.candidate_local_ownerless_candidate_regression === 'PASS_CANDIDATE_LOCAL_ONLY' &&
    lane.evidence_boundary?.immutable_protected_trust_root_enforcement === 'NOT_YET_IMPLEMENTED' &&
    lane.evidence_boundary?.candidate_local_evidence_is_protected_enforcement === false,
  'TRUST_ROOT_UPGRADE_EVIDENCE_SCOPE_MISCLASSIFIED');
  const current = lane.current_trusted_verifier;
  ensure(current?.workflow_path === '.github/workflows/factory-bounded.yml' &&
    current?.trusted_verifier_path === 'governance/csg/trust-root/csg-trusted-pr-verifier.mjs' &&
    current?.trusted_source_selector === 'github.workflow_sha' &&
    current?.owner_allocation_invariants_enforced === false &&
    current?.candidate_local_promotion_verifier_executed === false &&
    current?.candidate_local_owner_allocation_tests_executed === false,
  'TRUST_ROOT_UPGRADE_CURRENT_BOUNDARY_MISCLASSIFIED');
  const gate = lane.procedure_and_gate;
  ensure(gate?.procedure_path === 'governance/csg/csg-03b-target-trust-plan-v1.json' &&
    gate?.procedure_read_from_commit === PROMOTION_BASE && gate?.required_human_gate === 'HG47-TRUST' &&
    gate?.prior_authorization_recorded === true &&
    gate?.applicability_to_this_exact_owner_allocation_verifier_upgrade === 'NOT_YET_VERIFIED' &&
    gate?.provider_admin_prestate === 'NOT_CAPTURED' && gate?.trust_root_or_workflow_mutation_performed === false,
  'TRUST_ROOT_UPGRADE_GATE_STATUS_MISREPRESENTED');
  ensure(lane.separation?.source_only_pr381_unchanged === true &&
    lane.separation?.runtime_pr377_unchanged === true &&
    lane.separation?.promotion_packet_pr382_is_not_trust_root_source === true &&
    lane.separation?.no_trust_root_or_workflow_file_modified === true &&
    lane.separation?.no_canonical_pointer_selection === true,
  'TRUST_ROOT_UPGRADE_SEPARATION_MISMATCH');
  const binding = bindings.verifier_boundary?.trust_root_upgrade_lane;
  ensure(binding?.lane_id === lane.lane_id && binding?.path === TRUST_ROOT_LANE_PATH &&
    binding?.status === lane.status && binding?.required_human_gate === gate.required_human_gate &&
    binding?.gate_applicability === gate.applicability_to_this_exact_owner_allocation_verifier_upgrade &&
    binding?.provider_admin_prestate === gate.provider_admin_prestate && binding?.mutation_performed === false,
  'TRUST_ROOT_UPGRADE_BINDING_MISMATCH');
  const laneDocument = bindings.candidate_documents?.find((document) => document.path === TRUST_ROOT_LANE_PATH);
  const observedLane = facts.bundleDigests?.[TRUST_ROOT_LANE_PATH];
  ensure(isRecord(laneDocument) && observedLane && laneDocument.blob_oid === observedLane.blob_oid &&
    laneDocument.sha256 === observedLane.digest && laneDocument.size === observedLane.bytes,
  'TRUST_ROOT_UPGRADE_LANE_BLOB_MISMATCH');
}

export function assertPromotionEvidence(packet) {
  const {
    pointer, basePointer, checkpoint, baseCheckpoint, projectDirectory, bindings,
    mission, policy, currentExecutionPolicy, baseCurrentExecutionPolicy, run, contract, trustRootLane, facts
  } = packet;
  validateCsg(pointer);
  validateCsg(basePointer);
  validateCsg(checkpoint, {expectedMissionCanonicalizationVersion: 'HUMAN_TEXT_V1'});
  validateCsg(baseCheckpoint, {expectedMissionCanonicalizationVersion: 'HUMAN_TEXT_V1'});

  const phaseDags = [
    mission.payload?.phase_dag,
    policy.payload?.phase_dag,
    checkpoint.next_legal_transition?.phase_dag,
    run.goal_lifecycle_recovery?.phase_dag,
    contract.phase_dag,
    bindings.phase_dag,
    currentExecutionPolicy.payload?.phase_dag
  ];
  phaseDags.forEach(assertPhaseDagAcyclic);
  ensure(phaseDags.every((dag) => JSON.stringify(dag) === JSON.stringify(EXPECTED_PHASE_DAG)),
  'SPEC_POLICY_MONOTONICITY_OR_PHASE_DAG_MISMATCH');

  const futurePhaseStates = [
    mission.payload?.future_phase_acceptance_state,
    policy.payload?.future_phase_acceptance_state,
    run.future_phase_acceptance_state,
    contract.future_phase_acceptance_state,
    bindings.future_phase_acceptance_state
  ];
  const hasDeferredGateUnderR2_03 = (blocker) =>
    /^R2_03_/.test(blocker) &&
    /(TRUST|HOST.*INSTALL|SUPERVISOR|PROVIDER_SESSION|SIGNED_EVIDENCE|LIVE_FACTORY)/i.test(blocker);
  ensure(futurePhaseStates.every((state) =>
    JSON.stringify(state) === JSON.stringify(EXPECTED_FUTURE_PHASE_ACCEPTANCE_STATE)) &&
    !Object.keys(mission.payload?.r2_03_acceptance_state ?? {}).some((key) => key.startsWith('live_')) &&
    !Object.keys(policy.payload?.r2_03_acceptance_state ?? {}).some((key) => key.startsWith('live_')) &&
    !Object.keys(run.evidence_binding_state ?? {}).some((key) => key.startsWith('live_')) &&
    run.live_acceptance_state === undefined &&
    !checkpoint.blockers?.some(hasDeferredGateUnderR2_03) &&
    checkpoint.blockers?.includes('R2_04_TRUSTED_CALLER_NOT_YET_ACCEPTED') &&
    checkpoint.blockers?.includes('R2_05_NONCIRCULAR_HOST_REPAIR_NOT_YET_ACCEPTED') &&
    checkpoint.blockers?.includes('R2_06_LIVE_FACTORY_MCP_INSTALL_ACCEPTANCE_NOT_ACCEPTED') &&
    checkpoint.blockers?.includes('R2_07_SUPERVISOR_24X7_HEARTBEAT_DURABILITY_NOT_ACCEPTED') &&
    bindings.r2_03_candidate_acceptance_scope?.live_install_acceptance?.startsWith('NOT_REQUIRED_FOR_R2_03') &&
    bindings.r2_03_candidate_acceptance_scope?.supervisor_heartbeat_durability?.startsWith('NOT_REQUIRED_FOR_R2_03'),
  'R2_03_ACCEPTANCE_MUST_NOT_INHERIT_FUTURE_PHASE_GATES');

  const r2_03 = mission.payload?.r2_03_acceptance;
  ensure(r2_03?.host_mutation === false && r2_03?.mutation_fence === 'NOT_REQUIRED' &&
    r2_03?.live_install_acceptance_required === false && r2_03?.live_install_acceptance_owner === 'R2_06' &&
    r2_03?.candidate_qualification === 'QUALIFIED_CANDIDATE' &&
    r2_03?.candidate_local_regressions === 'PASS' &&
    r2_03?.structural_verifier === 'PASS_EXACT_HEAD' &&
    r2_03?.semantic_review_required === true &&
    r2_03?.semantic_review_by_source?.pr381 === 'PENDING_CURRENT_HEAD' &&
    r2_03?.semantic_review_by_source?.pr377 === 'PENDING_CURRENT_SOURCE_PAIR' &&
    JSON.stringify(r2_03?.acceptance_criteria) === JSON.stringify(EXPECTED_PHASE_DAG.r2_03_acceptance_requires),
  'R2_03_ACCEPTANCE_SCOPE_OR_EVIDENCE_CLASSIFICATION_MISMATCH');

  const policyLiveness = policy.payload?.coordination?.owner_liveness_reconciliation;
  const specCriteria = policyLiveness?.human_spec_criteria;
  ensure(policyLiveness?.exact_cross_source_liveness_observation_required === false &&
    policyLiveness?.strictly_stronger_than_spec === false &&
    policyLiveness?.lease_expiry_alone_confirms_stale === false &&
    policyLiveness?.aggregate_zero_job_counts_alone_confirm_stale === false &&
    policyLiveness?.owner_authority_validity === 'EXPIRED' &&
    policyLiveness?.active_factory_job === 'NONE_OBSERVED' &&
    policyLiveness?.executor_process_existence === 'UNKNOWN' &&
    policyLiveness?.unknown_executor_process_extends_expired_owner_authority === false &&
    specCriteria?.run_state === 'RUNNING' && specCriteria?.generation_5_lease_expired === true &&
    specCriteria?.factory_live_job_count === 0 && specCriteria?.pending_receipt_count === 0 &&
    specCriteria?.owner_authority_validity === 'EXPIRED' &&
    specCriteria?.active_factory_job === 'NONE_OBSERVED' &&
    Array.isArray(specCriteria?.unresolved_effect_refs) && specCriteria.unresolved_effect_refs.length === 0 &&
    specCriteria?.executor_process_existence === 'UNKNOWN' &&
    specCriteria?.assessment === 'SATISFIED_PENDING_STALE_OWNER_CONTROL_TRANSITION' &&
    policyLiveness?.stale_owner_confirmed === false && policyLiveness?.revocation === false &&
    policyLiveness?.host_dispatch === false,
  'SPEC_POLICY_MONOTONICITY_OR_STALE_OWNER_CRITERIA_MISMATCH');
  const policyAlignment = bindings.candidate_policy_alignment;
  ensure(policyAlignment?.source_class === 'HUMAN_CURRENT_SPEC_AND_CANDIDATE_POLICY_RECONCILIATION' &&
    policyAlignment?.canonical_prestate_checkpoint === 200 &&
    policyAlignment?.canonical_prestate_policy_revision_id === baseCurrentExecutionPolicy?.policy_revision_id &&
    policyAlignment?.canonical_prestate_exact_cross_source_liveness_observation_required === true &&
    policyAlignment?.candidate_policy_revision_id === policy.policy_revision_id &&
    policyAlignment?.candidate_policy_hash === policy.policy_hash &&
    policyAlignment?.candidate_exact_cross_source_liveness_observation_required === false &&
    policyAlignment?.candidate_current_policy_projection_path === EXPECTED_CURRENT_POLICY &&
    policyAlignment?.candidate_current_policy_projection_matches_policy === true &&
    policyAlignment?.strictly_stronger_than_human_spec === false &&
    policyAlignment?.stricter_rule_justification === null &&
    policyAlignment?.human_approval_required_for_stricter_rule === false &&
    policyAlignment?.owner_authority_validity === 'EXPIRED' &&
    policyAlignment?.active_factory_job === 'NONE_OBSERVED' &&
    policyAlignment?.executor_process_existence === 'UNKNOWN' &&
    policyAlignment?.combined_human_spec_criteria_status === 'SATISFIED_PENDING_CONTROL_TRANSITION' &&
    policyAlignment?.stale_owner_control_transition_status === 'NOT_EXECUTED' &&
    policyAlignment?.revoke === false && policyAlignment?.dispatch === false,
  'SPEC_POLICY_MONOTONICITY_RECONCILIATION_MISMATCH');
  ensure(JSON.stringify(checkpoint.next_legal_transition?.stale_owner_control_sequence) ===
    JSON.stringify(EXPECTED_STALE_OWNER_CONTROL_SEQUENCE) &&
    !checkpoint.next_legal_transition?.forbidden?.includes('STALE_OWNER_CONFIRMED_WITHOUT_EXACT_CROSS_SOURCE_EVIDENCE') &&
    checkpoint.next_legal_transition?.forbidden?.includes('REVOKE_OR_DISPATCH_IN_SAME_STALE_OWNER_CONTROL_TRANSITION') &&
    checkpoint.next_legal_transition?.forbidden?.includes('DISPATCH_BEFORE_SAME_SOURCE_READBACK_AND_READY_RECOMPUTE'),
  'STALE_OWNER_CONTROL_AND_DISPATCH_PHASE_BOUNDARY_MISMATCH');
  ensure(run.liveness_reconciliation?.human_spec_criteria_status === 'SATISFIED_PENDING_CONTROL_TRANSITION' &&
    run.liveness_reconciliation?.owner_authority_validity === 'EXPIRED' &&
    run.liveness_reconciliation?.active_factory_job === 'NONE_OBSERVED' &&
    run.liveness_reconciliation?.pending_receipt_count === 0 &&
    run.liveness_reconciliation?.executor_process_existence === 'UNKNOWN' &&
    run.liveness_reconciliation?.unknown_executor_process_extends_expired_owner_authority === false &&
    run.liveness_reconciliation?.stale_owner_confirmed === false &&
    run.liveness_reconciliation?.revocation === false && run.liveness_reconciliation?.host_dispatch === false,
  'RUN_STALE_OWNER_RECOMPUTATION_MISMATCH');
  const currentPolicyDocument = bindings.candidate_documents?.find((document) => document.path === EXPECTED_CURRENT_POLICY);
  const currentPolicyBlob = facts.bundleDigests?.[EXPECTED_CURRENT_POLICY];
  ensure(currentPolicyDocument && currentPolicyBlob &&
    currentPolicyDocument.blob_oid === currentPolicyBlob.blob_oid &&
    currentPolicyDocument.sha256 === currentPolicyBlob.digest &&
    currentPolicyDocument.size === currentPolicyBlob.bytes,
  'CURRENT_EXECUTION_POLICY_EVIDENCE_BINDING_MISMATCH');

  ensure(facts.candidateParent === PROMOTION_BASE && facts.candidateCommitCount === 1 &&
    facts.baseControlHead === PROMOTION_BASE && facts.baseMainHead === SOURCE_IDENTITIES[1].base_sha,
  'PROMOTION_CANDIDATE_NOT_ONE_DIRECT_PARENT_FROM_FRESH_BASE');
  ensure(sameSorted(facts.candidatePaths, EXPECTED_PROMOTION_PATHS),
    'PROMOTION_CANDIDATE_PATH_SET_MISMATCH');
  ensure(facts.directoryHead === bindings.canonical_authority?.project_directory?.head &&
    facts.directoryProjectBlob === bindings.canonical_authority?.project_directory?.blob_oid,
  'PROJECT_DIRECTORY_READBACK_MISMATCH');
  ensure(projectDirectory.registration_state === 'BOUND' && projectDirectory.directory_revision === 5 &&
    projectDirectory.control_locator?.ref === 'refs/heads/v45/factory-control' &&
    projectDirectory.control_locator?.current_path === PROMOTION_POINTER_PATH,
  'PROJECT_DIRECTORY_BINDING_MISMATCH');

  ensure(basePointer.checkpoint_seq === 200 &&
    basePointer.checkpoint_path === 'governance/csg/checkpoints/000200.json' &&
    basePointer.checkpoint_digest === baseCheckpoint.payload_digest &&
    baseCheckpoint.checkpoint_seq === 200 && baseCheckpoint.lifecycle === 'ACTIVE' &&
    baseCheckpoint.owner?.owner_generation === 5 &&
    baseCheckpoint.task_id === 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION' &&
    baseCheckpoint.attempt_id === 'V51-R2-02-ATTEMPT-002' && baseCheckpoint.attempt_epoch === 2 &&
    Array.isArray(baseCheckpoint.unresolved_effect_refs) && baseCheckpoint.unresolved_effect_refs.length === 0,
  'FRESH_CP200_PRESTATE_MISMATCH');
  ensure(baseCurrentExecutionPolicy?.mission_revision_id === baseCheckpoint.mission_anchor?.revision &&
    baseCurrentExecutionPolicy?.mission_hash === baseCheckpoint.mission_anchor?.declared_hash &&
    baseCurrentExecutionPolicy?.policy_revision_id === baseCheckpoint.policy_anchor?.revision &&
    baseCurrentExecutionPolicy?.policy_hash === baseCheckpoint.policy_anchor?.declared_hash &&
    baseCurrentExecutionPolicy?.policy_hash === canonicalPayloadDigest(baseCurrentExecutionPolicy.payload),
  'CP200_BASE_EXECUTION_POLICY_MISMATCH');
  ensure(JSON.stringify(currentExecutionPolicy) === JSON.stringify(policy) &&
    currentExecutionPolicy?.policy_revision_id === checkpoint.policy_anchor?.revision &&
    currentExecutionPolicy?.policy_hash === checkpoint.policy_anchor?.declared_hash &&
    currentExecutionPolicy?.payload?.coordination?.owner_liveness_reconciliation?.exact_cross_source_liveness_observation_required === false,
  'CURRENT_EXECUTION_POLICY_PROJECTION_MISMATCH');
  ensure(bindings.canonical_authority?.control_commit === PROMOTION_BASE &&
    bindings.canonical_authority?.checkpoint_seq === 200 &&
    bindings.canonical_authority?.checkpoint_digest === baseCheckpoint.payload_digest &&
    bindings.canonical_authority?.pointer_checkpoint_seq === 200 &&
    bindings.canonical_authority?.owner_generation === 5 &&
    bindings.canonical_authority?.owner_liveness === 'STALE_EXECUTION_OWNER_CANDIDATE' &&
    bindings.canonical_authority?.stale_owner_confirmed === false &&
    Array.isArray(bindings.canonical_authority?.unresolved_effect_refs) &&
    bindings.canonical_authority.unresolved_effect_refs.length === 0,
  'PROMOTION_PACKET_CANONICAL_PRESTATE_MISMATCH');

  ensure(pointer.checkpoint_seq === 201 && pointer.checkpoint_path === PROMOTION_CHECKPOINT_PATH &&
    pointer.checkpoint_digest === checkpoint.payload_digest &&
    pointer.previous_control_oid?.hex === PROMOTION_BASE &&
    checkpoint.checkpoint_seq === 201 && checkpoint.previous_checkpoint_ref?.revision === PROMOTION_BASE &&
    checkpoint.previous_checkpoint_ref?.digest === baseCheckpoint.payload_digest &&
    checkpoint.lifecycle === 'ACTIVE' && checkpoint.atomic?.state === 'PREPARED_NOT_DISPATCHED' &&
    checkpoint.owner === null && checkpoint.stop_requested === false,
  'CP201_CANDIDATE_PRESTATE_OR_OWNER_MISMATCH');
  ensure(checkpoint.task_id === 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION' &&
    checkpoint.attempt_id === 'V51-R2-03-ATTEMPT-002' && checkpoint.attempt_epoch === 2 &&
    checkpoint.active_job_refs?.length === 0 && checkpoint.unresolved_effect_refs?.length === 0,
  'CP201_ACTIVE_UNIT_OR_EFFECT_SET_MISMATCH');

  const candidate = bindings.promotion_candidate;
  ensure(candidate?.checkpoint_seq === 201 && candidate.previous_checkpoint_seq === 200 &&
    candidate.expected_parent === PROMOTION_BASE && candidate.canonical_selection_status === 'CANDIDATE_ONLY_CP200_REMAINS_CANONICAL' &&
    candidate.current_json_mutated === true && candidate.target_canonical_pointer_remains_cp200 === true &&
    candidate.candidate_pointer_proposes_cp201 === true,
  'CP201_CANDIDATE_SELECTION_CLASSIFICATION_MISMATCH');
  ensure(candidate.owner === null && candidate.owner_generation === null && candidate.lease_until === null &&
    candidate.execution_owner_allocated === false && candidate.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION' &&
    candidate.lease_duration_seconds === 14400 && candidate.allocation_phase === 'CANONICAL_PROMOTION_CAS' &&
    candidate.fresh_canonical_prestate_required === true &&
    candidate.fresh_durable_consumed_generation_readback_required === true &&
    candidate.same_source_readback_after_canonical_write_required === true &&
    candidate.new_owner_generation_invariant === 'GREATER_THAN_CURRENT_CANONICAL_AND_NOT_COLLIDING_WITH_ANY_DURABLY_CONSUMED_IDENTITY' &&
    candidate.no_gen10 === true,
  'NONCANONICAL_PREPARED_CANDIDATE_MUST_NOT_HAVE_ACTIVE_OWNER_LEASE');

  ensure(mission.status === 'FINALIZED' && mission.mission_revision_id === checkpoint.mission_anchor?.revision &&
    mission.mission_hash === canonicalPayloadDigest(mission.payload) &&
    mission.mission_hash === checkpoint.mission_anchor?.declared_hash &&
    mission.payload?.goal_lifecycle?.canonical_mission_status === 'ACTIVE' &&
    mission.payload?.active_unit === checkpoint.task_id && mission.payload?.active_run_id === 'V51-R2-001' &&
    mission.payload?.active_attempt_id === checkpoint.attempt_id && mission.payload?.active_attempt_epoch === checkpoint.attempt_epoch,
  'MISSION_HASH_OR_ACTIVE_LIFECYCLE_MISMATCH');
  ensure(policy.status === 'FINALIZED' && policy.policy_revision_id === checkpoint.policy_anchor?.revision &&
    policy.policy_hash === canonicalPayloadDigest(policy.payload) &&
    policy.policy_hash === checkpoint.policy_anchor?.declared_hash &&
    policy.mission_revision_id === mission.mission_revision_id && policy.mission_hash === mission.mission_hash,
  'POLICY_HASH_OR_MISSION_BINDING_MISMATCH');

  const candidateRebuild = mission.payload?.coordination?.r2_03_candidate_rebuild;
  const policyRebuild = policy.payload?.coordination?.r2_03_candidate_rebuild;
  ensure(candidateRebuild?.canonical_checkpoint_seq === 200 && candidateRebuild.canonical_control_commit === PROMOTION_BASE &&
    candidateRebuild.canonical_owner_generation === 5 && candidateRebuild.candidate_instance_id === candidate.candidate_instance_id &&
    candidateRebuild.candidate_status === 'NONCANONICAL_PREPARED_NOT_DISPATCHED' &&
    candidateRebuild.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION' &&
    candidateRebuild.owner_generation === null && candidateRebuild.lease_until === null &&
    candidateRebuild.execution_owner_allocated === false && candidateRebuild.allocation_phase === 'CANONICAL_PROMOTION_CAS' &&
    candidateRebuild.fresh_canonical_prestate_readback_required === true &&
    candidateRebuild.fresh_durable_consumed_generation_readback_required === true &&
    candidateRebuild.same_source_readback_after_canonical_write_required === true &&
    candidateRebuild.frozen_source_pair?.length === 2 &&
    candidateRebuild.frozen_source_pair.every((source, index) => source.pr_number === SOURCE_IDENTITIES[index].pr_number &&
      source.exact_head === SOURCE_IDENTITIES[index].origin_exact_sha),
  'MISSION_OWNERLESS_PROMOTION_CONTRACT_MISMATCH');
  ensure(policyRebuild?.candidate_instance_id === candidate.candidate_instance_id &&
    policyRebuild.owner_generation === null && policyRebuild.lease_until === null &&
    policyRebuild.execution_owner_allocated === false && policyRebuild.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION',
  'POLICY_OWNERLESS_PROMOTION_CONTRACT_MISMATCH');
  ensure(mission.payload?.active_owner_generation === null && mission.payload?.r2_07_acceptance?.status === 'REQUIRED_NOT_YET_ACCEPTED' &&
    mission.payload?.r2_09_acceptance?.status === 'REQUIRED_NOT_YET_ACCEPTED' &&
    mission.payload?.r2_09_acceptance?.regression_id === 'LOCAL_CODEX_GOAL_DISAPPEARS_WHILE_MISSION_ACTIVE',
  'MISSION_CONTINUITY_ACCEPTANCE_MISMATCH');

  ensure(run.run_id === 'V51-R2-001' && run.state === 'PREPARED_NOT_DISPATCHED' &&
    run.active_task_id === checkpoint.task_id && run.attempt_id === checkpoint.attempt_id &&
    run.attempt_epoch === checkpoint.attempt_epoch && run.execution_owner === null &&
    run.owner_generation === null && run.owner_lease_until === null && run.execution_owner_allocated === false &&
    run.candidate_instance_id === candidate.candidate_instance_id &&
    run.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION' && run.lease_until === undefined,
  'RUN_OWNER_ALLOCATION_MISMATCH');
  ensure(run.goal_lifecycle_recovery?.mission_status === 'ACTIVE' &&
    run.goal_lifecycle_recovery?.bounded_batch_completion_terminates_mission === false &&
    run.goal_lifecycle_recovery?.continue_other_ready_work === true &&
    run.goal_lifecycle_recovery?.global_blocked === false &&
    run.goal_lifecycle_recovery?.r2_02_status === 'NOT_PASS' && run.goal_lifecycle_recovery?.r2_03_status === 'NOT_PASS',
  'RUN_GOAL_LIFECYCLE_OR_ACCEPTANCE_STATE_MISMATCH');
  ensure(run.liveness_reconciliation?.owner_generation === 5 &&
    run.liveness_reconciliation?.status === 'STALE_EXECUTION_OWNER_CANDIDATE' &&
    run.liveness_reconciliation?.stale_owner_confirmed === false &&
    run.liveness_reconciliation?.revocation === false && run.liveness_reconciliation?.host_dispatch === false &&
    run.liveness_reconciliation?.host_mutation === false,
  'RUN_GEN5_LIVENESS_OR_SIDE_EFFECT_MISMATCH');
  ensure(contract.task_id === checkpoint.task_id && contract.attempt_id === checkpoint.attempt_id &&
    contract.attempt_epoch === checkpoint.attempt_epoch && contract.owner_generation === null &&
    contract.owner_lease_until === null && contract.candidate_instance_id === candidate.candidate_instance_id &&
    contract.execution_owner_allocated === false &&
    contract.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION' &&
    contract.owner_generation_allocation === 'DEFERRED_TO_CANONICAL_PROMOTION_CAS',
  'CONTRACT_OWNER_ALLOCATION_MISMATCH');

  assertSourcePair(bindings, facts);
  assertTrustRootLane(bindings, trustRootLane, facts);
  ensure(bindings.candidate_local_qualification?.synthetic_integration_is_live_acceptance === false &&
    bindings.candidate_local_qualification?.evidence_scope === 'CANDIDATE_LOCAL_REPORTED_TEST_RESULTS_FROM_FRESH_PR_PROVIDER_METADATA; NOT_PROTECTED_TRUST_ROOT_ENFORCEMENT',
  'SYNTHETIC_OR_LOCAL_RESULTS_OVERCLAIMED');
  ensure(bindings.candidate_local_qualification?.source_pr381?.factory_mcp_package_suite === 'PASS_29_OF_29' &&
    bindings.candidate_local_qualification.source_pr381?.official_inspector_equivalence === 'PASS' &&
    bindings.candidate_local_qualification.source_pr381?.live_status_smoke?.result === 'FAIL' &&
    bindings.candidate_local_qualification.source_pr381?.live_status_smoke?.provider_response_isError === false &&
    bindings.candidate_local_qualification.source_pr381?.live_status_smoke?.failure_code === 'HOSTGUARD_READ_STATUS_UNAVAILABLE' &&
    bindings.candidate_local_qualification.source_pr381?.live_status_smoke?.hostguard_read_status === 'UNAVAILABLE' &&
    bindings.candidate_local_qualification.source_pr381?.live_status_smoke?.classification === 'HISTORICAL_OBSERVATION_EVIDENCE' &&
    bindings.candidate_local_qualification.source_pr381?.live_status_smoke?.portability_to_current_exact_head === 'NOT_PORTABLE_TO_CURRENT_HEAD' &&
    bindings.candidate_local_qualification?.runtime_pr377?.cross_candidate_fail_closed_matrix === 'PASS' &&
    bindings.candidate_local_qualification.runtime_pr377?.cross_candidate_positive_matrix === 'PASS',
  'CANDIDATE_LOCAL_TEST_OR_LIVE_SMOKE_CLASSIFICATION_MISMATCH');
  ensure(bindings.acceptance_boundary?.current_spec === 'VNEXT5.1-R2' &&
    bindings.acceptance_boundary?.mission_lifecycle === 'ACTIVE' &&
    bindings.acceptance_boundary?.r2_02 === 'NOT_PASS' && bindings.acceptance_boundary?.r2_03 === 'NOT_PASS' &&
    bindings.acceptance_boundary?.generation_5 === 'STALE_EXECUTION_OWNER_CANDIDATE' &&
    bindings.acceptance_boundary?.stale_owner_confirmed === false &&
    bindings.acceptance_boundary?.live_trust_provisioning === 'NOT_ACCEPTED' &&
    bindings.acceptance_boundary?.live_provider_session_route === 'NOT_ACCEPTED' &&
    bindings.acceptance_boundary?.live_supervisor_heartbeat_route === 'NOT_ACCEPTED' &&
    bindings.acceptance_boundary?.live_signed_evidence_path === 'NOT_ACCEPTED' &&
    bindings.acceptance_boundary?.host_dispatch === false && bindings.acceptance_boundary?.host_mutation === false &&
    bindings.acceptance_boundary?.owner_revoke === false && bindings.acceptance_boundary?.production === false &&
    bindings.acceptance_boundary?.paid_fallback === false &&
    bindings.acceptance_boundary?.worker_provider_write_credentials === false,
  'LIVE_ACCEPTANCE_OR_SIDE_EFFECT_BOUNDARY_MISMATCH');
  ensure(bindings.historical_evidence?.pr342?.classification === 'HISTORICAL_COMPOSITE_CANDIDATE' &&
    bindings.historical_evidence?.pr342?.exact_head === 'b26d400af6c232ad7fcf253c48f9066cbddc2d12' &&
    bindings.historical_evidence.pr342.merge_ready === false &&
    bindings.historical_evidence?.pr378?.classification === 'HISTORICAL_OBSERVATION_EVIDENCE' &&
    bindings.historical_evidence?.pr378?.verdict_portability === 'VERDICT_NOT_PORTABLE_TO_CURRENT_SOURCE_PAIR' &&
    bindings.historical_evidence?.pr378?.rebuilt_for_source_sha_drift === false,
  'HISTORICAL_EVIDENCE_PORTABILITY_MISMATCH');
  ensure(bindings.promotion_requirements?.promotion_requires_cas_from_fresh_cp200_prestate === true &&
    bindings.promotion_requirements?.owner_allocation_and_lease_start_only_inside_canonical_promotion_cas === true &&
    bindings.promotion_requirements?.after_canonical_write_same_source_readback_required === true &&
    bindings.promotion_requirements?.no_source_pr_self_binding === true,
  'PROMOTION_CAS_OR_READBACK_REQUIREMENT_MISSING');

  return {
    result: 'PASS',
    scope: 'CANDIDATE_LOCAL_ONLY',
    candidate_head: facts.candidateHead,
    candidate_parent: facts.candidateParent,
    checkpoint_seq: checkpoint.checkpoint_seq,
    source_heads: SOURCE_IDENTITIES.map((source) => ({pr_number: source.pr_number, head: source.origin_exact_sha})),
    protected_trust_root_enforcement: 'NOT_YET_IMPLEMENTED',
    trust_root_upgrade_lane: 'REQUIRED_SEPARATE_LANE_NOT_STARTED',
    live_acceptance: 'NOT_ACCEPTED'
  };
}

function gitBuffer(root, args) {
  return execFileSync('git', args, {cwd: root, maxBuffer: 64 * 1024 * 1024});
}

function gitText(root, args) {
  return gitBuffer(root, args).toString('utf8').trim();
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readGitJson(root, ref, relativePath) {
  return JSON.parse(gitBuffer(root, ['show', `${ref}:${relativePath}`]).toString('utf8'));
}

function readBlobDigest(root, ref, relativePath) {
  const oid = gitText(root, ['rev-parse', `${ref}:${relativePath}`]);
  assertOid(oid);
  const bytes = gitBuffer(root, ['cat-file', 'blob', oid]);
  return {oid, sha256: sha256(bytes), bytes};
}

function sourceFacts(root, candidate) {
  const sha = candidate.origin_exact_sha;
  const commitLine = gitText(root, ['rev-list', '--parents', '-n', '1', sha]).split(/\s+/);
  const paths = gitText(root, ['diff', '--name-only', `${candidate.base_sha}..${sha}`])
    .split(/\r?\n/).filter(Boolean).sort();
  const blobs = {};
  for (const item of candidate.covered_paths) {
    const blob = readBlobDigest(root, sha, item.path);
    blobs[item.path] = {oid: blob.oid, sha256: blob.sha256};
  }
  return {
    head_ref: gitText(root, ['rev-parse', `refs/remotes/origin/${candidate.origin_branch}`]),
    base_ref: gitText(root, ['rev-parse', `refs/remotes/origin/${candidate.base_branch}`]),
    tree: gitText(root, ['rev-parse', `${sha}^{tree}`]),
    parents: commitLine.slice(1),
    commit_count: Number(gitText(root, ['rev-list', '--count', `${candidate.base_sha}..${sha}`])),
    paths,
    blobs
  };
}

export function loadPromotionEvidence(root = process.cwd()) {
  const candidateHead = gitText(root, ['rev-parse', 'HEAD']);
  const candidateParent = gitText(root, ['rev-parse', 'HEAD^']);
  const controlRef = 'refs/remotes/origin/v45/factory-control';
  const directoryRef = 'refs/remotes/origin/governance/project-directory';
  const baseControlHead = gitText(root, ['rev-parse', controlRef]);
  const baseMainHead = gitText(root, ['rev-parse', 'refs/remotes/origin/main']);
  const directoryHead = gitText(root, ['rev-parse', directoryRef]);
  const bindings = readJson(root, PROMOTION_BINDING_PATH);
  const trustRootLane = readJson(root, TRUST_ROOT_LANE_PATH);
  const sources = bindings.source_candidates.map((candidate) => sourceFacts(root, candidate));
  const projectPath = 'directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json';
  const projectBlob = readBlobDigest(root, directoryRef, projectPath);
  const changed = gitText(root, ['diff', '--name-only', `${PROMOTION_BASE}..${candidateHead}`])
    .split(/\r?\n/).filter(Boolean).sort();
  const bundleDigests = {};
  for (const ref of readJson(root, PROMOTION_CHECKPOINT_PATH).evidence_refs ?? []) {
    if (ref.kind !== 'BUNDLE_OBJECT') continue;
    const blob = readBlobDigest(root, candidateHead, ref.path);
    bundleDigests[ref.path] = {digest: blob.sha256, bytes: blob.bytes.length, blob_oid: blob.oid};
  }
  return {
    pointer: readJson(root, PROMOTION_POINTER_PATH),
    basePointer: readGitJson(root, controlRef, PROMOTION_POINTER_PATH),
    checkpoint: readJson(root, PROMOTION_CHECKPOINT_PATH),
    baseCheckpoint: readGitJson(root, controlRef, 'governance/csg/checkpoints/000200.json'),
    projectDirectory: readGitJson(root, directoryRef, projectPath),
    bindings,
    trustRootLane,
    mission: readJson(root, EXPECTED_MISSION),
    policy: readJson(root, EXPECTED_POLICY),
    currentExecutionPolicy: readJson(root, EXPECTED_CURRENT_POLICY),
    baseCurrentExecutionPolicy: readGitJson(root, controlRef, EXPECTED_CURRENT_POLICY),
    run: readJson(root, EXPECTED_RUN),
    contract: readJson(root, EXPECTED_CONTRACT),
    facts: {
      candidateHead,
      candidateParent,
      candidateCommitCount: Number(gitText(root, ['rev-list', '--count', `${PROMOTION_BASE}..${candidateHead}`])),
      candidatePaths: changed,
      baseControlHead,
      baseMainHead,
      directoryHead,
      directoryProjectBlob: projectBlob.oid,
      sources,
      bundleDigests
    }
  };
}

export function verifyPromotionPacket(root = process.cwd()) {
  const packet = loadPromotionEvidence(root);
  const result = assertPromotionEvidence(packet);
  for (const reference of packet.checkpoint.evidence_refs) {
    if (reference.kind !== 'BUNDLE_OBJECT') continue;
    const observed = packet.facts.bundleDigests[reference.path];
    ensure(observed && observed.digest === reference.digest, 'CP201_BUNDLE_EVIDENCE_DIGEST_MISMATCH');
  }
  const missionBlob = readBlobDigest(root, packet.facts.candidateHead, EXPECTED_MISSION);
  const policyBlob = readBlobDigest(root, packet.facts.candidateHead, EXPECTED_POLICY);
  const runBlob = readBlobDigest(root, packet.facts.candidateHead, EXPECTED_RUN);
  ensure(packet.checkpoint.mission_anchor?.ref.endsWith(`@blob:${missionBlob.oid}`) &&
    packet.checkpoint.policy_anchor?.ref.endsWith(`@blob:${policyBlob.oid}`) &&
    packet.checkpoint.run_ref?.revision === `blob:${runBlob.oid}`,
  'CP201_CONTENT_REF_BLOB_IDENTITY_MISMATCH');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyPromotionPacket()));
  } catch (error) {
    console.error(JSON.stringify({result: 'FAIL', code: error.code ?? 'PROMOTION_PACKET_VERIFICATION_FAILED', message: error.message}));
    process.exitCode = 1;
  }
}
