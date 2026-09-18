import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateModelProfile } from '../scripts/v46-model-profile-guard.mjs';

const registry = JSON.parse(fs.readFileSync(new URL('../governance/v46/model-profiles.json', import.meta.url), 'utf8'));
const profile = () => structuredClone(registry.profiles.find(p => p.profile_id === registry.selected_profile_id));
const NOW = Date.parse('2026-09-15T02:59:19.230Z');
const request = () => ({
  provider_id: 'opencode',
  model_id: 'opencode/muse-spark-1.3-contributor-free',
  data_class: 'SYNTHETIC',
  paid_fallback_allowed: false
});
const preDispatch = (p, q, now = NOW) => {
  let providerCalls = 0;
  const gate = evaluateModelProfile(p, q, now);
  if (gate.allow) providerCalls += 1;
  return { gate, providerCalls };
};

test('registry has exactly one selected dispatchable model profile', () => {
  assert.equal(registry.schema, 'factory.model_profiles.v1');
  assert.equal(registry.profiles.length, 1);
  assert.equal(profile().dispatch_allowed, true);
});
test('fresh exact PUBLIC/SYNTHETIC profile is the only allow path', () => {
  const { gate, providerCalls } = preDispatch(profile(), request());
  assert.equal(gate.allow, true);
  assert.equal(providerCalls, 1);
});

test('V46-F23 wrong model is rejected before provider call', () => {
  const q = request(); q.model_id = 'opencode/paid-model';
  const { gate, providerCalls } = preDispatch(profile(), q);
  assert.equal(gate.allow, false);
  assert.ok(gate.failures.includes('REQUEST_MODEL'));
  assert.equal(providerCalls, 0);
});

test('V46-F23 changed price/nonzero cost is rejected before provider call', () => {
  const p = profile(); p.live_cost.output = 0.01;
  const { gate, providerCalls } = preDispatch(p, request());
  assert.equal(gate.allow, false);
  assert.ok(gate.failures.includes('COST_OUTPUT_ZERO'));
  assert.equal(providerCalls, 0);
});

test('wrong endpoint is rejected before provider call', () => {
  const p = profile(); p.endpoint = 'https://example.invalid/paid';
  const { gate, providerCalls } = preDispatch(p, request());
  assert.equal(gate.allow, false);
  assert.ok(gate.failures.includes('ENDPOINT'));
  assert.equal(providerCalls, 0);
});
test('V46-F24 private/confidential/personal/secret data is rejected before provider call', () => {
  for (const dataClass of ['PRIVATE', 'CONFIDENTIAL', 'PERSONAL', 'SECRET']) {
    const q = request(); q.data_class = dataClass;
    const { gate, providerCalls } = preDispatch(profile(), q);
    assert.equal(gate.allow, false);
    assert.ok(gate.failures.includes('REQUEST_DATA_CLASS'));
    assert.equal(providerCalls, 0);
  }
});

test('V46-F39 expired profile becomes WAITING_RESOURCE with zero provider calls', () => {
  const p = profile(); p.observed_at = '2026-09-15T02:00:00Z';
  const { gate, providerCalls } = preDispatch(p, request());
  assert.equal(gate.result, 'WAITING_RESOURCE');
  assert.ok(gate.failures.includes('NOT_EXPIRED'));
  assert.equal(providerCalls, 0);
});

test('V46-F39 exhausted or unknown entitlement becomes WAITING_RESOURCE', () => {
  for (const entitlement of ['QUOTA_EXHAUSTED', 'UNKNOWN']) {
    const p = profile(); p.account_entitlement = entitlement;
    const { gate, providerCalls } = preDispatch(p, request());
    assert.equal(gate.result, 'WAITING_RESOURCE');
    assert.ok(gate.failures.includes('ENTITLEMENT'));
    assert.equal(providerCalls, 0);
  }
});
test('paid fallback and any fallback model remain hard disabled', () => {
  const p = profile();
  p.paid_fallback_allowed = true;
  p.fallback_model_ids = ['opencode/paid-model'];
  const { gate, providerCalls } = preDispatch(p, request());
  assert.equal(gate.allow, false);
  assert.ok(gate.failures.includes('PAID_FALLBACK_DISABLED'));
  assert.ok(gate.failures.includes('FALLBACK_EMPTY'));
  assert.equal(providerCalls, 0);
});

test('inactive catalog or unknown region is fail closed', () => {
  for (const mutate of [
    p => { p.catalog_status = 'inactive'; },
    p => { p.region_eligibility = 'UNKNOWN'; }
  ]) {
    const p = profile(); mutate(p);
    const { gate, providerCalls } = preDispatch(p, request());
    assert.equal(gate.allow, false);
    assert.equal(providerCalls, 0);
  }
});

test('all cost-bearing channel classes deny incremental paid fallback', () => {
  const expected = new Set(['research','search','eval','model','ci','storage']);
  assert.deepEqual(new Set(registry.channel_inventory.map(x => x.channel)), expected);
  for (const channel of registry.channel_inventory) {
    assert.equal(channel.incremental_paid_cost_allowed, false);
    assert.equal(channel.paid_fallback_allowed, false);
  }
});
test('fresh qualification evidence is pinned without secret material', () => {
  const p = profile();
  assert.equal(p.required_opencode_version, '1.18.30');
  assert.equal(p.opencode_binary_sha256, '87bd160e053af86b5b409daabf71f8dc05bbc3a2a3a5f563f36011cdf706a999');
  assert.equal(p.runtime_candidate_sha256, '37525f39e69d24ae9b56357af10c72cdcc0950664a4b4f7d90f464381aab81f4');
  assert.equal(p.runtime_observed_total_cost, 0);
  assert.equal(p.runtime_step_finish_count, 6);
  assert.equal(p.secret_material_recorded, false);
});

test('training/data policy is explicit and only PUBLIC/SYNTHETIC is allowed', () => {
  const p = profile();
  assert.equal(p.training_allowed_by_provider, true);
  assert.equal(p.zero_data_retention, false);
  assert.deepEqual(p.allowed_data_classes, ['PUBLIC','SYNTHETIC']);
  assert.deepEqual(p.forbidden_data_classes, ['PRIVATE','CONFIDENTIAL','PERSONAL','SECRET']);
  assert.equal(p.data_policy_source, 'https://opencode.ai/docs/zen');
});
