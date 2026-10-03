export const UNIT_STATES = Object.freeze([
  'READY',
  'RUNNING',
  'WAITING_EXTERNAL',
  'WAITING_HUMAN',
  'WAITING_REVIEW',
  'DONE',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalize(units) {
  if (!Array.isArray(units)) fail('UNITS_MUST_BE_ARRAY');
  const ids = new Set();
  return units.map((unit) => {
    if (!unit || typeof unit.id !== 'string' || unit.id.length === 0 || !UNIT_STATES.includes(unit.state)) {
      fail('INVALID_UNIT');
    }
    if (ids.has(unit.id)) fail('DUPLICATE_UNIT_ID');
    ids.add(unit.id);
    const priority = unit.priority === undefined ? Number.MAX_SAFE_INTEGER : Number(unit.priority);
    if (!Number.isFinite(priority)) fail('INVALID_UNIT_PRIORITY');
    if (unit.mutable_scope !== undefined &&
        (typeof unit.mutable_scope !== 'string' || unit.mutable_scope.length === 0 ||
         unit.mutable_scope.trim() !== unit.mutable_scope)) fail('INVALID_MUTABLE_SCOPE');
    if (unit.integration_lane !== undefined && typeof unit.integration_lane !== 'boolean') {
      fail('INVALID_INTEGRATION_LANE');
    }
    return {...unit, priority};
  });
}

function order(units) {
  return [...units].sort((left, right) =>
    left.priority - right.priority || left.id.localeCompare(right.id, 'en'));
}

function safeToRetry(unit) {
  return unit.state === 'FAILED_RETRYABLE' &&
    unit.retry_allowed === true &&
    Number.isSafeInteger(unit.retry_budget_remaining) && unit.retry_budget_remaining > 0 &&
    unit.effect_status !== 'UNKNOWN' &&
    unit.effect_status !== 'PARTIAL_OR_AMBIGUOUS';
}

function effectIdentity(effect) {
  if (typeof effect === 'string' && effect.length > 0) return effect;
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return null;
  for (const key of ['effect_ref', 'operation_ref', 'effect_id', 'operation_id', 'id', 'ref']) {
    if (typeof effect[key] === 'string' && effect[key].length > 0) return effect[key];
  }
  return null;
}

export function selectNextUnit(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_SCHEDULER_OPTIONS');
  const maxConcurrency = options.max_concurrency === undefined ? 1 : options.max_concurrency;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 4) {
    fail('INVALID_MAX_CONCURRENCY');
  }
  const units = normalize(input);
  const active = units.filter((unit) =>
    unit.state === 'RUNNING' && unit.owner_authority === 'VALID');
  const activeScopes = active.map((unit) => unit.mutable_scope || 'PROJECT_WIDE');
  const scopeCounts = new Map();
  for (const scope of activeScopes) scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
  const duplicateScopes = [...scopeCounts.entries()].filter(([, count]) => count > 1).map(([scope]) => scope).sort();
  const activeIntegrationCount = active.filter((unit) => unit.integration_lane === true).length;
  if (duplicateScopes.length > 0 || activeIntegrationCount > 1 || active.length > maxConcurrency) {
    return {
      decision: 'INVARIANT_VIOLATION',
      reason: duplicateScopes.length > 0
        ? 'MULTIPLE_VALID_OWNERS_FOR_MUTABLE_SCOPE'
        : activeIntegrationCount > 1
          ? 'MULTIPLE_VALID_PROJECT_INTEGRATION_OWNERS'
          : 'ACTIVE_OWNER_COUNT_EXCEEDS_CONCURRENCY_CAPACITY',
      units: active.map((unit) => unit.id).sort()
    };
  }

  const activeScopeSet = new Set(activeScopes);
  const activeProjectWide = activeScopeSet.has('PROJECT_WIDE');
  const activeIntegration = activeIntegrationCount === 1;
  const scopeAvailable = (unit) => {
    if (active.length === 0) return true;
    const scope = unit.mutable_scope || 'PROJECT_WIDE';
    if (activeProjectWide || scope === 'PROJECT_WIDE' || activeScopeSet.has(scope)) return false;
    if (activeIntegration && unit.integration_lane === true) return false;
    return true;
  };
  const hasConcurrencySlot = active.length < maxConcurrency;
  const ready = order(units.filter((unit) => unit.state === 'READY' && hasConcurrencySlot && scopeAvailable(unit)));
  if (ready.length > 0) return active.length > 0
    ? {decision: 'CONTINUE_READY', unit: ready[0].id, running_units: active.map((unit) => unit.id).sort()}
    : {decision: 'CONTINUE_READY', unit: ready[0].id};

  const retryable = order(units.filter((unit) => safeToRetry(unit) && hasConcurrencySlot && scopeAvailable(unit)));
  if (retryable.length > 0) return active.length > 0
    ? {decision: 'RETRY_BOUNDED', unit: retryable[0].id, running_units: active.map((unit) => unit.id).sort()}
    : {decision: 'RETRY_BOUNDED', unit: retryable[0].id};

  if (active.length > 0) return {decision: 'KEEP_RUNNING', units: active.map((unit) => unit.id).sort(),
    concurrency_limit: maxConcurrency};

  const invalidOwner = units.filter((unit) =>
    unit.state === 'RUNNING' && unit.owner_authority !== 'VALID');
  const parked = units.filter((unit) =>
    ['WAITING_EXTERNAL', 'WAITING_HUMAN', 'WAITING_REVIEW'].includes(unit.state));
  const unresolved = [...invalidOwner, ...parked]
    .map((unit) => ({unit: unit.id, state: unit.state,
      reason: unit.reason || (invalidOwner.includes(unit) ? 'OWNER_AUTHORITY_NOT_VALID' : null)}))
    .sort((left, right) => left.unit.localeCompare(right.unit, 'en'));
  const incomplete = units.filter((unit) => unit.state !== 'DONE');

  if (incomplete.length === 0) return {decision: 'ALL_UNITS_DONE'};
  if (unresolved.length > 0) {
    return {
      decision: 'WAITING_EXTERNAL_NO_READY',
      unresolved,
      queue_scope: 'SUPPLIED_SUBSET',
      global_exhaustion: 'NOT_EVALUATED',
      mission_lifecycle_unchanged: true,
      terminate_mission: false
    };
  }
  if (units.every((unit) => unit.state === 'FAILED_TERMINAL' || unit.state === 'DONE')) {
    return {
      decision: 'SUBSET_TERMINAL_NO_READY',
      units: units.filter((unit) => unit.state === 'FAILED_TERMINAL').map((unit) => unit.id).sort(),
      queue_scope: 'SUPPLIED_SUBSET',
      global_exhaustion: 'NOT_EVALUATED',
      mission_lifecycle_unchanged: true,
      terminate_mission: false
    };
  }
  return {
    decision: 'NO_LEGAL_ACTION',
    units: incomplete.map((unit) => unit.id).sort(),
    mission_lifecycle_unchanged: true,
    terminate_mission: false
  };
}

export function mayDispatch(unit, authority) {
  if (!unit || (unit.state !== 'READY' && !safeToRetry(unit))) {
    return {allowed: false, reason: 'UNIT_NOT_READY_OR_BOUNDED_RETRY_NOT_AUTHORIZED'};
  }
  if (authority?.stop_requested === true) return {allowed: false, reason: 'STOP_REQUESTED'};
  if (authority?.canonical_state_fresh !== true) return {allowed: false, reason: 'CANONICAL_READ_REQUIRED'};
  if (authority?.mission_lifecycle !== 'ACTIVE') return {allowed: false, reason: 'MISSION_NOT_ACTIVE'};
  if (unit.requires_effect_readback === true) {
    const unresolvedRefs = authority?.unresolved_effect_refs;
    const relatedEffects = unit.related_effect_refs;
    if (!Array.isArray(unresolvedRefs) || !Array.isArray(relatedEffects) || relatedEffects.length === 0) {
      return {allowed: false, reason: 'UNKNOWN_EFFECT_READBACK_REQUIRED'};
    }
    const unresolved = unresolvedRefs.map(effectIdentity);
    const related = relatedEffects.map(effectIdentity);
    if (unresolved.includes(null) || related.includes(null) ||
        related.some((effect) => unresolved.includes(effect))) {
      return {allowed: false, reason: 'UNKNOWN_EFFECT_READBACK_REQUIRED'};
    }
  }
  if (unit.requires_host_mutation === true && authority?.host_mutation_authorized !== true) {
    return {allowed: false, reason: 'HOST_MUTATION_NOT_AUTHORIZED'};
  }
  if (unit.requires_execution_owner === true && authority?.execution_owner_authority !== 'VALID') {
    return {allowed: false, reason: 'EXECUTION_OWNER_AUTHORITY_NOT_VALID'};
  }
  if (unit.worker_provider_write_capability === true || unit.provider_write_capability === true) {
    return {allowed: false, reason: 'WORKER_PROVIDER_WRITE_CAPABILITY_FORBIDDEN'};
  }
  if (unit.production === true) return {allowed: false, reason: 'PRODUCTION_HUMAN_GATE'};
  if (unit.requires_human_gate === true && authority?.human_gate_passed !== true) {
    return {allowed: false, reason: 'HUMAN_GATE_REQUIRED'};
  }
  if (!['LOCAL_PREPRODUCTION_SOURCE', 'READ_ONLY_RECONCILIATION'].includes(unit.execution_scope)) {
    return {allowed: false, reason: 'EXECUTION_SCOPE_NOT_QUALIFIED'};
  }
  const allowedEffects = new Set(['LOCAL_SOURCE_WRITE', 'LOCAL_TEST', 'LOCAL_EVIDENCE_APPEND']);
  if (!(unit.effects || []).every((effect) => allowedEffects.has(effect))) {
    return {allowed: false, reason: 'EFFECT_NOT_ALLOWED_FOR_LOCAL_SUPERVISOR'};
  }
  return {allowed: true, reason: 'READY_AND_AUTHORIZED'};
}
