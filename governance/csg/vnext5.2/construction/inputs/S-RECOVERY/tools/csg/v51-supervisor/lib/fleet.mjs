const WORKER_ORDER = Object.freeze([
  Object.freeze({id: 'opencode', tier: 'PREFERRED'}),
  Object.freeze({id: 'muse', tier: 'PREFERRED'}),
  Object.freeze({id: 'antigravity', tier: 'SECONDARY'}),
  Object.freeze({id: 'codex', tier: 'SECONDARY'})
]);
const PROVIDER_IDS = new Set(WORKER_ORDER.map((worker) => worker.id));
const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const SAFE_EFFECTS = new Set(['LOCAL_WORKTREE_WRITE', 'LOCAL_TEST', 'LOCAL_EVIDENCE_APPEND']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function record(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function text(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(code);
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function freshnessPolicy(input) {
  const policy = record(input.observation_freshness, 'FLEET_OBSERVATION_FRESHNESS_POLICY_REQUIRED');
  const evaluatedAt = timestamp(policy.evaluated_at);
  if (evaluatedAt === null) fail('FLEET_EVALUATION_TIME_INVALID');
  if (!Number.isSafeInteger(policy.max_age_seconds) || policy.max_age_seconds <= 0) {
    fail('FLEET_OBSERVATION_MAX_AGE_INVALID');
  }
  return {evaluatedAt, maxAgeMs: policy.max_age_seconds * 1000};
}

function providerIndex(providers) {
  if (!Array.isArray(providers)) fail('FLEET_PROVIDER_OBSERVATIONS_REQUIRED');
  const result = new Map();
  for (const provider of providers) {
    record(provider, 'FLEET_PROVIDER_OBSERVATION_INVALID');
    if (!PROVIDER_IDS.has(provider.id) || result.has(provider.id)) fail('FLEET_PROVIDER_ID_INVALID_OR_DUPLICATE');
    result.set(provider.id, provider);
  }
  return result;
}

function providerFailure(worker, provider, role, freshness) {
  if (!provider) return `${worker.id.toUpperCase()}_NOT_OBSERVED`;
  const observedAt = timestamp(provider.observed_at);
  if (observedAt === null) return `${worker.id.toUpperCase()}_OBSERVATION_TIME_INVALID`;
  const ageMs = freshness.evaluatedAt - observedAt;
  if (ageMs < 0) return `${worker.id.toUpperCase()}_OBSERVATION_FROM_FUTURE`;
  if (ageMs > freshness.maxAgeMs) return `${worker.id.toUpperCase()}_OBSERVATION_STALE`;
  if (provider.runtime_available !== true) return `${worker.id.toUpperCase()}_RUNTIME_UNAVAILABLE`;
  if (provider.health !== 'HEALTHY') return `${worker.id.toUpperCase()}_${String(provider.health || 'HEALTH_UNKNOWN')}`;
  if (provider.authenticated !== true) return `${worker.id.toUpperCase()}_AUTHENTICATION_UNAVAILABLE`;
  if (provider.eligible !== true || !Array.isArray(provider.eligible_roles) ||
      !provider.eligible_roles.includes(role)) return `${worker.id.toUpperCase()}_ROLE_NOT_ELIGIBLE`;
  if (provider.sandbox_eligible !== true || !Array.isArray(provider.execution_cells) ||
      !provider.execution_cells.includes(worker.requestedCell)) return `${worker.id.toUpperCase()}_SANDBOX_NOT_ELIGIBLE`;
  if (!Array.isArray(provider.capabilities) ||
      worker.requiredCapabilities.some((capability) => !provider.capabilities.includes(capability))) {
    return `${worker.id.toUpperCase()}_CAPABILITY_NOT_AVAILABLE`;
  }
  if (!Number.isFinite(provider.measured_success_rate) || provider.measured_success_rate < 0 ||
      provider.measured_success_rate > 1) return `${worker.id.toUpperCase()}_SUCCESS_RATE_UNAVAILABLE`;
  if (worker.tier === 'SECONDARY' && provider.qualified !== true) {
    return `${worker.id.toUpperCase()}_SECONDARY_ROUTE_NOT_QUALIFIED`;
  }
  if (provider.quota !== 'AVAILABLE') return `${worker.id.toUpperCase()}_${String(provider.quota || 'QUOTA_UNKNOWN')}`;
  return null;
}

export function selectFleetWorker(input) {
  record(input, 'FLEET_SELECTION_INPUT_REQUIRED');
  if (input.project_id !== PROJECT_ID) fail('FLEET_PROJECT_ID_MISMATCH');
  const role = text(input.role, 'FLEET_ROLE_REQUIRED');
  if (!['BUILDER', 'REVIEWER'].includes(role)) fail('FLEET_ROLE_INVALID');
  const mutableScope = text(input.mutable_scope, 'FLEET_MUTABLE_SCOPE_REQUIRED');
  const executionCell = text(input.execution_cell, 'FLEET_EXECUTION_CELL_REQUIRED');
  if (!Array.isArray(input.required_capabilities) || input.required_capabilities.length === 0 ||
      input.required_capabilities.some((capability) => typeof capability !== 'string' || capability.length === 0 ||
        capability.trim() !== capability) || new Set(input.required_capabilities).size !== input.required_capabilities.length) {
    fail('FLEET_REQUIRED_CAPABILITIES_INVALID');
  }
  for (const key of ['review_backlog', 'integration_backlog']) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) fail('FLEET_BACKLOG_INVALID');
  }
  if (typeof input.production !== 'boolean') fail('FLEET_PRODUCTION_FLAG_INVALID');
  if (typeof input.paid_fallback !== 'boolean') fail('FLEET_PAID_FALLBACK_FLAG_INVALID');
  if (typeof input.integration_lane !== 'boolean' || typeof input.project_integration_lane_busy !== 'boolean') {
    fail('FLEET_INTEGRATION_FLAGS_INVALID');
  }
  if (input.production) return {decision: 'WAITING_HUMAN', reason: 'PRODUCTION_HUMAN_GATE'};
  if (input.paid_fallback) return {decision: 'DENIED', reason: 'PAID_FALLBACK_PROHIBITED'};
  if (input.worker_provider_write_credentials !== 0) {
    return {decision: 'DENIED', reason: 'WORKER_PROVIDER_WRITE_CREDENTIALS_MUST_BE_ZERO'};
  }
  if (!Array.isArray(input.effects) || input.effects.length === 0 ||
      input.effects.some((effect) => !SAFE_EFFECTS.has(effect)) ||
      new Set(input.effects).size !== input.effects.length) {
    return {decision: 'DENIED', reason: 'FLEET_EFFECT_NOT_ALLOWED'};
  }
  if (input.work_type === 'PRODUCT_CODING' && input.execution_cell !== 'HYPERV_UBUNTU_ISOLATED_WORKTREE') {
    return {decision: 'WAITING_EXTERNAL', reason: 'ISOLATED_HYPERV_UBUNTU_CELL_REQUIRED'};
  }
  if (input.work_type === 'CSG_SOURCE_CONSTRUCTION' && input.execution_cell !== 'LOCAL_PREPRODUCTION_WORKTREE') {
    return {decision: 'WAITING_EXTERNAL', reason: 'LOCAL_PREPRODUCTION_WORKTREE_REQUIRED'};
  }
  if (!['PRODUCT_CODING', 'CSG_SOURCE_CONSTRUCTION'].includes(input.work_type)) {
    return {decision: 'WAITING_EXTERNAL', reason: 'WORK_TYPE_NOT_IN_FLEET_SCOPE'};
  }
  const activeScopes = input.active_mutable_scopes;
  if (!Array.isArray(activeScopes)) fail('FLEET_ACTIVE_SCOPES_INVALID');
  if (activeScopes.some((scope) => typeof scope !== 'string' || scope.length === 0 || scope.trim() !== scope) ||
      new Set(activeScopes).size !== activeScopes.length) fail('FLEET_ACTIVE_SCOPES_INVALID');
  if (activeScopes.some((scope) => scope === mutableScope)) {
    return {decision: 'WAITING_EXTERNAL', reason: 'MUTABLE_SCOPE_ALREADY_OWNED'};
  }
  if (input.integration_lane === true && input.project_integration_lane_busy === true) {
    return {decision: 'WAITING_EXTERNAL', reason: 'PROJECT_INTEGRATION_LANE_BUSY'};
  }

  const freshness = freshnessPolicy(input);
  const providers = providerIndex(input.providers);
  const failures = [];
  const candidates = WORKER_ORDER.map((worker, index) => ({
    ...worker,
    tier: role === 'BUILDER' ? worker.tier : 'SECONDARY',
    index,
    requestedCell: executionCell,
    requiredCapabilities: input.required_capabilities,
    provider: providers.get(worker.id)
  })).sort((left, right) => {
    const tierOrder = (left.tier === 'PREFERRED' ? 0 : 1) - (right.tier === 'PREFERRED' ? 0 : 1);
    if (tierOrder !== 0) return tierOrder;
    const leftRate = Number.isFinite(left.provider?.measured_success_rate) ? left.provider.measured_success_rate : -1;
    const rightRate = Number.isFinite(right.provider?.measured_success_rate) ? right.provider.measured_success_rate : -1;
    return rightRate - leftRate || left.index - right.index;
  });
  for (const worker of candidates) {
    const provider = worker.provider;
    const failure = providerFailure(worker, provider, role, freshness);
    if (failure) {
      failures.push({provider: worker.id, tier: worker.tier, reason: failure,
        observed_at: typeof provider?.observed_at === 'string' ? provider.observed_at : null});
      continue;
    }
    return {
      decision: 'SELECTED',
      provider: worker.id,
      tier: worker.tier,
      role,
      work_type: input.work_type,
      execution_cell: executionCell,
      mutable_scope: mutableScope,
      observed_at: provider.observed_at,
      required_capabilities: [...input.required_capabilities],
      measured_success_rate: provider.measured_success_rate,
      review_backlog: input.review_backlog,
      integration_backlog: input.integration_backlog,
      effects: [...input.effects],
      worker_provider_write_credentials: 0,
      paid_fallback: false,
      production: false
    };
  }
  return {decision: 'WAITING_EXTERNAL', reason: 'NO_ELIGIBLE_FLEET_WORKER', failures,
    project_integration_lane_busy: input.project_integration_lane_busy === true};
}

export const QUALIFIED_FLEET_WORKERS = WORKER_ORDER;
