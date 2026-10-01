import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recomputeGoalLifecycle } from '../../scripts/csg-v51-goal-lifecycle.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const repositoryId = '1352411536';

async function readRepositoryJson(relativePath) {
  return JSON.parse((await readRepositoryBytes(relativePath)).toString('utf8'));
}

async function readRepositoryBytes(relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (!absolutePath.startsWith(repositoryRoot + sep)) throw new Error('CANONICAL_PATH_ESCAPES_REPOSITORY');
  return readFile(absolutePath);
}

function readGitJson(revision, relativePath) {
  if (/^blob:[a-f0-9]{40}$/.test(revision)) {
    return JSON.parse(readGitBlobBytes(revision.slice('blob:'.length)).toString('utf8'));
  }
  if (!/^[a-f0-9]{40}$/.test(revision) || !relativePath.startsWith('governance/') || relativePath.includes('\\') || relativePath.split('/').includes('..')) {
    throw new Error('CANONICAL_GIT_REFERENCE_INVALID');
  }
  const raw = execFileSync('git', ['show', revision + ':' + relativePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

function readGitBlobBytes(blobOid) {
  if (!/^[a-f0-9]{40}$/.test(blobOid)) throw new Error('CANONICAL_GIT_BLOB_REFERENCE_INVALID');
  return execFileSync('git', ['cat-file', 'blob', blobOid], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function canonicalReferencePath(reference) {
  const match = new RegExp('^github://' + repositoryId + '/(.+)@(blob:)?([a-f0-9]{40})$').exec(reference);
  if (!match) throw new Error('CANONICAL_REFERENCE_INVALID');
  const path = match[1];
  if (!path.startsWith('governance/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error('CANONICAL_REFERENCE_PATH_INVALID');
  }
  return { path, revision: match[3], kind: match[2] ? 'blob' : 'commit' };
}

async function readCanonicalReference(reference) {
  const parsed = canonicalReferencePath(reference);
  if (parsed.kind === 'commit') return readGitJson(parsed.revision, parsed.path);
  // The final one-commit head cannot safely contain a reference to itself. Pin
  // Mission/Policy by immutable blob OID and bind that head through PR readback.
  const absolutePath = resolve(repositoryRoot, parsed.path);
  if (!absolutePath.startsWith(repositoryRoot + sep)) throw new Error('CANONICAL_BLOB_PATH_ESCAPES_REPOSITORY');
  const bytes = gitCleanBytes(await readFile(absolutePath));
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  const actualBlob = createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
  if (actualBlob !== parsed.revision) throw new Error('CANONICAL_BLOB_REFERENCE_MISMATCH');
  return JSON.parse(bytes.toString('utf8'));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function payloadSha256(value) {
  return `sha256:${createHash('sha256').update(Buffer.from(canonicalJson(value), 'utf8')).digest('hex')}`;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function gitCleanBytes(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function gitBlobOid(bytes) {
  const cleanBytes = gitCleanBytes(bytes);
  const header = Buffer.from(`blob ${cleanBytes.length}\0`, 'utf8');
  return createHash('sha1').update(Buffer.concat([header, cleanBytes])).digest('hex');
}

function findTaskRecord(value, taskId) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value) && value.task_id === taskId) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findTaskRecord(child, taskId);
    if (found) return found;
  }
  return null;
}

test('LOCAL_CODEX_GOAL_DISAPPEARS_WHILE_MISSION_ACTIVE', async () => {
  // CP201 is an inert candidate, not canonical. A vanished local Goal must recover
  // from the currently selected CP200 authority, not from candidate Mission/Policy/Run.
  const proposedCheckpoint = await readRepositoryJson('governance/csg/checkpoints/000201.json');
  assert.equal(proposedCheckpoint.checkpoint_seq, 201);
  const canonicalCommit = proposedCheckpoint.previous_checkpoint_ref.revision;
  assert.equal(proposedCheckpoint.previous_checkpoint_ref.path, 'governance/csg/checkpoints/000200.json');
  assert.equal(proposedCheckpoint.payload_digest, payloadSha256(Object.fromEntries(
    Object.entries(proposedCheckpoint).filter(([key]) => key !== 'payload_digest'),
  )));
  const proposedPointer = await readRepositoryJson('governance/csg/current.json');
  assert.equal(proposedPointer.checkpoint_seq, 200);
  assert.equal(proposedPointer.checkpoint_path, 'governance/csg/checkpoints/000200.json');
  assert.equal(proposedPointer.checkpoint_digest, proposedCheckpoint.previous_checkpoint_ref.digest);
  const sourceCorrectionRef = proposedCheckpoint.evidence_refs.find((reference) =>
    reference.kind === 'BUNDLE_OBJECT' &&
    reference.path === 'governance/csg/v51/readbacks/R2-03-LOCAL-SOURCE-PRODUCER-CIM-DATETIME-20260930.json');
  assert.ok(sourceCorrectionRef);
  assert.deepEqual(Object.keys(sourceCorrectionRef).sort(), ['digest', 'kind', 'path']);
  const sourceCorrectionBytes = gitCleanBytes(await readRepositoryBytes(sourceCorrectionRef.path));
  assert.equal(sourceCorrectionRef.digest, sha256Bytes(sourceCorrectionBytes));
  const sourceCorrection = JSON.parse(sourceCorrectionBytes.toString('utf8'));
  assert.equal(sourceCorrection.status, 'LOCAL_SOURCE_FIX_TESTED_PROVIDER_AND_INSTALL_ACCEPTANCE_PENDING');
  assert.equal(sourceCorrection.canonical_provider_state.checkpoint_seq, 200);
  assert.equal(sourceCorrection.canonical_provider_state.owner_liveness, 'STALE_EXECUTION_OWNER_CANDIDATE');
  assert.equal(sourceCorrection.canonical_provider_state.stale_owner_confirmed, false);
  assert.equal(sourceCorrection.candidate_state.canonical, false);
  assert.equal(sourceCorrection.candidate_state.active_unit, 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION');
  assert.equal(sourceCorrection.local_cim_observation.candidates_observed, 8);
  assert.equal(sourceCorrection.local_cim_observation.timestamps_converted_to_utc, 8);
  assert.equal(sourceCorrection.local_cim_observation.identity_link_status, 'UNRESOLVED');
  assert.equal(sourceCorrection.local_cim_observation.supervisor_task_enabled, false);
  assert.equal(sourceCorrection.local_cim_observation.provider_agent_session_route, 'NOT_CONFIGURED');
  assert.equal(sourceCorrection.local_cim_observation.supervisor_heartbeat_route, 'NOT_CONFIGURED');
  assert.equal(sourceCorrection.producer_function_observation.state, 'UNKNOWN');
  assert.equal(sourceCorrection.producer_function_observation.record_count, 8);
  assert.equal(sourceCorrection.producer_function_observation.valid_utc_start_times, 8);
  assert.equal(sourceCorrection.producer_function_observation.identity_link_status, 'UNRESOLVED');
  for (const role of ['publisher', 'publisher_test', 'goal_regression']) {
    const recordedSource = sourceCorrection.source_files.find((source) => source.role === role);
    assert.ok(recordedSource);
    // This readback records the immutable source bytes observed at correction time.
    // Later integration work may change the same path, so validate the recorded Git
    // blob directly instead of conflating historical evidence with the new candidate.
    const recordedBytes = gitCleanBytes(readGitBlobBytes(recordedSource.git_blob_oid));
    assert.equal(recordedSource.sha256, sha256Bytes(recordedBytes));
    assert.equal(recordedSource.git_blob_oid, gitBlobOid(recordedBytes));
  }
  const canonicalPointer = readGitJson(canonicalCommit, 'governance/csg/current.json');
  const canonicalCheckpoint = readGitJson(canonicalCommit, canonicalPointer.checkpoint_path);
  const canonicalMission = await readCanonicalReference(canonicalCheckpoint.mission_anchor.ref);
  const canonicalPolicy = await readCanonicalReference(canonicalCheckpoint.policy_anchor.ref);
  const canonicalRun = readGitJson(canonicalCheckpoint.run_ref.revision, canonicalCheckpoint.run_ref.path);
  const missionRef = canonicalReferencePath(proposedCheckpoint.mission_anchor.ref);
  const policyRef = canonicalReferencePath(proposedCheckpoint.policy_anchor.ref);
  const mission = await readCanonicalReference(proposedCheckpoint.mission_anchor.ref);
  const policy = await readCanonicalReference(proposedCheckpoint.policy_anchor.ref);
  const run = readGitJson(proposedCheckpoint.run_ref.revision, proposedCheckpoint.run_ref.path);
  const executor = { localGoalStatus: 'DISAPPEARED' };

  assert.equal(canonicalPointer.checkpoint_seq, 200);
  assert.equal(canonicalPointer.checkpoint_digest, canonicalCheckpoint.payload_digest);
  assert.equal(canonicalCheckpoint.checkpoint_seq, 200);
  assert.equal(canonicalCheckpoint.lifecycle, 'ACTIVE');
  assert.equal(canonicalCheckpoint.mission_anchor.revision, canonicalMission.mission_revision_id);
  assert.equal(canonicalCheckpoint.policy_anchor.revision, canonicalPolicy.policy_revision_id);
  assert.equal(canonicalPolicy.mission_revision_id, canonicalMission.mission_revision_id);
  assert.equal(canonicalMission.payload.active_unit, canonicalCheckpoint.task_id);
  assert.equal(canonicalPolicy.payload.active_unit, canonicalCheckpoint.task_id);
  assert.equal(canonicalRun.active_task_id, canonicalCheckpoint.task_id);
  assert.equal(canonicalCheckpoint.task_id, 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION');

  assert.equal(proposedCheckpoint.lifecycle, 'ACTIVE');
  assert.equal(proposedCheckpoint.mission_anchor.revision, mission.mission_revision_id);
  assert.equal(proposedCheckpoint.policy_anchor.revision, policy.policy_revision_id);
  assert.equal(policy.mission_revision_id, mission.mission_revision_id);
  assert.equal(mission.mission_hash, payloadSha256(mission.payload));
  assert.equal(policy.policy_hash, payloadSha256(policy.payload));
  assert.equal(policy.mission_hash, mission.mission_hash);
  assert.equal(proposedCheckpoint.mission_anchor.declared_hash, mission.mission_hash);
  assert.equal(proposedCheckpoint.policy_anchor.declared_hash, policy.policy_hash);
  assert.equal(missionRef.kind, 'blob');
  assert.equal(policyRef.kind, 'blob');
  const missionR203 = findTaskRecord(mission.payload, 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION');
  const policyR203 = findTaskRecord(policy.payload, 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION');
  assert.ok(missionR203);
  assert.ok(policyR203);
  assert.equal(missionR203.source_candidate_head, null);
  assert.equal(policyR203.source_candidate_head, null);
  for (const binding of [
    missionR203.source_candidate_head_binding,
    policyR203.source_candidate_head_binding,
  ]) {
    assert.equal(binding.method, 'GITHUB_PULL_REQUEST_PROVIDER_READBACK');
    assert.equal(binding.pull_request_number, 342);
    assert.equal(binding.head_branch, 'codex/v51-r1-03-readonly-bootstrap-20260929');
    assert.equal(binding.target_branch, 'v45/factory-control');
    assert.equal(binding.target_base_commit, proposedCheckpoint.previous_checkpoint_ref.revision);
    assert.equal(binding.exact_final_head, 'b26d400af6c232ad7fcf253c48f9066cbddc2d12');
    assert.equal(binding.exact_final_head_readback_required, true);
  }
  assert.equal(mission.payload.active_unit, proposedCheckpoint.task_id);
  assert.equal(policy.payload.active_unit, proposedCheckpoint.task_id);
  assert.equal(run.active_task_id, proposedCheckpoint.task_id);
  assert.equal(run.attempt_id, proposedCheckpoint.attempt_id);
  assert.equal(proposedCheckpoint.task_id, 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION');

  const canonicalCompletedUnit = canonicalCheckpoint.last_accepted?.unit_id;
  assert.equal(canonicalCompletedUnit, 'V51-R2-01-COLD-START-CANONICAL-CONTINUITY');
  assert.equal(proposedCheckpoint.last_accepted?.unit_id, canonicalCompletedUnit);
  assert.equal(canonicalRun.active_task_id, canonicalCheckpoint.task_id);
  assert.equal(canonicalRun.attempt_id, canonicalCheckpoint.attempt_id);
  assert.equal(canonicalRun.attempt_epoch, canonicalCheckpoint.attempt_epoch);
  assert.equal(canonicalCheckpoint.next_legal_transition.unit_id, canonicalCheckpoint.task_id);
  const completedUnits = [canonicalCompletedUnit];
  const parkedLanes = canonicalRun.liveness_reconciliation.parked_lanes.map((laneId) => ({
    lane_id: laneId,
    status: 'PARKED',
  }));
  const readyLanes = [{
    unit_id: canonicalCheckpoint.next_legal_transition.unit_id,
    status: 'READY',
    priority: 0,
  }];
  const result = recomputeGoalLifecycle({
    missionStatus: canonicalCheckpoint.lifecycle,
    completedUnits,
    parkedLanes,
    readyLanes,
    identicalBlockerCount: 3,
    allLegalReadyLanesExhausted: false,
    genuineExternalOrHumanPrerequisite: false,
  });
  executor.recoveredCheckpointSeq = canonicalCheckpoint.checkpoint_seq;
  executor.recoveredUnit = result.nextUnit;
  executor.recoveredAttemptId = canonicalCheckpoint.attempt_id;

  assert.equal(executor.localGoalStatus, 'DISAPPEARED');
  assert.equal(canonicalCheckpoint.lifecycle, 'ACTIVE');
  assert.equal(result.goalStatus, 'ACTIVE');
  assert.equal(result.globalBlocked, false);
  assert.equal(executor.recoveredCheckpointSeq, 200);
  assert.equal(executor.recoveredUnit, canonicalCheckpoint.task_id);
  assert.equal(executor.recoveredAttemptId, canonicalCheckpoint.attempt_id);
  assert.equal(result.nextUnit, 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION');
  assert.notEqual(result.nextUnit, proposedCheckpoint.task_id);
  assert.equal(sourceCorrection.candidate_state.canonical, false);
  assert.equal(completedUnits.includes(result.nextUnit), false);
  assert.ok(parkedLanes.length > 0);

});
