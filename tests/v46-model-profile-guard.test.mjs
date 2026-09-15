import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModelProfile } from '../scripts/v46-model-profile-guard.mjs';

const NOW = Date.parse('2026-09-15T01:30:00Z');
const baseProfile = () => ({
  schema: 'factory.model_profile.v2',
  provider_id: 'opencode',
  model_id: 'muse-spark-1.3-contributor-free',
  opencode_model_id: 'opencode/muse-spark-1.3-contributor-free',
  endpoint: 'https://opencode.ai/zen/v1/responses',
  catalog_status: 'active',
  account_entitlement: 'PASS_CURRENT_REAL_INFERENCE',
  dynamic_refresh_required: true,
  paid_fallback_allowed: false,
  fallback_model_ids: [],
  auto_reload_disabled: true,
  training_allowed_by_provider: true,
  zero_data_retention: false,
  region_eligibility: 'PASS_PROVIDER_OBSERVED',
  live_cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  observed_at: '2026-09-15T01:20:00Z',
  ttl_seconds: 900
});
const baseRequest = () => ({
  provider_id: 'opencode',
  model_id: 'opencode/muse-spark-1.3-contributor-free',
  data_class: 'SYNTHETIC',
  paid_fallback_allowed: false
});

test('allows exact fresh zero-cost synthetic profile', () => {
  const r = evaluateModelProfile(baseProfile(), baseRequest(), NOW);
  assert.equal(r.allow, true);
  assert.deepEqual(r.failures, []);
});

test('blocks expired profile before dispatch', () => {
  const p = baseProfile(); p.observed_at = '2026-09-15T00:00:00Z';
  assert.ok(evaluateModelProfile(p, baseRequest(), NOW).failures.includes('NOT_EXPIRED'));
});

test('blocks wrong model', () => {
  const q = baseRequest(); q.model_id = 'opencode/paid-model';
  assert.ok(evaluateModelProfile(baseProfile(), q, NOW).failures.includes('REQUEST_MODEL'));
});

test('blocks any nonzero provider cost', () => {
  const p = baseProfile(); p.live_cost.output = 0.01;
  assert.ok(evaluateModelProfile(p, baseRequest(), NOW).failures.includes('COST_OUTPUT_ZERO'));
});

test('blocks private/confidential/personal/secret data on training tier', () => {
  for (const dataClass of ['PRIVATE','CONFIDENTIAL','PERSONAL','SECRET']) {
    const q = baseRequest(); q.data_class = dataClass;
    assert.ok(evaluateModelProfile(baseProfile(), q, NOW).failures.includes('REQUEST_DATA_CLASS'));
  }
});

test('blocks paid fallback and fallback model list', () => {
  const p = baseProfile(); p.paid_fallback_allowed = true; p.fallback_model_ids = ['opencode/paid-model'];
  const r = evaluateModelProfile(p, baseRequest(), NOW);
  assert.ok(r.failures.includes('PAID_FALLBACK_DISABLED'));
  assert.ok(r.failures.includes('FALLBACK_EMPTY'));
});

test('blocks unknown current entitlement or region', () => {
  const p = baseProfile(); p.account_entitlement = 'UNKNOWN'; p.region_eligibility = 'UNKNOWN';
  const r = evaluateModelProfile(p, baseRequest(), NOW);
  assert.ok(r.failures.includes('ENTITLEMENT'));
  assert.ok(r.failures.includes('REGION_ELIGIBLE'));
});
