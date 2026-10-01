import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import canonicalize from '../tools/csg/node_modules/canonicalize/lib/canonicalize.js';
import {validateCsg} from './csg-schema.mjs';
import {assertOwnerLeaseValidAtCheckpointCreation} from './csg-owner-lease.mjs';
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
if (pointer.checkpoint_seq !== 201) {
  console.log(JSON.stringify({regression: 'ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT', result: 'NOT_APPLICABLE', canonical_or_candidate_seq: pointer.checkpoint_seq}));
  process.exit(0);
}

const checkpointPath = 'governance/csg/checkpoints/000201.json';
const previousPath = 'governance/csg/checkpoints/000200.json';
if (pointer.checkpoint_path !== checkpointPath) failWithCode('CURRENT_CHECKPOINT_PATH_MISMATCH');
const checkpoint = read(checkpointPath);
const previous = read(previousPath);
const regression = read('governance/csg/v51/regressions/ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT-v1.json');
const generationRegression = read('governance/csg/v51/regressions/NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION-v1.json');
const oidRegression = read('governance/csg/v51/regressions/GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX-v1.json');
validateCsg(pointer);
validateCsg(checkpoint);
assertNormalizedGitOid(pointer.previous_control_oid?.hex);
assertNormalizedGitOid(checkpoint.previous_checkpoint_ref?.revision);
assertOwnerLeaseValidAtCheckpointCreation(checkpoint, previous);
const allocationPath = 'governance/csg/v51/readbacks/R2-03-OWNER-GENERATION-ALLOCATION-20261001.json';
const allocation = read(allocationPath);
if (allocation.regression_id !== generationRegression.regression_id ||
    allocation.classification !== 'GEN6_BURNED_DURABLE_IDENTITY' ||
    allocation.canonical_owner?.checkpoint_seq !== previous.checkpoint_seq ||
    allocation.canonical_owner?.owner_generation !== previous.owner?.owner_generation ||
    allocation.candidate?.owner_generation !== checkpoint.owner?.owner_generation ||
    allocation.candidate?.recorded_at !== checkpoint.recorded_at ||
    allocation.candidate?.lease_until !== checkpoint.owner?.lease_until ||
    allocation.policy_assessment?.durable_allocator_present !== false ||
    allocation.policy_assessment?.monotonic_nonreuse_for_unselected_candidates_required !== false ||
    allocation.candidate_scoped_allocation_rule?.scope !== 'CP201_CANDIDATE_PACKET_ONLY' ||
    allocation.candidate_scoped_allocation_rule?.durable_allocator_claimed !== false ||
    allocation.candidate_scoped_allocation_rule?.rule !== 'NEXT_INTEGER_GREATER_THAN_CANONICAL_AND_NOT_IN_DURABLY_CONSUMED_SET') {
  failWithCode('OWNER_GENERATION_ALLOCATION_RECORD_MISMATCH');
}
if (allocation.canonical_checkpoint_census?.generation_six_present !== false ||
    JSON.stringify(allocation.canonical_checkpoint_census?.distinct_owner_generations) !== JSON.stringify([1, 2, 3, 4, 5]) ||
    JSON.stringify(allocation.durably_consumed_generation_values) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]) ||
    JSON.stringify(generationRegression.candidate_fixture?.durably_consumed_generations) !== JSON.stringify(allocation.durably_consumed_generation_values) ||
    generationRegression.candidate_fixture?.expected_available_generation !== allocation.candidate?.owner_generation ||
    generationRegression.candidate_fixture?.prior_generation_six_classification !== allocation.classification ||
    generationRegression.unconsumed_candidate_fixture?.classification !== 'GEN6_UNCONSUMED_CANDIDATE' ||
    generationRegression.unconsumed_candidate_fixture?.provider_addressable_owner_claim !== false ||
    generationRegression.unconsumed_candidate_fixture?.durable_lease_or_fence_or_job_or_receipt_or_effect !== false ||
    generationRegression.unconsumed_candidate_fixture?.policy_monotonic_nonreuse_required !== false ||
    generationRegression.unconsumed_candidate_fixture?.expected_available_generation !== 6 ||
    oidRegression.regression_id !== 'GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX') {
  failWithCode('CANONICAL_GENERATION_CENSUS_MISMATCH');
}
const generationSixFixture = generationRegression.candidate_fixture?.generation_six_provider_claim;
const historicalGenerationSixFixture = generationRegression.candidate_fixture?.generation_six_historical_provider_claim;
const generationSevenFixture = generationRegression.candidate_fixture?.generation_seven_provider_claim;
const generationEightFixture = generationRegression.candidate_fixture?.generation_eight_provider_claim;
for (const oid of [generationSixFixture?.commit_sha, historicalGenerationSixFixture?.commit_sha,
  generationSevenFixture?.commit_sha, generationEightFixture?.commit_sha]) {
  assertNormalizedGitOid(oid);
}
if (generationSixFixture?.commit_sha !== '3cf057c4b28d3c7f225823ede198ac9845e050e0' ||
    generationSixFixture?.workflow_run_id !== 36801312818 || generationSixFixture?.verifier_job_id !== 110176050759 ||
    historicalGenerationSixFixture?.commit_sha !== 'f1b95241b744bf57b924e5e7856f681fd20b216e' ||
    historicalGenerationSixFixture?.workflow_run_id !== 36740121863 ||
    generationSevenFixture?.commit_sha !== '1cee612cf30e96cd5e3d7ae130948018ec6f1393' ||
    generationEightFixture?.commit_sha !== '7cfb1ec3711421b5ee534be19f321fbec33a82a3' ||
    generationEightFixture?.branch !== 'codex/r2-cp201-generation-discipline-20261001') {
  failWithCode('GENERATION_REGRESSION_PROVIDER_FIXTURE_MISMATCH');
}
const priorGenerationSix = allocation.prior_generation_six_candidate;
const generationSixPublication = priorGenerationSix?.provider_publication;
if (priorGenerationSix?.classification !== 'GEN6_BURNED_DURABLE_IDENTITY' ||
    priorGenerationSix?.checkpoint_seq !== 201 || priorGenerationSix?.owner_generation !== 6 ||
    priorGenerationSix?.canonical_selection !== false || priorGenerationSix?.execution_fence !== null ||
    priorGenerationSix?.lease_valid_at_recorded_at !== false ||
    priorGenerationSix?.active_job_refs?.length !== 0 || priorGenerationSix?.unresolved_effect_refs?.length !== 0 ||
    priorGenerationSix?.branches_where_head?.includes('codex/v51-r1-03-readonly-bootstrap-20260929') !== true ||
    priorGenerationSix?.associated_pull_requests?.includes(342) !== true ||
    Date.parse(priorGenerationSix?.lease_until) >= Date.parse(priorGenerationSix?.recorded_at) ||
    generationSixPublication?.kind !== 'PULL_REQUEST_EXACT_HEAD_PROVIDER_WORKFLOW' ||
    generationSixPublication?.pr_number !== 342 ||
    generationSixPublication?.exact_head_sha !== priorGenerationSix?.commit_sha ||
    generationSixPublication?.workflow_run_id !== 36801312818 ||
    generationSixPublication?.workflow_event !== 'pull_request_target' ||
    generationSixPublication?.verifier_job_id !== 110176050759 ||
    generationSixPublication?.verifier_name !== 'csg-trusted-verifier' ||
    generationSixPublication?.verifier_conclusion !== 'success' ||
    generationSixPublication?.current_pr_state !== 'open' ||
    generationSixPublication?.current_pr_draft !== true ||
    generationSixPublication?.current_pr_merged !== false ||
    priorGenerationSix?.historical_provider_publications?.some((publication) =>
      publication.exact_head_sha === 'f1b95241b744bf57b924e5e7856f681fd20b216e' &&
      publication.workflow_run_id === 36740121863 &&
      publication.verifier_job_id === 109972022641 &&
      publication.verifier_conclusion === 'success') !== true) {
  failWithCode('GEN6_BURNED_CLASSIFICATION_NOT_PROVEN');
}
const priorGenerationSeven = allocation.prior_generation_seven_candidate;
if (priorGenerationSeven?.classification !== 'GEN7_PROVIDER_ADDRESSABLE_CANDIDATE' ||
    priorGenerationSeven?.owner_generation !== 7 || priorGenerationSeven?.checkpoint_seq !== 201 ||
    priorGenerationSeven?.canonical_selection !== false || priorGenerationSeven?.branch_head !== true ||
    priorGenerationSeven?.branch !== 'codex/r2-cp201-audit-rebuild-20261001' ||
    priorGenerationSeven?.commit_sha !== allocation.provider_readback?.current_candidate_generation_seven_commit ||
    priorGenerationSeven?.active_job_refs?.length !== 0 || priorGenerationSeven?.unresolved_effect_refs?.length !== 0) {
  failWithCode('GEN7_PROVIDER_PUBLICATION_NOT_RECONCILED');
}
const priorGenerationEight = allocation.prior_generation_eight_candidate;
if (priorGenerationEight?.classification !== 'GEN8_PROVIDER_ADDRESSABLE_CANDIDATE' ||
    priorGenerationEight?.owner_generation !== 8 || priorGenerationEight?.checkpoint_seq !== 201 ||
    priorGenerationEight?.canonical_selection !== false || priorGenerationEight?.branch_head !== true ||
    priorGenerationEight?.branch !== 'codex/r2-cp201-generation-discipline-20261001' ||
    priorGenerationEight?.commit_sha !== allocation.provider_readback?.current_candidate_generation_eight_commit ||
    priorGenerationEight?.tree_oid !== allocation.provider_readback?.current_candidate_generation_eight_tree ||
    priorGenerationEight?.active_job_refs?.length !== 0 || priorGenerationEight?.unresolved_effect_refs?.length !== 0) {
  failWithCode('GEN8_PROVIDER_PUBLICATION_NOT_RECONCILED');
}
for (const oid of [
  allocation.canonical_owner?.control_commit,
  priorGenerationSix?.commit_sha,
  priorGenerationSix?.checkpoint_blob_oid,
  priorGenerationSix?.pointer_blob_oid,
  priorGenerationSix?.previous_control_oid,
  generationSixPublication?.exact_head_sha,
  generationSixPublication?.workflow_head_sha,
  generationSixPublication?.current_pr_head_tree,
  generationSixPublication?.current_pr_head_checkpoint_blob_oid,
  priorGenerationSix?.historical_provider_publications?.[0]?.exact_head_sha,
  priorGenerationSix?.historical_provider_publications?.[0]?.workflow_head_sha,
  priorGenerationSeven?.commit_sha,
  priorGenerationSeven?.tree_oid,
  priorGenerationEight?.commit_sha,
  priorGenerationEight?.tree_oid,
  priorGenerationEight?.checkpoint_blob_oid,
  priorGenerationEight?.pointer_blob_oid,
  priorGenerationEight?.previous_control_oid,
  allocation.provider_readback?.project_directory_commit,
  allocation.provider_readback?.project_directory_blob_oid,
  allocation.provider_readback?.current_candidate_generation_six_commit,
  allocation.provider_readback?.current_candidate_generation_six_tree,
  allocation.provider_readback?.current_candidate_generation_seven_commit,
  allocation.provider_readback?.current_candidate_generation_seven_tree,
  allocation.provider_readback?.current_candidate_generation_eight_commit,
  allocation.provider_readback?.current_candidate_generation_eight_tree
]) assertNormalizedGitOid(oid);
assertOwnerGenerationIsNextAvailable(
  allocation.candidate.owner_generation,
  allocation.canonical_owner.owner_generation,
  allocation.durably_consumed_generation_values
);
if (checkpoint.previous_checkpoint_ref?.revision !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    pointer.previous_control_oid?.hex !== 'd39486601d851e31256852a24e9c1393b9046fe5') {
  failWithCode('CP201_NOT_REBUILT_FROM_EXACT_CP200');
}

const bindingPath = 'governance/csg/v51/readbacks/R2-03-PROMOTION-EVIDENCE-BINDINGS-20261001.json';
const bindingBytes = gitBlobBytes(bindingPath);
const bindings = JSON.parse(bindingBytes.toString('utf8'));
const expected = [
  {pr_number: 342, origin_exact_sha: '3cf057c4b28d3c7f225823ede198ac9845e050e0', base_sha: 'd39486601d851e31256852a24e9c1393b9046fe5', tree_sha: '31914fc0473fc339a71f6b06c5a5ca745f74aa1f'},
  {pr_number: 377, origin_exact_sha: 'b09aff5143d9c66ad6ab8cdbc9c141d982771b61', base_sha: '06da5fa224b65b9346e8b250dcea686d0ed458ee', tree_sha: '06a7e7ad56dbe82a3c29d8543c1ae51d55ff0c1f'}
];
if (bindings.source_candidates?.length !== expected.length) failWithCode('SOURCE_CANDIDATE_BINDING_COUNT_MISMATCH');
for (let index = 0; index < expected.length; index++) {
  const record = bindings.source_candidates[index];
  const target = expected[index];
  assertSourceBindingIdentity(record, target);
  assertVerifierClassification(record);
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
if (policy.payload.coordination?.r2_03_candidate_rebuild?.new_owner_generation !== checkpoint.owner.owner_generation ||
    policy.payload.coordination?.r2_03_candidate_rebuild?.new_owner_lease_until !== checkpoint.owner.lease_until ||
    mission.payload.coordination?.r2_03_candidate_rebuild?.new_owner_generation !== checkpoint.owner.owner_generation ||
    mission.payload.coordination?.r2_03_candidate_rebuild?.new_owner_lease_until !== checkpoint.owner.lease_until) {
  failWithCode('CP201_OWNER_LEASE_MISSION_POLICY_MISMATCH');
}

const blockerPacket = read('governance/csg/v51/readbacks/R2-03-BLOCKER-RECONCILIATION-20261001.json');
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
const postAudit = read('governance/csg/v51/readbacks/R2-03-POST-AUDIT-CP200-READBACK-20261001.json');
if (factoryRoute?.classification !== 'CURRENT' || factoryRoute.status !== 'UNAVAILABLE' ||
    postAudit.live_observation?.fixed_factory_mcp_route_inventory?.route_available !== false) {
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
    providerRoute.current_runtime_manifest_ref?.digest !== 'sha256:34175d81c54f36fdf7343cf1431a257c9924a4cebd82d01fd0aac16c5dd5e94b' ||
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
  if (sha256(bytes) !== component.digest) failWithCode('LIVE_INSTALL_PACKAGE_COMPONENT_DIGEST_MISMATCH');
}
if (acceptance.status !== 'NOT_ACCEPTED' || acceptance.criteria.some((criterion) => criterion.status !== 'NOT_ACCEPTED')) {
  failWithCode('LIVE_ACCEPTANCE_MUST_NOT_BE_MARKED_PASS');
}

const candidateManifest = read('governance/csg/v51/readbacks/R2-03-CP201-PROMOTION-CANDIDATE-MANIFEST-20261001.json');
assertNormalizedGitOid(candidateManifest.base_commit);
if (candidateManifest.base_commit !== 'd39486601d851e31256852a24e9c1393b9046fe5' ||
    candidateManifest.expected_parent_count !== 1 || candidateManifest.owner_generation !== checkpoint.owner.owner_generation ||
    candidateManifest.candidate_branch !== allocation.candidate.candidate_branch ||
    candidateManifest.recorded_at !== checkpoint.recorded_at || candidateManifest.lease_until !== checkpoint.owner.lease_until ||
    candidateManifest.allocation?.classification !== allocation.classification ||
    candidateManifest.allocation?.allocated_generation !== allocation.candidate.owner_generation ||
    candidateManifest.allocation?.record_path !== allocationPath) {
  failWithCode('CP201_CANDIDATE_MANIFEST_MISMATCH');
}
if (pointer.checkpoint_digest !== checkpoint.payload_digest) failWithCode('CP201_POINTER_DIGEST_MISMATCH');
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
  failWithCode('OWNER_GENERATION_ALLOCATION_NOT_REFERENCED_BY_CP201');
}
for (const regressionPath of [
  'governance/csg/v51/regressions/NEW_OWNER_GENERATION_MUST_EXCEED_CANONICAL_AND_AVOID_DURABLE_COLLISION-v1.json',
  'governance/csg/v51/regressions/GIT_OID_EVIDENCE_MUST_BE_CANONICAL_LOWERCASE_40_HEX-v1.json'
]) {
  if (!checkpoint.evidence_refs.some((item) => item.kind === 'BUNDLE_OBJECT' && item.path === regressionPath)) {
    failWithCode('DETERMINISTIC_ALLOCATION_OR_OID_REGRESSION_NOT_REFERENCED_BY_CP201');
  }
}
console.log(JSON.stringify({
  regression: 'ACTIVE_OWNER_LEASE_MUST_BE_VALID_AT_CHECKPOINT_RECORDED_AT',
  checkpoint_seq: checkpoint.checkpoint_seq,
  owner_generation: checkpoint.owner.owner_generation,
  recorded_at: checkpoint.recorded_at,
  lease_until: checkpoint.owner.lease_until,
  generation_allocation: allocation.classification,
  generation_regression: generationRegression.regression_id,
  exact_source_candidates: expected.map((item) => ({pr_number: item.pr_number, head: item.origin_exact_sha, tree: item.tree_sha})),
  blocker_reconciliation: 'CURRENT_SOURCE_AND_LIVE_BLOCKERS_SPLIT; REVIEW_LANES_PARKED; GLOBAL_BLOCKED_FALSE',
  live_install_readback_plan: 'PREPARED_NOT_INSTALLABLE',
  live_trust_provisioning: 'NOT_ACCEPTED',
  live_provider_session_route: 'NOT_ACCEPTED',
  live_supervisor_heartbeat_route: 'NOT_ACCEPTED',
  live_signed_evidence_path: 'NOT_ACCEPTED',
  result: 'PASS'
}));
