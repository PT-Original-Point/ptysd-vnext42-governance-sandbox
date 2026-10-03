import assert from 'node:assert/strict';
import test from 'node:test';
import {selectFleetWorker} from '../lib/fleet.mjs';

const observedAt = '2026-10-02T12:30:00Z';
function input(overrides = {}) {
  return {
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    role: 'BUILDER',
    work_type: 'CSG_SOURCE_CONSTRUCTION',
    execution_cell: 'LOCAL_PREPRODUCTION_WORKTREE',
    required_capabilities: ['BUILD_CSG_SOURCE'],
    mutable_scope: 'source-slice-a',
    active_mutable_scopes: [],
    integration_lane: false,
    project_integration_lane_busy: false,
    effects: ['LOCAL_WORKTREE_WRITE', 'LOCAL_TEST', 'LOCAL_EVIDENCE_APPEND'],
    worker_provider_write_credentials: 0,
    paid_fallback: false,
    production: false,
    review_backlog: 0,
    integration_backlog: 0,
    observation_freshness: {evaluated_at: '2026-10-02T12:31:00Z', max_age_seconds: 300},
    providers: [],
    ...overrides
  };
}

function provider(id, overrides = {}) {
  return {id, observed_at: observedAt, runtime_available: true, health: 'HEALTHY',
    authenticated: true, eligible: true, eligible_roles: ['BUILDER', 'REVIEWER'],
    sandbox_eligible: true,
    execution_cells: ['LOCAL_PREPRODUCTION_WORKTREE', 'HYPERV_UBUNTU_ISOLATED_WORKTREE'],
    capabilities: ['BUILD_CSG_SOURCE', 'PRODUCT_CODING'], measured_success_rate: 0.9,
    qualified: true, quota: 'AVAILABLE', ...overrides};
}

test('preferred OpenCode is selected before Muse when both routes are healthy and eligible', () => {
  assert.equal(selectFleetWorker(input({providers: [provider('muse'), provider('opencode')]})).provider, 'opencode');
});

test('measured success rate ranks qualified routes within the preferred tier', () => {
  const result = selectFleetWorker(input({providers: [
    provider('opencode', {measured_success_rate: 0.82}),
    provider('muse', {measured_success_rate: 0.96})
  ]}));
  assert.equal(result.provider, 'muse');
  assert.equal(result.measured_success_rate, 0.96);
});

test('reviewer routing requires qualified routes and ranks by measured success', () => {
  const result = selectFleetWorker(input({role: 'REVIEWER', providers: [
    provider('opencode', {measured_success_rate: 0.82, qualified: false}),
    provider('muse', {measured_success_rate: 0.96})
  ]}));
  assert.equal(result.provider, 'muse');
  assert.equal(result.tier, 'SECONDARY');

  const noQualifiedReviewer = selectFleetWorker(input({role: 'REVIEWER', providers: [
    provider('opencode', {qualified: false})
  ]}));
  assert.equal(noQualifiedReviewer.decision, 'WAITING_EXTERNAL');
  assert.equal(noQualifiedReviewer.failures[0].reason, 'OPENCODE_SECONDARY_ROUTE_NOT_QUALIFIED');
});

test('Muse is selected when OpenCode has no healthy eligible route', () => {
  const result = selectFleetWorker(input({providers: [
    provider('opencode', {health: 'UNAVAILABLE'}), provider('muse')
  ]}));
  assert.equal(result.provider, 'muse');
  assert.equal(result.tier, 'PREFERRED');
});

test('Muse 403 parks only that route and permits a qualified secondary worker', () => {
  const result = selectFleetWorker(input({providers: [
    provider('muse', {health: 'FORBIDDEN'}), provider('antigravity')
  ]}));
  assert.equal(result.decision, 'SELECTED');
  assert.equal(result.provider, 'antigravity');
  assert.equal(result.tier, 'SECONDARY');
});

test('Codex runtime remains eligible when its UI is closed', () => {
  const codex = provider('codex', {ui_open: false});
  const result = selectFleetWorker(input({providers: [
    provider('opencode', {runtime_available: false}),
    provider('muse', {runtime_available: false}),
    provider('antigravity', {runtime_available: false}),
    codex
  ]}));
  assert.equal(result.provider, 'codex');
  assert.equal(result.observed_at, observedAt);
});

test('GPT Web or missing routes never become a paid fallback', () => {
  const result = selectFleetWorker(input({providers: [], paid_fallback: true}));
  assert.deepEqual(result, {decision: 'DENIED', reason: 'PAID_FALLBACK_PROHIBITED'});
});

test('quota exhaustion and provider authentication failures park their exact route', () => {
  const result = selectFleetWorker(input({providers: [
    provider('opencode', {quota: 'EXHAUSTED'}),
    provider('muse', {authenticated: false}),
    provider('antigravity', {runtime_available: false}),
    provider('codex', {qualified: false})
  ]}));
  assert.equal(result.decision, 'WAITING_EXTERNAL');
  assert.deepEqual(result.failures.map((failure) => failure.provider), ['opencode', 'muse', 'antigravity', 'codex']);
});

test('capability and sandbox mismatch park only the route without falling through to Host', () => {
  const result = selectFleetWorker(input({providers: [
    provider('opencode', {capabilities: ['REVIEW_ONLY']}),
    provider('muse', {execution_cells: ['WINDOWS_HOST']}),
    provider('antigravity', {sandbox_eligible: false}),
    provider('codex', {qualified: false})
  ]}));
  assert.equal(result.decision, 'WAITING_EXTERNAL');
  assert.deepEqual(result.failures.map((failure) => failure.provider), ['opencode', 'muse', 'antigravity', 'codex']);
  assert.ok(result.failures.some((failure) => failure.reason === 'OPENCODE_CAPABILITY_NOT_AVAILABLE'));
  assert.ok(result.failures.some((failure) => failure.reason === 'MUSE_SANDBOX_NOT_ELIGIBLE'));
});

test('stale and future provider observations park only their own route', () => {
  const stalePreferred = selectFleetWorker(input({providers: [
    provider('opencode', {observed_at: '2026-10-02T12:20:00Z'}), provider('muse')
  ]}));
  assert.equal(stalePreferred.decision, 'SELECTED');
  assert.equal(stalePreferred.provider, 'muse');

  const staleOnly = selectFleetWorker(input({providers: [
    provider('opencode', {observed_at: '2026-10-02T12:20:00Z'})
  ]}));
  assert.equal(staleOnly.decision, 'WAITING_EXTERNAL');
  assert.equal(staleOnly.failures[0].reason, 'OPENCODE_OBSERVATION_STALE');

  const noFreshRoute = selectFleetWorker(input({providers: [
    provider('opencode', {observed_at: '2026-10-02T12:32:00Z'})
  ]}));
  assert.equal(noFreshRoute.decision, 'WAITING_EXTERNAL');
  assert.equal(noFreshRoute.failures[0].reason, 'OPENCODE_OBSERVATION_FROM_FUTURE');
});

test('provider selection requires an explicit valid observation-freshness policy', () => {
  assert.throws(() => selectFleetWorker(input({observation_freshness: undefined})), {
    code: 'FLEET_OBSERVATION_FRESHNESS_POLICY_REQUIRED'
  });
  assert.throws(() => selectFleetWorker(input({observation_freshness: {
    evaluated_at: '2026-10-02T12:31:00Z', max_age_seconds: 0
  }})), {code: 'FLEET_OBSERVATION_MAX_AGE_INVALID'});
  assert.throws(() => selectFleetWorker(input({observation_freshness: {
    evaluated_at: 'not-a-time', max_age_seconds: 300
  }})), {code: 'FLEET_EVALUATION_TIME_INVALID'});
});

test('normal product coding is confined to the isolated Hyper-V Ubuntu worktree', () => {
  assert.deepEqual(selectFleetWorker(input({work_type: 'PRODUCT_CODING', execution_cell: 'WINDOWS_HOST'}),), {
    decision: 'WAITING_EXTERNAL', reason: 'ISOLATED_HYPERV_UBUNTU_CELL_REQUIRED'
  });
  assert.equal(selectFleetWorker(input({work_type: 'PRODUCT_CODING', execution_cell: 'HYPERV_UBUNTU_ISOLATED_WORKTREE',
    required_capabilities: ['PRODUCT_CODING'], providers: [provider('opencode')]})).decision, 'SELECTED');
});

test('one owner per mutable slice and one project integration lane are enforced', () => {
  assert.deepEqual(selectFleetWorker(input({active_mutable_scopes: ['source-slice-a'], providers: [provider('opencode')]}),), {
    decision: 'WAITING_EXTERNAL', reason: 'MUTABLE_SCOPE_ALREADY_OWNED'
  });
  assert.deepEqual(selectFleetWorker(input({integration_lane: true, project_integration_lane_busy: true,
    providers: [provider('opencode')]}),), {
    decision: 'WAITING_EXTERNAL', reason: 'PROJECT_INTEGRATION_LANE_BUSY'
  });
});

test('unknown integration flags, malformed scopes, and non-local source cells fail closed', () => {
  assert.throws(() => selectFleetWorker(input({integration_lane: undefined})), {
    code: 'FLEET_INTEGRATION_FLAGS_INVALID'
  });
  assert.throws(() => selectFleetWorker(input({active_mutable_scopes: ['source-slice-a', 'source-slice-a']})), {
    code: 'FLEET_ACTIVE_SCOPES_INVALID'
  });
  assert.deepEqual(selectFleetWorker(input({execution_cell: 'WINDOWS_HOST'})), {
    decision: 'WAITING_EXTERNAL', reason: 'LOCAL_PREPRODUCTION_WORKTREE_REQUIRED'
  });
});

test('worker provider-write credentials, unsafe effects, Production, and unknown roles are denied', () => {
  assert.equal(selectFleetWorker(input({worker_provider_write_credentials: 1,
    providers: [provider('opencode')]})).reason, 'WORKER_PROVIDER_WRITE_CREDENTIALS_MUST_BE_ZERO');
  assert.equal(selectFleetWorker(input({paid_fallback: true,
    providers: [provider('opencode')]})).reason, 'PAID_FALLBACK_PROHIBITED');
  assert.equal(selectFleetWorker(input({effects: ['REMOTE_REPOSITORY_WRITE'],
    providers: [provider('opencode')]})).reason, 'FLEET_EFFECT_NOT_ALLOWED');
  assert.equal(selectFleetWorker(input({production: true, providers: [provider('opencode')]})).decision, 'WAITING_HUMAN');
  assert.throws(() => selectFleetWorker(input({role: 'DEPLOYER'})), {code: 'FLEET_ROLE_INVALID'});
});
