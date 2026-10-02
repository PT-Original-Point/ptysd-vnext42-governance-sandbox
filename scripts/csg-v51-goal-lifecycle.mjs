export function recomputeGoalLifecycle({
  missionStatus,
  readyLanes = [],
  parkedLanes = [],
  completedUnits = [],
  identicalBlockerCount = 0,
  allLegalReadyLanesExhausted = false,
  genuineExternalOrHumanPrerequisite = false,
}) {
  if (missionStatus !== 'ACTIVE') {
    return {
      goalStatus: 'MISSION_NOT_ACTIVE',
      globalBlocked: false,
      nextUnit: null,
      parkedLanes,
      repeatedBlockerCount: identicalBlockerCount,
    };
  }

  const completed = new Set(completedUnits);
  const parked = new Set(parkedLanes.map((lane) => lane?.unit_id ?? lane?.lane_id));
  const ready = readyLanes
    .filter((lane) => lane && lane.status === 'READY' &&
      !completed.has(lane.unit_id) && !parked.has(lane.unit_id))
    .sort((left, right) => (left.priority ?? Number.MAX_SAFE_INTEGER) -
      (right.priority ?? Number.MAX_SAFE_INTEGER));

  if (ready.length > 0) {
    return {
      goalStatus: 'ACTIVE',
      globalBlocked: false,
      nextUnit: ready[0].unit_id,
      parkedLanes,
      repeatedBlockerCount: identicalBlockerCount,
    };
  }

  if (allLegalReadyLanesExhausted === true && genuineExternalOrHumanPrerequisite === true) {
    return {
      goalStatus: 'BLOCKED',
      globalBlocked: true,
      nextUnit: null,
      parkedLanes,
      repeatedBlockerCount: identicalBlockerCount,
    };
  }

  return {
    goalStatus: 'ACTIVE',
    globalBlocked: false,
    nextUnit: null,
    parkedLanes,
    repeatedBlockerCount: identicalBlockerCount,
  };
}


const EXOGENOUS_LOOP_RESET_DELTA_TYPES = new Set([
  'HUMAN_SPEC_OR_MISSION_CHANGE',
  'ACCEPTANCE_CONTRACT_MATERIAL_CHANGE',
  'UPSTREAM_AUTHORITY_OR_INPUT_CHANGE',
  'CANONICAL_PRESTATE_EXTERNAL_TRANSITION',
  'CONCRETE_NEW_SOURCE_DEFECT',
]);

export function logicalWorkFingerprintBasis({
  projectId,
  specRevision,
  missionRevision,
  activeUnit,
  acceptanceContract,
  upstreamAuthorityAnchor,
}) {
  return {
    projectId,
    specRevision,
    missionRevision,
    activeUnit,
    acceptanceContract,
    upstreamAuthorityAnchor,
  };
}

export function loopCountersMayReset(deltaType) {
  return EXOGENOUS_LOOP_RESET_DELTA_TYPES.has(deltaType);
}
