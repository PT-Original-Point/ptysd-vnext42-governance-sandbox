import test from 'node:test';
import assert from 'node:assert/strict';
import { recomputeGoalLifecycle } from '../../scripts/csg-v51-goal-lifecycle.mjs';

test('LOCAL_GOAL_THREE_IDENTICAL_BLOCKERS_FALSE_GLOBAL_BLOCK', () => {
  const state = recomputeGoalLifecycle({
    missionStatus: 'ACTIVE',
    parkedLanes: [
      { lane_id: 'PR377_INDEPENDENT_SEMANTIC_REVIEW', reason: 'PENDING_REVIEW' },
      { lane_id: 'R2-02B_EXACT_GENERATION_5_LIVENESS', reason: 'WAITING_ON_R2_03' },
    ],
    readyLanes: [{ unit_id: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION', status: 'READY', priority: 1 }],
    identicalBlockerCount: 3,
    allLegalReadyLanesExhausted: false,
    genuineExternalOrHumanPrerequisite: false,
  });

  assert.equal(state.goalStatus, 'ACTIVE');
  assert.equal(state.globalBlocked, false);
  assert.equal(state.nextUnit, 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION');
});

test('canonical recovery skips completed work and selects the next READY unit', () => {
  const state = recomputeGoalLifecycle({
    missionStatus: 'ACTIVE',
    completedUnits: ['V51-R2-01-COLD-START-CANONICAL-CONTINUITY'],
    readyLanes: [
      { unit_id: 'V51-R2-01-COLD-START-CANONICAL-CONTINUITY', status: 'READY', priority: 1 },
      { unit_id: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION', status: 'READY', priority: 2 },
    ],
  });

  assert.equal(state.goalStatus, 'ACTIVE');
  assert.equal(state.nextUnit, 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION');
});

test('global BLOCKED requires exhausted READY lanes and a genuine external prerequisite', () => {
  const state = recomputeGoalLifecycle({
    missionStatus: 'ACTIVE',
    readyLanes: [],
    allLegalReadyLanesExhausted: true,
    genuineExternalOrHumanPrerequisite: true,
  });

  assert.equal(state.goalStatus, 'BLOCKED');
  assert.equal(state.globalBlocked, true);
});

test('parked lanes without exhausted READY work do not make the Mission globally BLOCKED', () => {
  const state = recomputeGoalLifecycle({
    missionStatus: 'ACTIVE',
    parkedLanes: [{ lane_id: 'PR377_INDEPENDENT_SEMANTIC_REVIEW', reason: 'PENDING_REVIEW' }],
    readyLanes: [],
    allLegalReadyLanesExhausted: false,
    genuineExternalOrHumanPrerequisite: true,
  });

  assert.equal(state.goalStatus, 'ACTIVE');
  assert.equal(state.globalBlocked, false);
});
