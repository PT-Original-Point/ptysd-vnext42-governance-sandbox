import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recomputeGoalLifecycle, logicalWorkFingerprintBasis, loopCountersMayReset} from '../../scripts/csg-v51-goal-lifecycle.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const canonicalBase = 'd39486601d851e31256852a24e9c1393b9046fe5';
const repositoryId = '1352411536';
const regressionPath = 'governance/csg/v51/regressions/LOCAL_CODEX_GOAL_DISAPPEARS_WHILE_MISSION_ACTIVE-v1.json';

function gitText(args) {
  return execFileSync('git', args, {cwd: repositoryRoot, encoding: 'utf8'}).trim();
}

function readGitJson(revision, relativePath) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.ok(relativePath.startsWith('governance/'));
  assert.ok(!relativePath.includes('\\'));
  assert.ok(!relativePath.split('/').includes('..'));
  return JSON.parse(gitText(['show', `${revision}:${relativePath}`]));
}

function readGitReference(reference) {
  const match = new RegExp(`^github://${repositoryId}/(.+)@([a-f0-9]{40})$`).exec(reference);
  assert.ok(match, 'canonical reference must resolve to an immutable Git commit');
  return readGitJson(match[2], match[1]);
}

function selectedCanonicalBase() {
  const head = gitText(['rev-parse', 'HEAD']);
  if (head === canonicalBase) return head;
  const parent = gitText(['rev-parse', 'HEAD^']);
  assert.equal(parent, canonicalBase, 'candidate must remain a one-commit child of exact CP200');
  return parent;
}

test('LOCAL_CODEX_GOAL_DISAPPEARS_WHILE_MISSION_ACTIVE', async () => {
  const scenario = JSON.parse(await readFile(resolve(repositoryRoot, regressionPath), 'utf8'));
  assert.equal(scenario.regression_id, 'LOCAL_CODEX_GOAL_DISAPPEARS_WHILE_MISSION_ACTIVE');
  assert.equal(scenario.status, 'LOCAL_DETERMINISTIC_REGRESSION_ONLY_R2_09_NOT_ACCEPTED');
  assert.deepEqual(scenario.expected, {
    canonical_mission_remains_active: true,
    new_executor_recovers_current_unit: true,
    completed_work_is_not_repeated: true,
    next_ready_work_continues_without_human_reinjection: true,
    noncanonical_candidate_is_not_selected: true,
    global_goal_is_not_blocked_while_a_ready_lane_exists: true,
  });

  const base = selectedCanonicalBase();
  assert.equal(base, canonicalBase);
  const pointer = readGitJson(base, 'governance/csg/current.json');
  const checkpoint = readGitJson(base, pointer.checkpoint_path);
  const mission = readGitReference(checkpoint.mission_anchor.ref);
  const policy = readGitReference(checkpoint.policy_anchor.ref);
  const run = readGitJson(checkpoint.run_ref.revision, checkpoint.run_ref.path);
  const candidatePointer = JSON.parse(await readFile(resolve(repositoryRoot, 'governance/csg/current.json'), 'utf8'));
  const candidateCheckpoint = JSON.parse(await readFile(resolve(repositoryRoot, 'governance/csg/checkpoints/000201.json'), 'utf8'));

  assert.equal(pointer.checkpoint_seq, 200);
  assert.equal(checkpoint.checkpoint_seq, 200);
  assert.equal(checkpoint.lifecycle, 'ACTIVE');
  assert.equal(checkpoint.atomic.state, 'PREPARED_NOT_DISPATCHED');
  assert.equal(checkpoint.owner.owner_generation, 5);
  assert.equal(checkpoint.task_id, 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION');
  assert.equal(checkpoint.attempt_id, 'V51-R2-02-ATTEMPT-002');
  assert.equal(checkpoint.mission_anchor.revision, mission.mission_revision_id);
  assert.equal(checkpoint.policy_anchor.revision, policy.policy_revision_id);
  assert.equal(policy.mission_revision_id, mission.mission_revision_id);
  assert.equal(policy.mission_hash, mission.mission_hash);
  assert.equal(checkpoint.next_legal_transition.action,
    'CONTINUE_R2_02_NONPRIVILEGED_SOURCE_RECONCILIATION_WHILE_LIVE_OBSERVATION_LANE_IS_PARKED');
  assert.equal(checkpoint.next_legal_transition.unit_id, checkpoint.task_id);
  assert.equal(mission.payload.goal_lifecycle.canonical_mission_status, 'ACTIVE');
  assert.equal(mission.payload.goal_lifecycle.recovery_without_human_reinjection, true);
  assert.equal(mission.payload.r2_09_acceptance.status, 'REQUIRED_NOT_YET_ACCEPTED');
  assert.equal(mission.payload.r2_09_acceptance.regression_id, scenario.regression_id);
  assert.equal(policy.payload.coordination.goal_lifecycle.canonical_mission_status, 'ACTIVE');
  assert.equal(policy.payload.coordination.goal_lifecycle.recover_without_human_reinjection, true);
  assert.equal(policy.payload.coordination.r2_09_acceptance.status, 'REQUIRED_NOT_YET_ACCEPTED');
  assert.equal(policy.payload.coordination.r2_09_acceptance.regression_id, scenario.regression_id);
  assert.equal(run.state, 'RUNNING');
  assert.equal(run.run_id, 'V51-R2-001');
  assert.equal(run.active_task_id, checkpoint.task_id);
  assert.equal(run.attempt_id, checkpoint.attempt_id);
  assert.equal(run.goal_lifecycle_recovery.continue_other_ready_work, true);
  assert.equal(run.liveness_reconciliation.status, 'STALE_EXECUTION_OWNER_CANDIDATE');
  assert.equal(run.liveness_reconciliation.stale_owner_confirmed, false);

  assert.equal(candidatePointer.checkpoint_seq, 201);
  assert.equal(candidateCheckpoint.checkpoint_seq, 201);
  assert.equal(candidateCheckpoint.previous_checkpoint_ref.revision, canonicalBase);
  assert.equal(scenario.input.candidate_is_canonical, false);
  assert.equal(scenario.input.local_codex_goal_status, 'DISAPPEARED');

  const completedUnits = [checkpoint.last_accepted.unit_id];
  assert.equal(completedUnits.includes(checkpoint.task_id), false);
  const parkedLanes = (run.liveness_reconciliation.parked_lanes ?? []).map((laneId) => ({
    lane_id: laneId,
    status: 'PARKED',
  }));
  const readyLanes = [{
    unit_id: checkpoint.next_legal_transition.unit_id,
    status: 'READY',
    priority: 0,
  }];
  const result = recomputeGoalLifecycle({
    missionStatus: checkpoint.lifecycle,
    completedUnits,
    parkedLanes,
    readyLanes,
    identicalBlockerCount: scenario.input.identical_blocker_count,
    allLegalReadyLanesExhausted: false,
    genuineExternalOrHumanPrerequisite: false,
  });
  const recoveredExecutor = {
    localGoalStatus: scenario.input.local_codex_goal_status,
    recoveredCheckpointSeq: checkpoint.checkpoint_seq,
    recoveredUnit: result.nextUnit,
    recoveredAttemptId: run.attempt_id,
  };

  assert.equal(recoveredExecutor.localGoalStatus, 'DISAPPEARED');
  assert.equal(recoveredExecutor.recoveredCheckpointSeq, 200);
  assert.equal(recoveredExecutor.recoveredUnit, checkpoint.task_id);
  assert.equal(recoveredExecutor.recoveredAttemptId, 'V51-R2-02-ATTEMPT-002');
  assert.equal(result.goalStatus, 'ACTIVE');
  assert.equal(result.globalBlocked, false);
  assert.equal(result.nextUnit, 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION');
  assert.equal(completedUnits.includes(result.nextUnit), false);
  assert.ok(parkedLanes.length > 0);
});


test('logical work fingerprint excludes self-generated candidate output SHA', () => {
  const common = {
    projectId: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    specRevision: 'VNEXT5.1-R2',
    missionRevision: '20261002T105808+0800',
    activeUnit: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION',
    acceptanceContract: 'R2-03-CANDIDATE-QUALIFICATION',
    upstreamAuthorityAnchor: 'CP200:d39486601d851e31256852a24e9c1393b9046fe5',
  };
  const left = logicalWorkFingerprintBasis({...common, candidateOutputSha: 'a'.repeat(40)});
  const right = logicalWorkFingerprintBasis({...common, candidateOutputSha: 'b'.repeat(40)});
  assert.deepEqual(left, right);
  assert.equal(Object.hasOwn(left, 'candidateOutputSha'), false);
});

test('loop counters reset only on exogenous material delta', () => {
  assert.equal(loopCountersMayReset('SELF_GENERATED_HEAD_CHANGE'), false);
  assert.equal(loopCountersMayReset('REVIEWER_STATUS_CHANGE'), false);
  assert.equal(loopCountersMayReset('SESSION_ROLLOVER'), false);
  assert.equal(loopCountersMayReset('CHECKPOINT_ROLLOVER_ONLY'), false);
  assert.equal(loopCountersMayReset('HUMAN_SPEC_OR_MISSION_CHANGE'), true);
  assert.equal(loopCountersMayReset('ACCEPTANCE_CONTRACT_MATERIAL_CHANGE'), true);
  assert.equal(loopCountersMayReset('UPSTREAM_AUTHORITY_OR_INPUT_CHANGE'), true);
  assert.equal(loopCountersMayReset('CANONICAL_PRESTATE_EXTERNAL_TRANSITION'), true);
  assert.equal(loopCountersMayReset('CONCRETE_NEW_SOURCE_DEFECT'), true);
});
