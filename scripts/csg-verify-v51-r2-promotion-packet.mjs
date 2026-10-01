import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import canonicalize from '../tools/csg/node_modules/canonicalize/lib/canonicalize.js';
import {validateCsg} from './csg-schema.mjs';
import {assertOwnerLeaseValidAtCheckpointCreation} from './csg-owner-lease.mjs';
import {
  OWNER_ALLOCATION_INVARIANTS,
  assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease
} from './csg-owner-allocation.mjs';
import {
  assertNormalizedGitOid,
  assertOwnerGenerationIsNextAvailable,
  assertSourceBindingIdentity,
  assertVerifierClassification,
  failWithCode,
  gitOidBytesFromStdout
} from './csg-r2-promotion-assertions.mjs';

const root = path.resolve('.');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const gitText = (args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const gitOid = (args) => gitOidBytesFromStdout(execFileSync('git', args, {cwd: root})).toString('ascii');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const gitBlobBytes = (file) => {
  let oid;
  try { oid = gitOid(['rev-parse', `:${file}`]); }
  catch { oid = gitOid(['rev-parse', `HEAD:${file}`]); }
  return execFileSync('git', ['cat-file', 'blob', oid], {cwd: root});
};

const pointer = read('governance/csg/current.json');
const currentPath = 'governance/csg/current.json';
const checkpointPath = 'governance/csg/checkpoints/000201.json';
const previousPath = 'governance/csg/checkpoints/000200.json';
const checkpoint = read(checkpointPath);
const previous = read(previousPath);
if (pointer.checkpoint_seq !== 200 || pointer.checkpoint_path !== previousPath) {
  failWithCode('CANONICAL_CP200_PRESTATE_REQUIRED');
}
if (checkpoint.checkpoint_seq !== 201 ||
    checkpoint.previous_checkpoint_ref?.revision !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    checkpoint.previous_checkpoint_ref?.path !== previousPath ||
    checkpoint.previous_checkpoint_ref?.digest !== previous.payload_digest ||
    pointer.checkpoint_digest !== previous.payload_digest) {
  failWithCode('CP201_MUST_REMAIN_NONCANONICAL_OVER_CP200');
}
const regression = read('governance/csg/v51/regressions/ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT-v1.json');
const oidRegression = read('governance/csg/v51/regressions/GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX-v1.json');
const allocationRegressionPath = 'governance/csg/v51/regressions/OWNER_ALLOCATION_ARCHITECTURE_CORRECTION-v1.json';
const allocationRegression = read(allocationRegressionPath);
const allocationPath = 'governance/csg/v51/readbacks/R2-03-OWNER-ALLOCATION-ARCHITECTURE-CORRECTION-20261001.json';
const sourceCorrectionPath = 'governance/csg/v51/readbacks/R2-03-LOCAL-SOURCE-PRODUCER-CIM-DATETIME-20260930.json';
const allocation = read(allocationPath);
const historicalAllocationPath = 'governance/csg/v51/readbacks/R2-03-OWNER-GENERATION-ALLOCATION-20261001.json';
const historicalAllocation = read(historicalAllocationPath);
const historicalGenerationRegressionPath = 'governance/csg/v51/regressions/NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION-v1.json';
const historicalGenerationRegression = read(historicalGenerationRegressionPath);
const candidateManifestPath = 'governance/csg/v51/readbacks/R2-03-CP201-PROMOTION-CANDIDATE-MANIFEST-20261001.json';
const candidateManifest = read(candidateManifestPath);
const trustRootUpgradeLanePath = 'governance/csg/v51/trust-root-lanes/TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED-v1.json';
const trustRootUpgradeLane = read(trustRootUpgradeLanePath);
validateCsg(pointer);
validateCsg(previous);
validateCsg(checkpoint);
assertNormalizedGitOid(pointer.previous_control_oid?.hex);
assertNormalizedGitOid(checkpoint.previous_checkpoint_ref?.revision);
assertOwnerLeaseValidAtCheckpointCreation(checkpoint, previous);
const requiredAllocationInvariants = [
  OWNER_ALLOCATION_INVARIANTS.candidate,
  OWNER_ALLOCATION_INVARIANTS.selectedAtPromotion,
  OWNER_ALLOCATION_INVARIANTS.leaseTiming,
  OWNER_ALLOCATION_INVARIANTS.freshPrestate
];
assertNoncanonicalPreparedCandidateHasNoActiveOwnerLease(candidateManifest, checkpoint);
if (JSON.stringify(allocationRegression.required_verifier_invariants) !== JSON.stringify(requiredAllocationInvariants) ||
    allocationRegression.candidate_contract?.owner_generation !== null ||
    allocationRegression.candidate_contract?.lease_until !== null ||
    allocationRegression.candidate_contract?.checkpoint_owner !== null ||
    allocationRegression.candidate_contract?.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION' ||
    allocationRegression.promotion_cas_contract?.allocation_phase !== 'CANONICAL_PROMOTION_CAS' ||
    allocationRegression.promotion_cas_contract?.local_implementation_scope !== 'PURE_CONTRACT_AND_VERIFIER_FIXTURE_ONLY; NO_PROVIDER_CAS_PERFORMED' ||
    allocation.status !== 'CANDIDATE_OWNERLESS_ALLOCATION_DEFERRED' ||
    allocation.candidate?.candidate_instance_id !== candidateManifest.candidate_instance_id ||
    allocation.candidate?.owner_generation !== null || allocation.candidate?.lease_until !== null ||
    allocation.candidate?.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION' ||
    allocation.canonical_prestate?.checkpoint_seq !== previous.checkpoint_seq ||
    allocation.canonical_prestate?.owner_generation !== previous.owner?.owner_generation ||
    allocation.canonical_prestate?.control_commit !== checkpoint.previous_checkpoint_ref?.revision ||
    allocation.promotion_cas?.status !== 'REQUIRED_NOT_EXECUTED' ||
    allocation.promotion_cas?.fresh_durable_consumed_generation_readback !== 'REQUIRED_IN_SAME_CAS_TRANSACTION' ||
    allocation.promotion_cas?.same_source_readback_after_write !== true ||
    oidRegression.regression_id !== 'GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX') {
  failWithCode(OWNER_ALLOCATION_INVARIANTS.freshPrestate);
}
if (trustRootUpgradeLane.lane_id !== 'TRUST_ROOT_VERIFIER_UPGRADE_REQUIRED' ||
    trustRootUpgradeLane.status !== 'REQUIRED_SEPARATE_LANE_NOT_STARTED' ||
    trustRootUpgradeLane.evidence_boundary?.OWNER_ALLOCATION_ARCHITECTURE_SOURCE !== 'IMPLEMENTED' ||
    trustRootUpgradeLane.evidence_boundary?.CANDIDATE_LOCAL_OWNER_ALLOCATION_REGRESSION !== 'PASS' ||
    trustRootUpgradeLane.evidence_boundary?.CANDIDATE_LOCAL_PROMOTION_PACKET_VERIFIER !== 'PASS' ||
    trustRootUpgradeLane.evidence_boundary?.PROTECTED_TRUST_ROOT_ENFORCEMENT_OF_OWNER_ALLOCATION_INVARIANTS !== 'NOT_YET_IMPLEMENTED' ||
    trustRootUpgradeLane.evidence_boundary?.candidate_local_evidence_is_protected_enforcement !== false ||
    trustRootUpgradeLane.separation_guard?.trust_root_or_workflow_change_in_candidate_pr_prohibited !== true ||
    trustRootUpgradeLane.separation_guard?.trust_root_or_workflow_mutation_performed !== false) {
  failWithCode('TRUST_ROOT_VERIFIER_BOUNDARY_MISMATCH');
}
if (historicalAllocation.classification !== 'GEN6_BURNED_DURABLE_IDENTITY' ||
    historicalAllocation.prior_generation_six_candidate?.owner_generation !== 6 ||
    historicalAllocation.prior_generation_seven_candidate?.owner_generation !== 7 ||
    historicalAllocation.prior_generation_eight_candidate?.owner_generation !== 8 ||
    historicalAllocation.candidate?.owner_generation !== 9 ||
    historicalGenerationRegression.candidate_fixture?.expected_available_generation !== 9 ||
    allocation.historical_assessment?.provider_readable_candidate_documents_are_execution_generation_consumption !== false ||
    allocation.historical_assessment?.prior_allocation_assessment_is_not_the_current_durable_consumption_set !== true ||
    allocation.historical_assessment?.prior_generation_6_through_9_allocation_assessment_is_preserved_as_historical_bytes !== true ||
    allocationRegression.execution_generation_consumption_contract?.provider_addressable_inert_candidate_consumes_execution_generation !== false ||
    allocationRegression.execution_generation_consumption_contract?.historical_candidate_labels_6_through_9_are_not_current_consumed_generation_evidence !== true ||
    !allocationRegression.historical_documents_to_preserve_unchanged.includes(historicalAllocationPath) ||
    !allocationRegression.historical_documents_to_preserve_unchanged.includes(historicalGenerationRegressionPath)) {
  failWithCode('HISTORICAL_OWNER_GENERATION_EVIDENCE_CHANGED_OR_NOT_PRESERVED');
}
for (const document of allocation.historical_documents ?? []) {
  assertNormalizedGitOid(document.source_commit);
  assertNormalizedGitOid(document.blob_oid);
  if (gitOid(['rev-parse', `${document.source_commit}:${document.path}`]) !== document.blob_oid ||
      gitOid(['rev-parse', `:${document.path}`]) !== document.blob_oid) {
    failWithCode('HISTORICAL_OWNER_GENERATION_DOCUMENT_REWRITTEN');
  }
}
for (const oid of allocationRegression.historical_candidate_generation_labels.map((entry) => {
  const match = /([0-9a-f]{40})$/.exec(entry.provider_identity ?? '');
  return match?.[1];
})) assertNormalizedGitOid(oid);
if (allocationRegression.historical_candidate_generation_labels.length !== 4 ||
    allocationRegression.historical_candidate_generation_labels.some((entry, index) =>
      entry.generation !== index + 6 || entry.candidate_state !== 'PREPARED_NOT_DISPATCHED' ||
      entry.canonical_selection !== false || entry.execution_fence !== null ||
      entry.active_job_refs?.length !== 0 || entry.unresolved_effect_refs?.length !== 0 ||
      entry.classification !== 'HISTORICAL_CANDIDATE_ONLY_NOT_CONSUMED_EXECUTION_OWNER')) {
  failWithCode('HISTORICAL_CANDIDATE_OWNER_CENSUS_MISMATCH');
}
if (checkpoint.owner !== null || checkpoint.atomic?.state !== 'PREPARED_NOT_DISPATCHED' ||
    checkpoint.previous_checkpoint_ref?.revision !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    pointer.checkpoint_seq !== 200 || pointer.checkpoint_digest !== previous.payload_digest) {
  failWithCode(OWNER_ALLOCATION_INVARIANTS.candidate);
}

const bindingPath = candidateManifest.source_bindings_path;
const bindingBytes = gitBlobBytes(bindingPath);
const bindings = JSON.parse(bindingBytes.toString('utf8'));
const expected = [
  {pr_number: 342, origin_exact_sha: 'b26d400af6c232ad7fcf253c48f9066cbddc2d12', base_sha: 'd39486601d851e31256852a24e9c1393b9046fe5', tree_sha: 'a49a9686bde16155a3b3463f5cd4e5be4d3cd86f', verifier_run: 36832254056, verifier_job: 110271319055, bounded_job: 110271320313},
  {pr_number: 377, origin_exact_sha: 'a5a2b134eb1501dc644678ab5ad1e6700f99bff6', base_sha: '06da5fa224b65b9346e8b250dcea686d0ed458ee', tree_sha: '3477dace4e602a9e9a77cf7c86a3884c65c1ac2d', verifier_run: 36834803323, verifier_job: 110279537598, bounded_job: 110279539142}
];
if (bindings.source_candidates?.length !== expected.length) failWithCode('SOURCE_CANDIDATE_BINDING_COUNT_MISMATCH');
if (bindings.canonical_authority?.checkpoint_seq !== 200 ||
    bindings.canonical_authority?.control_commit !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    bindings.canonical_authority?.checkpoint_digest !== previous.payload_digest ||
    bindings.candidate_status !== 'CP201_REBUILT_CANDIDATE_ONLY_NOT_CANONICAL' ||
    bindings.verifier_boundary?.semantic_review !== 'PENDING_CURRENT_SOURCE_PAIR' ||
    bindings.verifier_boundary?.bounded_driver !== 'SKIPPED_NOT_PASS' ||
    bindings.qualification_state?.synthetic_integration_is_live_acceptance !== false) {
  failWithCode('FROZEN_SOURCE_PAIR_PACKET_AUTHORITY_OR_VERDICT_SCOPE_MISMATCH');
}
const prestatePath = candidateManifest.prestate_readback_path;
const prestate = read(prestatePath);
if (prestate.observed_at_utc !== bindings.observed_at_utc ||
    prestate.project_directory?.directory_revision !== 5 ||
    prestate.project_directory?.registration_state !== 'BOUND' ||
    prestate.project_directory?.control_locator?.ref !== 'refs/heads/v45/factory-control' ||
    prestate.canonical_authority?.checkpoint_seq !== 200 ||
    prestate.canonical_authority?.checkpoint_digest !== previous.payload_digest ||
    prestate.repository?.control_ref_head !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    prestate.canonical_authority?.owner?.classification !== 'STALE_EXECUTION_OWNER_CANDIDATE' ||
    prestate.canonical_authority?.owner?.stale_owner_confirmed !== false ||
    prestate.live_observation?.fixed_factory_mcp_read_route?.status !== 'UNAVAILABLE' ||
    prestate.live_observation?.host_liveness_routes?.stale_owner_confirmation !== false) {
  failWithCode('FRESH_CP200_PRESTATE_OR_LIVE_ROUTE_BOUNDARY_MISMATCH');
}
if (prestate.canonical_authority.current_pointer_blob_oid !== gitOid([
      'rev-parse',
      prestate.repository.control_ref_head + ':' + currentPath
    ]) ||
    prestate.canonical_authority.checkpoint_blob_oid !== gitOid([
      'rev-parse',
      prestate.repository.control_ref_head + ':' + previousPath
    ]) ||
    prestate.project_directory.blob_oid !== gitOid([
      'rev-parse',
      '38f4fc7cb2841e2318a97ff7a53e41b2ec07aef1:directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json'
    ])) {
  failWithCode('FRESH_CP200_PROVIDER_BLOB_IDENTITY_MISMATCH');
}
for (let index = 0; index < expected.length; index++) {
  const record = bindings.source_candidates[index];
  const target = expected[index];
  assertSourceBindingIdentity(record, target);
  assertVerifierClassification(record);
  const structural = record.checks.find((item) => item.name === 'csg-trusted-verifier');
  const bounded = record.checks.find((item) => item.name === 'bounded-driver-acceptance');
  if (structural?.run_id !== target.verifier_run || structural?.job_id !== target.verifier_job ||
      structural?.status !== 'completed' || structural?.conclusion !== 'success' ||
      structural?.verdict !== 'PASS_EXACT_HEAD' || structural?.scope !== 'IMMUTABLE_STRUCTURAL_VERIFIER_ONLY' ||
      bounded?.run_id !== target.verifier_run || bounded?.job_id !== target.bounded_job ||
      bounded?.status !== 'completed' || bounded?.conclusion !== 'skipped' ||
      bounded?.verdict !== 'SKIPPED_NOT_PASS') {
    failWithCode('SOURCE_VERIFIER_EVIDENCE_NOT_BOUND_TO_EXACT_HEAD');
  }
  if (gitOid(['rev-parse', `${record.origin_exact_sha}^{tree}`]) !== target.tree_sha ||
      gitText(['rev-list', '--count', `${record.base_sha}..${record.origin_exact_sha}`]) !== '1') {
    failWithCode('EXACT_SOURCE_TOPOLOGY_MISMATCH');
  }
  const paths = gitText(['diff-tree', '--no-commit-id', '--name-only', '-r', record.base_sha, record.origin_exact_sha])
    .split(/\r?\n/).filter(Boolean).sort();
  const covered = [...record.covered_paths].map((item) => item.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(covered)) failWithCode('EXACT_COVERED_PATH_SET_MISMATCH');
  for (const item of record.covered_paths) {
    assertNormalizedGitOid(item.blob_oid);
    const blob = gitOid(['rev-parse', `${record.origin_exact_sha}:${item.path}`]);
    const content = execFileSync('git', ['cat-file', 'blob', blob], {cwd: root});
    if (blob !== item.blob_oid || sha256(content) !== item.sha256) failWithCode('EXACT_COVERED_PATH_CONTENT_MISMATCH');
  }
}
const historical378 = bindings.historical_observation_evidence?.find((item) => item.pr_number === 378);
if (historical378?.classification !== 'HISTORICAL_OBSERVATION_EVIDENCE' ||
    historical378?.verdict_portability !== 'VERDICT_NOT_PORTABLE_TO_CURRENT_SOURCE_PAIR' ||
    historical378?.original_bytes_preserved !== true || historical378?.rebuilt_for_source_sha_drift !== false ||
    historical378?.duplicate_observation_or_verifier_work_performed !== false) {
  failWithCode('PR378_HISTORICAL_EVIDENCE_MUST_REMAIN_UNCHANGED_AND_NONPORTABLE');
}

const missionPath = `governance/csg/v51/missions/${checkpoint.mission_anchor.revision}.json`;
const policyPath = `governance/csg/v51/policies/${checkpoint.policy_anchor.revision}.json`;
const mission = read(missionPath);
const policy = read(policyPath);
if (mission.mission_hash !== sha256(Buffer.from(canonicalize(mission.payload), 'utf8')) ||
    checkpoint.mission_anchor.declared_hash !== mission.mission_hash ||
    mission.mission_revision_id !== checkpoint.mission_anchor.revision ||
    policy.policy_hash !== sha256(Buffer.from(canonicalize(policy.payload), 'utf8')) ||
    checkpoint.policy_anchor.declared_hash !== policy.policy_hash ||
    policy.policy_revision_id !== checkpoint.policy_anchor.revision ||
    policy.mission_revision_id !== mission.mission_revision_id ||
    policy.mission_hash !== mission.mission_hash) {
  failWithCode('CP201_MISSION_POLICY_HASH_OR_REVISION_MISMATCH');
}
const missionContentRef = /@blob:([0-9a-f]{40})$/.exec(checkpoint.mission_anchor?.ref ?? '');
const policyContentRef = /@blob:([0-9a-f]{40})$/.exec(checkpoint.policy_anchor?.ref ?? '');
const runContentRef = /^blob:([0-9a-f]{40})$/.exec(checkpoint.run_ref?.revision ?? '');
if (!missionContentRef || !policyContentRef || !runContentRef) failWithCode('CP201_CONTENT_REF_OID_MALFORMED');
for (const match of [missionContentRef, policyContentRef, runContentRef]) assertNormalizedGitOid(match[1]);
for (const [file, expectedOid] of [[missionPath, missionContentRef[1]], [policyPath, policyContentRef[1]],
  [checkpoint.run_ref.path, runContentRef[1]]]) {
  const actualOid = gitOid(['rev-parse', `:${file}`]);
  if (actualOid !== expectedOid) failWithCode('CP201_CONTENT_REF_OID_MISMATCH');
}
const candidateRebuild = policy.payload.coordination?.r2_03_candidate_rebuild;
const missionCandidateRebuild = mission.payload.coordination?.r2_03_candidate_rebuild;
if (candidateRebuild?.candidate_instance_id !== candidateManifest.candidate_instance_id ||
    missionCandidateRebuild?.candidate_instance_id !== candidateManifest.candidate_instance_id ||
    candidateRebuild?.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION' ||
    missionCandidateRebuild?.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION' ||
    candidateRebuild?.owner_generation !== null || missionCandidateRebuild?.owner_generation !== null ||
    candidateRebuild?.lease_until !== null || missionCandidateRebuild?.lease_until !== null ||
    candidateRebuild?.lease_duration_seconds !== candidateManifest.lease_duration_seconds ||
    missionCandidateRebuild?.lease_duration_seconds !== candidateManifest.lease_duration_seconds ||
    candidateRebuild?.canonical_checkpoint_seq !== previous.checkpoint_seq ||
    missionCandidateRebuild?.canonical_checkpoint_seq !== previous.checkpoint_seq ||
    mission.payload.active_owner_generation !== null ||
    mission.payload.coordination?.active_owner_generation !== null ||
    policy.payload.coordination?.active_owner_generation !== null ||
    policy.payload.r2_03_observation_lane?.owner_generation !== null ||
    policy.payload.r2_03_observation_lane?.owner_lease_until !== null ||
    mission.payload.historical_candidate_generation_9_lease_until === undefined ||
    policy.payload.coordination?.historical_candidate_generation_9_lease_until === undefined) {
  failWithCode('CP201_OWNER_ALLOCATION_MISSION_POLICY_MISMATCH');
}
const run = read(checkpoint.run_ref.path);
const contract = read('governance/csg/v51/runs/V51-R2-001/contract-r2-03-attempt-002.json');
if (run.state !== 'PREPARED_NOT_DISPATCHED' || run.execution_owner !== null ||
    run.owner_generation !== null || run.owner_lease_until !== null ||
    run.candidate_instance_id !== candidateManifest.candidate_instance_id ||
    contract.owner_generation !== null || contract.owner_lease_until !== null ||
    contract.candidate_instance_id !== candidateManifest.candidate_instance_id ||
    contract.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION') {
  failWithCode(OWNER_ALLOCATION_INVARIANTS.candidate);
}

const blockerPacket = read(candidateManifest.blocker_reconciliation_path);
const byId = new Map(blockerPacket.blockers.map((entry) => [entry.blocker_id, entry]));
for (const id of checkpoint.blockers) {
  const status = byId.get(id)?.classification;
  if (!status || status === 'RESOLVED' || status === 'SUPERSEDED') failWithCode('CHECKPOINT_BLOCKER_STATUS_MISMATCH');
}
const sourcePublisher = byId.get('R2_03_SYSTEM_BROKER_SNAPSHOT_PUBLISHER_NOT_YET_QUALIFIED');
if (sourcePublisher?.classification !== 'SUPERSEDED' ||
    !sourcePublisher.superseded_by?.includes('R2_03_SOURCE_CONTRACT_QUALIFIED_CANDIDATE') ||
    !sourcePublisher.superseded_by?.includes('R2_03_LIVE_SIGNED_EVIDENCE_PATH_NOT_ACCEPTED')) {
  failWithCode('SOURCE_AND_LIVE_PUBLISHER_STATES_CONFLATED');
}
const factoryRoute = byId.get('R2_03_LIVE_FACTORY_MCP_ROUTE_UNAVAILABLE_IN_CURRENT_EXECUTOR');
const postAudit = prestate;
if (factoryRoute?.classification !== 'CURRENT' || factoryRoute.status !== 'UNAVAILABLE' ||
    postAudit.live_observation?.fixed_factory_mcp_read_route?.status !== 'UNAVAILABLE') {
  failWithCode('FACTORY_MCP_ROUTE_BLOCKER_NOT_FRESHLY_RECONCILED');
}

const trust = read('governance/csg/v51/live-acceptance/r2-03/trust-provisioning-manifest.json');
const providerRoute = read('governance/csg/v51/live-acceptance/r2-03/provider-session-route-contract.json');
const heartbeatRoute = read('governance/csg/v51/live-acceptance/r2-03/supervisor-heartbeat-route-contract.json');
const acceptance = read('governance/csg/v51/live-acceptance/r2-03/live-acceptance-packet.json');
const installPlanPath = 'governance/csg/v51/live-acceptance/r2-03/install-readback-plan.json';
const installPlan = read(installPlanPath);
const expectedTrustFields = ['key_id', 'issuer_role', 'project_id', 'scope', 'generation', 'not_before', 'not_after', 'revoked_at', 'schemas', 'public_key_pem'];
const expectedTrustTargets = [
  {issuer_role: 'HOST_LOCAL', scope: 'V51_R2_LOCAL_OWNER_LIVENESS', schema: 'PTYSD_LOCAL_LIVENESS_EVIDENCE_V1'},
  {issuer_role: 'PROVIDER_AGENT', scope: 'V51_R2_PROVIDER_AGENT_SESSION', schema: 'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1'},
  {issuer_role: 'HOST_SUPERVISOR', scope: 'V51_R2_SUPERVISOR_HEARTBEAT', schema: 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1'}
];
const expectedProviderFields = ['project_id', 'provider', 'task_id', 'attempt_id', 'attempt_epoch', 'owner_generation', 'owner_principal_id', 'owner_session_id', 'provider_session_id', 'provider_job_id', 'state', 'observed_at', 'source'];
const expectedHeartbeatFields = ['project_id', 'supervisor_id', 'boot_identity', 'service_identity', 'task_identity', 'process_identity', 'task_id', 'attempt_id', 'attempt_epoch', 'owner_generation', 'heartbeat_id', 'heartbeat_at_utc', 'evidence_digest', 'signature', 'producer_identity'];
if (trust.install_authorized !== false || trust.provisioning_targets?.length !== 3 || trust.current_runtime_trust_root_count !== 0) {
  failWithCode('LIVE_TRUST_PROVISIONING_STATUS_MISMATCH');
}
if (trust.provisioning_targets.some((record) => record.status !== 'NOT_PROVISIONED' || record.public_key_pem !== null)) {
  failWithCode('UNPROVISIONED_TRUST_ROOT_MUST_REMAIN_EXPLICIT');
}
if (JSON.stringify(trust.required_key_metadata) !== JSON.stringify(expectedTrustFields) ||
    trust.worker_provider_write_credentials !== 0 || trust.synthetic_test_keys_in_runtime !== false ||
    trust.provisioning_targets.some((record, index) => JSON.stringify(record.required_fields) !== JSON.stringify(expectedTrustFields) ||
      record.issuer_role !== expectedTrustTargets[index].issuer_role || record.scope !== expectedTrustTargets[index].scope ||
      JSON.stringify(record.schemas) !== JSON.stringify([expectedTrustTargets[index].schema]) ||
      Object.hasOwn(record, 'public_key') || record.private_key !== undefined)) {
  failWithCode('TRUST_PROVISIONING_PACKAGE_SCHEMA_OR_SECRET_BOUNDARY_MISMATCH');
}
if (providerRoute.status !== 'UNAVAILABLE' || heartbeatRoute.status !== 'UNAVAILABLE') {
  failWithCode('LIVE_ROUTE_UNAVAILABILITY_MUST_REMAIN_EXPLICIT');
}
assertNormalizedGitOid(providerRoute.current_runtime_manifest_ref?.revision);
for (const oid of [installPlan.target?.runtime_exact_head, installPlan.target?.runtime_base_sha,
  installPlan.target?.runtime_tree_sha, installPlan.exact_source_pair?.[0]?.head,
  installPlan.exact_source_pair?.[1]?.head]) assertNormalizedGitOid(oid);
if (JSON.stringify(providerRoute.required_exact_output_identity) !== JSON.stringify(expectedProviderFields) ||
    JSON.stringify(heartbeatRoute.required_exact_output_identity) !== JSON.stringify(expectedHeartbeatFields)) {
  failWithCode('LIVE_ROUTE_CONTRACT_IDENTITY_FIELDS_INCOMPLETE');
}
if (providerRoute.current_runtime_manifest_ref?.revision !== expected[1].origin_exact_sha ||
    providerRoute.current_runtime_manifest_ref?.digest !== 'sha256:97bee3f46d0708fb4e54fa9f51155b18918e0d1fe7705b761f1d2928bef415c3' ||
    installPlan.target?.runtime_manifest_digest !== 'sha256:97bee3f46d0708fb4e54fa9f51155b18918e0d1fe7705b761f1d2928bef415c3' ||
    installPlan.status !== 'PREPARED_NOT_INSTALLABLE_REAL_KEYS_AND_AUTHORIZED_ROUTE_REQUIRED' ||
    installPlan.host_mutation_authorized !== false || installPlan.install_authorized !== false ||
    installPlan.target?.host_identity !== null || installPlan.target?.fixed_host_path !== null) {
  failWithCode('LIVE_INSTALL_READBACK_PLAN_STATUS_MISMATCH');
}
if (installPlan.trust_root_records?.required_count !== 3 || installPlan.trust_root_records.real_public_keys_available !== false ||
    installPlan.trust_root_records.private_key_in_package !== false || installPlan.trust_root_records.worker_provider_write_credentials !== 0 ||
    JSON.stringify(installPlan.trust_root_records.issuer_roles) !== JSON.stringify(['HOST_LOCAL', 'PROVIDER_AGENT', 'HOST_SUPERVISOR']) ||
    JSON.stringify(installPlan.trust_root_records.required_fields) !== JSON.stringify(expectedTrustFields) ||
    installPlan.intended_install_constraints?.read_only_after_install !== true ||
    installPlan.intended_install_constraints?.requires_canonical_policy_transition !== true ||
    JSON.stringify(installPlan.exact_source_pair) !== JSON.stringify([{pr:342,head:expected[0].origin_exact_sha},{pr:377,head:expected[1].origin_exact_sha}])) {
  failWithCode('LIVE_INSTALL_PACKAGE_SCOPE_OR_IDENTITY_MISMATCH');
}
for (const component of installPlan.package_components ?? []) {
  const bytes = gitBlobBytes(component.path);
  if (component.source_scope !== 'CP201_PROMOTION_PACKET_CANDIDATE_BYTES' ||
      gitOid(['rev-parse', ':' + component.path]) !== component.blob_oid ||
      sha256(bytes) !== component.digest) failWithCode('LIVE_INSTALL_PACKAGE_COMPONENT_DIGEST_MISMATCH');
}
if (acceptance.status !== 'NOT_ACCEPTED' || acceptance.criteria.some((criterion) => criterion.status !== 'NOT_ACCEPTED')) {
  failWithCode('LIVE_ACCEPTANCE_MUST_NOT_BE_MARKED_PASS');
}

assertNormalizedGitOid(candidateManifest.base_commit);
if (candidateManifest.base_commit !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    candidateManifest.expected_parent_count !== 1 || candidateManifest.owner_generation !== null ||
    candidateManifest.lease_until !== null || candidateManifest.execution_owner_allocated !== false ||
    candidateManifest.candidate_status !== 'NONCANONICAL_PREPARED_NOT_DISPATCHED' ||
    candidateManifest.candidate_branch !== allocation.candidate?.candidate_branch ||
    candidateManifest.recorded_at !== checkpoint.recorded_at ||
    candidateManifest.candidate_instance_id !== allocation.candidate?.candidate_instance_id ||
    candidateManifest.lease_duration_seconds !== allocation.candidate?.lease_duration_seconds ||
    candidateManifest.proposed_owner_generation_policy !== 'NEXT_AVAILABLE_AT_PROMOTION' ||
    candidateManifest.source_bindings_path !== bindingPath ||
    candidateManifest.prestate_readback_path !== prestatePath ||
    candidateManifest.allocation?.allocation_phase !== 'CANONICAL_PROMOTION_CAS' ||
    candidateManifest.allocation?.status !== 'DEFERRED_NOT_ALLOCATED' ||
    candidateManifest.allocation?.record_path !== allocationPath ||
    candidateManifest.allocation?.regression_path !== allocationRegressionPath) {
  failWithCode('CP201_CANDIDATE_MANIFEST_MISMATCH');
}
if (pointer.checkpoint_seq !== 200 || pointer.checkpoint_path !== previousPath ||
    pointer.checkpoint_digest !== previous.payload_digest || checkpoint.checkpoint_seq !== 201 ||
    checkpoint.payload_digest === pointer.checkpoint_digest ||
    candidateManifest.control_pointer_changes_canonical_authority !== false) {
  failWithCode('CP201_MUST_REMAIN_NONCANONICAL_OVER_CP200');
}
for (const item of checkpoint.evidence_refs.filter((entry) => entry.kind === 'BUNDLE_OBJECT')) {
  const bytes = gitBlobBytes(item.path);
  if (sha256(bytes) !== item.digest) failWithCode('CP201_BUNDLE_EVIDENCE_DIGEST_MISMATCH');
}

const bindingDigest = sha256(bindingBytes);
if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === bindingPath && item.digest === bindingDigest)) {
  failWithCode('EXACT_SOURCE_BINDING_NOT_REFERENCED_BY_CP201');
}
if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === installPlanPath)) {
  failWithCode('LIVE_INSTALL_READBACK_PLAN_NOT_REFERENCED_BY_CP201');
}
if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === allocationPath)) {
  failWithCode('OWNER_ALLOCATION_ARCHITECTURE_NOT_REFERENCED_BY_CP201');
}
if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === sourceCorrectionPath)) {
  failWithCode('LOCAL_SOURCE_CORRECTION_READBACK_NOT_REFERENCED_BY_CP201');
}
if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === trustRootUpgradeLanePath)) {
  failWithCode('TRUST_ROOT_VERIFIER_UPGRADE_LANE_NOT_REFERENCED_BY_CP201');
}
for (const regressionPath of [
  allocationRegressionPath,
  'governance/csg/v51/regressions/GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX-v1.json'
]) {
  if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === regressionPath)) {
    failWithCode('DETERMINISTIC_OWNER_ALLOCATION_OR_OID_REGRESSION_NOT_REFERENCED_BY_CP201');
  }
}
console.log(JSON.stringify({
  regression: allocationRegression.regression_id,
  canonical_checkpoint_seq: pointer.checkpoint_seq,
  checkpoint_seq: checkpoint.checkpoint_seq,
  candidate_instance_id: candidateManifest.candidate_instance_id,
  owner_generation: null,
  recorded_at: checkpoint.recorded_at,
  lease_duration_seconds: candidateManifest.lease_duration_seconds,
  lease_until: null,
  owner_generation_policy: candidateManifest.proposed_owner_generation_policy,
  allocation_status: allocation.status,
  historical_owner_generation_labels: allocationRegression.historical_candidate_generation_labels.map((entry) => entry.generation),
  exact_source_candidates: expected.map((item) => ({pr_number: item.pr_number, head: item.origin_exact_sha, tree: item.tree_sha})),
  blocker_reconciliation: 'CURRENT_SOURCE_AND_LIVE_BLOCKERS_SPLIT; REVIEW_LANES_PARKED; GLOBAL_BLOCKED_FALSE',
  live_install_readback_plan: 'PREPARED_NOT_INSTALLABLE',
  live_trust_provisioning: 'NOT_ACCEPTED',
  live_provider_session_route: 'NOT_ACCEPTED',
  live_supervisor_heartbeat_route: 'NOT_ACCEPTED',
  live_signed_evidence_path: 'NOT_ACCEPTED',
  candidate_local_verifier_scope: 'CANDIDATE_LOCAL_ONLY',
  protected_trust_root_owner_allocation_enforcement: 'NOT_YET_IMPLEMENTED',
  result: 'PASS'
}));
