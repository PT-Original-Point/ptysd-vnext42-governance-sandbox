const EXPECTED_PHASE_DAG = {
  schema: 'VNEXT5_1_R2_PHASE_DAG_V1',
  phase_dependencies: {
    R2_02A: [],
    R2_02B: ['R2_02A'],
    R2_03: ['R2_02A'],
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

const EXPECTED_TOOL_NAMES = [
  'factory_status',
  'worker_prepare',
  'worker_start',
  'host_powershell'
];

const FROZEN_BRANCH = 'codex/v51-r2-governance-self-lock-normalization-20261002';
const CONTINUATION_PLAN_PATH = 'governance/csg/v51/plans/VNEXT5.1-R2-ROOT-CAUSE-CLOSURE-PLAN-USER-ATTACHMENT-20261002.md';
const FUTURE_PHASES = new Set(['R2_04', 'R2_05', 'R2_06', 'R2_07']);
const GOVERNANCE_LINTER_INVARIANTS = [
  'POLICY_NOT_STRONGER_THAN_HUMAN_SPEC',
  'PHASE_DAG_ACYCLIC',
  'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE',
  'NO_STALE_PHASE_NAMES',
  'NO_INVENTED_HUMAN_GATE',
  'NO_INVENTED_REVIEW_GATE',
  'NO_CANDIDATE_CANONICAL_OWNER',
  'NO_PATH_REVISION_ID_MISMATCH',
  'NO_STALE_PR_OR_SHA_AUTHORITY',
  'NO_DUPLICATE_BLOCKED_LANE',
  'NO_METADATA_TRANSPORT_DENIAL',
  'NO_CAPABILITY_REGRESSION',
  'NO_SELF_RESETTING_CHURN_FINGERPRINT'
];
const CONTROL_SEQUENCE = [
  'FRESH_PRESTATE_AND_CAS',
  'STALE_OWNER_CONTROL_TRANSITION_ONLY',
  'SAME_SOURCE_READBACK',
  'RECOMPUTE_READY',
  'NEXT_OWNER_DISPATCH_AS_SEPARATE_LATER_TRANSITION'
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function ensure(condition, code) {
  if (!condition) fail(code);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function assertAcyclic(dag) {
  const dependencies = dag?.phase_dependencies;
  ensure(isRecord(dependencies), 'PHASE_DAG_ACYCLIC');
  const visiting = new Set();
  const visited = new Set();
  function visit(phase) {
    if (visiting.has(phase)) fail('PHASE_DAG_ACYCLIC');
    if (visited.has(phase)) return;
    ensure(Object.hasOwn(dependencies, phase) && Array.isArray(dependencies[phase]),
      'PHASE_DAG_ACYCLIC');
    visiting.add(phase);
    for (const dependency of dependencies[phase]) {
      ensure(Object.hasOwn(dependencies, dependency), 'PHASE_DAG_ACYCLIC');
      visit(dependency);
    }
    visiting.delete(phase);
    visited.add(phase);
  }
  for (const phase of Object.keys(dependencies)) visit(phase);
}

function visitArrays(value, callback, path = []) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) visitArrays(child, callback, path);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['parked_lanes', 'blockers', 'evidence_refs'].includes(key) &&
        Array.isArray(child)) callback(key, child, path.concat(key));
    visitArrays(child, callback, path.concat(key));
  }
}

function assertDeterministicSets(objects) {
  for (const object of objects) {
    visitArrays(object, (name, values) => {
      const keys = values.map((value) => {
        if (name === 'evidence_refs' && isRecord(value)) {
          return value.path || value.revision || stable(value);
        }
        return stable(value);
      });
      ensure(new Set(keys).size === keys.length, 'NO_DUPLICATE_BLOCKED_LANE');
      ensure(keys.every((key, index) => index === 0 || keys[index - 1] <= key),
        'NO_DUPLICATE_BLOCKED_LANE');
    });
  }
}

function assertPhaseDag(packet) {
  const dags = [
    packet.mission?.payload?.phase_dag,
    packet.policy?.payload?.phase_dag,
    packet.checkpoint?.next_legal_transition?.phase_dag,
    packet.run?.goal_lifecycle_recovery?.phase_dag,
    packet.contract?.phase_dag,
    packet.bindings?.phase_dag,
    packet.currentExecutionPolicy?.payload?.phase_dag
  ];
  ensure(dags.every(Boolean), 'PHASE_DAG_ACYCLIC');
  dags.forEach(assertAcyclic);
  ensure(dags.every((dag) => stable(dag) === stable(EXPECTED_PHASE_DAG)),
    'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE');
  ensure(dags[0].phase_dependencies.R2_02B.includes('R2_02A') &&
    !dags[0].phase_dependencies.R2_02B.includes('R2_03'),
  'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE');
}

function assertPolicyMonotonicity(packet) {
  const state = packet.policy?.payload?.coordination?.owner_liveness_reconciliation;
  const criteria = state?.human_spec_criteria;
  ensure(state?.exact_cross_source_liveness_observation_required === false &&
    state?.strictly_stronger_than_spec === false &&
    state?.justification === null &&
    state?.human_approval_required_for_stricter_rule === false &&
    state?.owner_authority_validity === 'EXPIRED' &&
    state?.active_factory_job === 'NONE_OBSERVED' &&
    state?.executor_process_existence === 'UNKNOWN' &&
    state?.unknown_executor_process_extends_expired_owner_authority === false &&
    criteria?.run_state === 'RUNNING' &&
    criteria?.generation_5_lease_expired === true &&
    criteria?.factory_live_job_count === 0 &&
    criteria?.pending_receipt_count === 0 &&
    Array.isArray(criteria?.unresolved_effect_refs) &&
    criteria.unresolved_effect_refs.length === 0 &&
    criteria?.owner_authority_validity === 'EXPIRED' &&
    criteria?.active_factory_job === 'NONE_OBSERVED' &&
    criteria?.executor_process_existence === 'UNKNOWN' &&
    criteria?.unknown_executor_process_extends_expired_owner_authority === false,
  'POLICY_NOT_STRONGER_THAN_HUMAN_SPEC');
  ensure(state.lease_expiry_alone_confirms_stale === false &&
    state.aggregate_zero_job_counts_alone_confirm_stale === false,
  'POLICY_NOT_STRONGER_THAN_HUMAN_SPEC');
}

function assertNoFuturePhaseOrReviewGate(packet) {
  const missionAcceptance = packet.mission?.payload?.r2_03_acceptance;
  const policyAcceptance = packet.policy?.payload?.r2_03_acceptance_state;
  const dag = packet.policy?.payload?.phase_dag;
  const hostRequirements = packet.policy?.payload?.factory_mcp?.host_powershell
    ?.authorized_scope_requires;
  ensure(Array.isArray(dag?.r2_03_acceptance_requires) &&
    !dag.r2_03_acceptance_requires.some((item) =>
      [...FUTURE_PHASES].some((phase) => item.includes(phase)) ||
      /SEMANTIC_REVIEW_PASS/.test(item)),
  'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE');
  ensure(Array.isArray(hostRequirements) &&
    hostRequirements.includes('R2_04_UNIQUE_TRUSTED_CALLER_PASS') &&
    hostRequirements.includes('R2_05_NONCIRCULAR_HOST_REPAIR_LANE_PASS') &&
    !hostRequirements.some((item) => item.includes('R2_06')),
  'NO_METADATA_TRANSPORT_DENIAL');
  ensure(missionAcceptance?.semantic_review_required === false &&
    policyAcceptance?.semantic_review_required === false,
  'NO_INVENTED_REVIEW_GATE');
  const r2_03NotPassReasons = [
    packet.run?.r2_03_not_pass_reason,
    packet.run?.goal_lifecycle_recovery?.r2_03_not_pass_reason
  ].filter((reason) => typeof reason === 'string').join('\n');
  ensure(missionAcceptance.semantic_review_by_source?.pr381 === 'PENDING_CURRENT_HEAD' &&
    missionAcceptance.semantic_review_by_source?.pr377 === 'PENDING_CURRENT_SOURCE_PAIR' &&
    !packet.checkpoint?.blockers?.some((item) => /SEMANTIC_REVIEW|COPILOT.*QUOTA/i.test(item)) &&
    !/(?:SEMANTIC_REVIEWS?_PENDING|COPILOT.*QUOTA)/i.test(r2_03NotPassReasons),
  'NO_INVENTED_REVIEW_GATE');
  ensure(dag.r2_03_acceptance_excludes.length === 4 &&
    dag.r2_03_acceptance_excludes.every((phase) => FUTURE_PHASES.has(phase)) &&
    missionAcceptance.host_mutation === false &&
    missionAcceptance.mutation_fence === 'NOT_REQUIRED' &&
    missionAcceptance.live_install_acceptance_required === false &&
    missionAcceptance.live_install_acceptance_owner === 'R2_06',
  'NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE');
}

function assertNoStalePhaseNames(packet) {
  const current = [
    packet.mission?.payload,
    packet.policy?.payload,
    packet.checkpoint?.next_legal_transition,
    packet.run,
    packet.contract,
    packet.trustRootLane
  ];
  const text = current.map(stable).join('\n');
  ensure(!/R1_0[456]|R2_03_(?:REAL_TRUST_ROOT_PROVISIONING|HOST_INSTALLATION|SUPERVISOR_HEARTBEAT_ROUTE)/i.test(text),
    'NO_STALE_PHASE_NAMES');
}

function assertContinuationContract(packet) {
  const contract = packet.governanceNormalization?.continuation_contract;
  const attachment = packet.continuationPlan;
  ensure(contract?.path === CONTINUATION_PLAN_PATH &&
    contract?.source_filename === 'VNEXT5.1-R2-ROOT-CAUSE-CLOSURE-CONSTRUCTION-PLAN-20261002.md' &&
    contract?.spec_family === 'VNEXT5.1-R2' &&
    contract?.closure_units?.join(',') === 'C0,C1,C2,C3,C4,C5,C6,C7,C8,C9,C10,C11' &&
    contract?.authority === 'USER_EXPLICITLY_AUTHORIZED_THIS_SESSION' &&
    contract?.mission_or_spec_change === false &&
    attachment?.path === CONTINUATION_PLAN_PATH &&
    attachment?.sha256 === contract.sha256 &&
    attachment?.bytes === contract.bytes &&
    attachment?.line_count === contract.line_count &&
    attachment?.sha256 === 'sha256:' + attachment.sha256_hex,
  'CONTINUATION_CONTRACT_IDENTITY_MISMATCH');
}

function assertHumanGateReuse(packet) {
  const missionAuthorization = packet.mission?.payload?.authorization;
  const policyAuthorization = packet.policy?.payload?.coordination?.authorization;
  const gate = packet.trustRootLane?.procedure_and_gate;
  ensure(missionAuthorization?.reversible_preproduction_persistent === true &&
    missionAuthorization?.routine_per_session_reauthorization === false &&
    missionAuthorization?.reuse_existing_human_authorization_when_scope_unchanged === true &&
    missionAuthorization?.metadata_rollover_creates_new_human_gate === false &&
    policyAuthorization?.routine_per_session_reauthorization === false &&
    policyAuthorization?.reuse_existing_human_authorization_when_scope_unchanged === true &&
    policyAuthorization?.metadata_rollover_creates_new_human_gate === false &&
    gate?.prior_authorization_recorded === true &&
    gate?.metadata_rollover_reauthorization_required === false &&
    gate?.scope_change_requires_reauthorization === true,
  'NO_INVENTED_HUMAN_GATE');
}

function assertOwnerlessCandidate(packet) {
  const coordination = packet.policy?.payload?.coordination;
  const candidate = packet.bindings?.promotion_candidate;
  const rebuild = coordination?.r2_03_candidate_rebuild;
  ensure(packet.checkpoint?.owner === null &&
    packet.run?.execution_owner === null &&
    packet.run?.owner_generation === null &&
    coordination?.active_execution_owner === null &&
    coordination?.active_owner_generation === null &&
    candidate?.owner === null && candidate?.owner_generation === null &&
    candidate?.lease_until === null && candidate?.execution_owner_allocated === false &&
    candidate?.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION' &&
    rebuild?.owner_generation === null && rebuild?.lease_until === null &&
    rebuild?.execution_owner_allocated === false &&
    rebuild?.proposed_owner_generation_policy === 'NEXT_AVAILABLE_AT_PROMOTION',
  'NO_CANDIDATE_CANONICAL_OWNER');
}

function assertRevisionPaths(packet) {
  const missionPath = packet.paths?.mission;
  const policyPath = packet.paths?.policy;
  ensure(typeof missionPath === 'string' && typeof policyPath === 'string' &&
    missionPath.split('/').pop() === packet.mission?.mission_revision_id + '.json' &&
    policyPath.split('/').pop() === packet.policy?.policy_revision_id + '.json' &&
    packet.policy?.mission_revision_id === packet.mission?.mission_revision_id,
  'NO_PATH_REVISION_ID_MISMATCH');
}

function assertNoStalePacketAuthority(packet) {
  const branch = packet.trustRootLane?.canonical_candidate_branch;
  const branchInMission = packet.mission?.payload?.coordination?.r2_03_candidate_rebuild?.candidate_branch;
  const branchInPolicy = packet.policy?.payload?.coordination?.r2_03_candidate_rebuild?.candidate_branch;
  const branchInContract = packet.contract?.candidate_branch;
  ensure(packet.trustRootLane?.packet_pr_number === 383 &&
    branch === FROZEN_BRANCH &&
    branchInMission === FROZEN_BRANCH &&
    branchInPolicy === FROZEN_BRANCH &&
    branchInContract === FROZEN_BRANCH &&
    packet.bindings?.rebuild_history?.supersedes_pr382_exact_head &&
    packet.bindings?.rebuild_history?.superseded_authority_classification ===
      'HISTORICAL_OBSERVATION_EVIDENCE_NOT_CURRENT_PACKET_AUTHORITY' &&
    packet.trustRootLane?.separation?.promotion_packet_pr383_is_not_trust_root_source === true,
  'NO_STALE_PR_OR_SHA_AUTHORITY');
}

function assertMetadataDoesNotDenyTransport(packet) {
  const authorization = packet.policy?.payload?.coordination?.authorization;
  const requirements = packet.policy?.payload?.factory_mcp?.host_powershell
    ?.authorized_scope_requires || [];
  ensure(authorization?.session_rollover_is_not_transport_denial === true &&
    authorization?.attempt_or_generation_metadata_is_not_transport_denial === true &&
    authorization?.task_id_pattern_rollover_is_not_transport_denial === true &&
    authorization?.authorization_envelope_generation_churn_alone_is_not_transport_denial === true &&
    !requirements.some((value) => /MISSION|CHECKPOINT|RUN_ID|TASK_ID|ATTEMPT|GENERATION|SESSION|R2_06/i.test(value)),
  'NO_METADATA_TRANSPORT_DENIAL');
}

function assertCapabilityParity(packet) {
  const scope = packet.bindings?.r2_03_candidate_acceptance_scope;
  const source = packet.bindings?.candidate_local_qualification?.source_pr381;
  const version = String(source?.package_version || '').split('.').map(Number);
  const atLeast022 = version.length >= 3 &&
    (version[0] > 0 || (version[0] === 0 && version[1] > 2) ||
      (version[0] === 0 && version[1] === 2 && version[2] >= 2));
  ensure(scope?.public_tool_count === 4 &&
    stable(scope?.tool_names) === stable(EXPECTED_TOOL_NAMES) &&
    scope?.factory_status === 'FIXED_PURPOSE_READ_ONLY' &&
    scope?.readonly_diagnostics === true &&
    scope?.capability_non_regression_candidate_evidence === 'PASS_CANDIDATE_LOCAL' &&
    source?.capability_parity_candidate === 'QUALIFIED' &&
    atLeast022 &&
    source?.live_install_acceptance === 'NOT_ACCEPTED' &&
    packet.policy?.payload?.factory_mcp?.host_powershell
      ?.public_tool_retained === true &&
    packet.policy?.payload?.factory_mcp?.host_powershell
      ?.production_allowed === false,
  'NO_CAPABILITY_REGRESSION');
}

function assertChurnFingerprint(packet) {
  const rules = packet.governanceNormalization?.rules;
  const forbidden = new Set(rules?.logical_work_fingerprint_forbidden_fields || []);
  ensure(rules?.logical_work_fingerprint_excludes_candidate_output_sha === true &&
    rules?.self_generated_head_change_resets_loop_counters === false &&
    rules?.loop_reset_requires_exogenous_material_delta === true &&
    forbidden.has('candidate_output_sha') &&
    forbidden.has('candidate_head_sha') &&
    forbidden.has('reviewer_status') &&
    forbidden.has('session_id') &&
    forbidden.has('checkpoint_rollover_only'),
  'NO_SELF_RESETTING_CHURN_FINGERPRINT');
}

export function lintGovernanceCandidate(packet) {
  assertPolicyMonotonicity(packet);
  assertPhaseDag(packet);
  assertNoStalePhaseNames(packet);
  assertNoFuturePhaseOrReviewGate(packet);
  assertHumanGateReuse(packet);
  assertOwnerlessCandidate(packet);
  assertRevisionPaths(packet);
  assertNoStalePacketAuthority(packet);
  assertContinuationContract(packet);
  ensure(packet.governanceNormalization?.rules?.governance_linter_invariants?.join(',') ===
    GOVERNANCE_LINTER_INVARIANTS.join(','), 'GOVERNANCE_LINTER_INVARIANTS_MISMATCH');
  assertDeterministicSets([
    packet.mission,
    packet.policy,
    packet.checkpoint,
    packet.run,
    packet.contract,
    packet.bindings
  ]);
  assertMetadataDoesNotDenyTransport(packet);
  assertCapabilityParity(packet);
  assertChurnFingerprint(packet);
  return {
    result: 'PASS',
    scope: 'CANDIDATE_LOCAL_STATIC_GOVERNANCE_REGRESSION_ONLY',
    protected_trust_root_enforcement: false
  };
}

export {EXPECTED_PHASE_DAG, FROZEN_BRANCH, GOVERNANCE_LINTER_INVARIANTS, CONTINUATION_PLAN_PATH};
