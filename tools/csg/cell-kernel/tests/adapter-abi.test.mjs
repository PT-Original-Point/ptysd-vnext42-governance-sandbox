import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNativeAdapter, createAdapterInvocation, normalizeAdapterResult, evaluateOpenCodePinPromotion, REQUIRED_CANARY_CASES } from '../adapter-abi.mjs';

const identity = { project_id: 'P', run_id: 'R', task_id: 'T', attempt_id: 'A', attempt_epoch: 1 };
const mk = (adapter_id, interface_kind, overrides = {}) => ({
  adapter_id,
  interface_kind,
  qualified: true,
  binary_required: false,
  binary_present: true,
  paid_fallback_allowed: false,
  incremental_usd: 0,
  capabilities: ['new_session', 'load_session', 'cancel'],
  ...overrides,
});

test('native HTTP outranks ACP, thin ACP, CLI and scraping', () => {
  const x = selectNativeAdapter([
    mk('scrape', 'TERMINAL_SCRAPING'),
    mk('cli', 'CLI_WRAPPER'),
    mk('thin', 'THIN_ACP_ADAPTER'),
    mk('acp', 'NATIVE_ACP'),
    mk('open', 'OPEN_CODE_NATIVE_HTTP'),
  ], ['new_session']);
  assert.equal(x.selected.adapter_id, 'open');
});

test('native ACP outranks thin ACP when HTTP lacks required capability', () => {
  const x = selectNativeAdapter([
    mk('open', 'OPEN_CODE_NATIVE_HTTP', { capabilities: ['cancel'] }),
    mk('acp', 'NATIVE_ACP'),
  ], ['load_session']);
  assert.equal(x.selected.adapter_id, 'acp');
});

test('missing binary is explicit failure when no zero-cost usable adapter remains', () => {
  assert.throws(() => selectNativeAdapter([
    mk('codex-acp', 'THIN_ACP_ADAPTER', { binary_required: true, binary_present: false }),
  ], ['new_session']), /ENGINE_BINARY_MISSING/);
});

test('paid route never becomes fallback', () => {
  assert.throws(() => selectNativeAdapter([
    mk('paid', 'NATIVE_ACP', { route: 'api-key-paid', incremental_usd: 1, paid_fallback_allowed: true }),
  ], ['new_session']), /NO_QUALIFIED_ZERO_COST_ADAPTER/);
});

test('invocation rejects provider write credential', () => {
  const s = selectNativeAdapter([mk('open', 'OPEN_CODE_NATIVE_HTTP')], []);
  assert.throws(() => createAdapterInvocation(s, identity, { provider_write_credential: 'x' }), /PROVIDER_WRITE_CREDENTIAL_FORBIDDEN/);
});

test('same invocation input is deterministic', () => {
  const s = selectNativeAdapter([mk('open', 'OPEN_CODE_NATIVE_HTTP')], []);
  const a = createAdapterInvocation(s, identity, { action: 'new_session' });
  const b = createAdapterInvocation(s, identity, { action: 'new_session' });
  assert.equal(a.invocation_digest, b.invocation_digest);
});

test('completed without receipt is rejected as empty success', () => {
  assert.throws(() => normalizeAdapterResult({ status: 'COMPLETED' }), /EMPTY_SUCCESS_FORBIDDEN/);
});

test('explicit failed result remains failed', () => {
  assert.deepEqual(normalizeAdapterResult({ status: 'FAILED', reason_code: 'ENGINE_BINARY_MISSING' }), { status: 'FAILED', reason_code: 'ENGINE_BINARY_MISSING' });
});

test('same interface precedence deterministically orders by adapter_id for [z,a] and [a,z]', () => {
  const a = mk('a', 'OPEN_CODE_NATIVE_HTTP');
  const z = mk('z', 'OPEN_CODE_NATIVE_HTTP');
  assert.equal(selectNativeAdapter([z, a], ['new_session']).selected.adapter_id, 'a');
  assert.equal(selectNativeAdapter([a, z], ['new_session']).selected.adapter_id, 'a');
});

test('semantic dynamic future versions promote with verified zero-cost canary', () => {
  const cases = Object.fromEntries(REQUIRED_CANARY_CASES.map(k => [k, true]));
  const x = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.1.0', result: 'PASS', cases, incremental_usd: 0, paid_fallback_allowed: false },
  });
  assert.equal(x.promote, true);
  assert.equal(x.pin, '2.1.0');
  assert.equal(x.reason, 'CANARY_PASS');
});

test('missing or empty observed current version denies promotion', () => {
  const missing = evaluateOpenCodePinPromotion({ candidate_version: '2.1.0' });
  assert.equal(missing.promote, false);
  assert.equal(missing.pin, 'UNKNOWN');
  assert.equal(missing.reason, 'DENY');
  const empty = evaluateOpenCodePinPromotion({ current_version: '', candidate_version: '2.1.0' });
  assert.equal(empty.promote, false);
  assert.equal(empty.pin, 'UNKNOWN');
  assert.equal(empty.reason, 'DENY');
});

test('missing candidate version denies promotion', () => {
  const x = evaluateOpenCodePinPromotion({ current_version: '2.0.0' });
  assert.equal(x.promote, false);
  assert.equal(x.pin, '2.0.0');
  assert.equal(x.reason, 'DENY');
});

test('canary version mismatch against candidate is rejected', () => {
  const cases = Object.fromEntries(REQUIRED_CANARY_CASES.map(k => [k, true]));
  const x = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.0.9', result: 'PASS', cases, incremental_usd: 0, paid_fallback_allowed: false },
  });
  assert.equal(x.promote, false);
  assert.equal(x.pin, '2.0.0');
  assert.equal(x.reason, 'VERSION_MISMATCH');
});

test('failed canary result cannot promote', () => {
  const cases = Object.fromEntries(REQUIRED_CANARY_CASES.map(k => [k, true]));
  const x = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.1.0', result: 'FAIL', cases, incremental_usd: 0, paid_fallback_allowed: false },
  });
  assert.equal(x.promote, false);
  assert.equal(x.pin, '2.0.0');
  assert.equal(x.reason, 'CANARY_NOT_PASS');
});

test('partial canary with missing cases cannot promote', () => {
  const x = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.1.0', result: 'PASS', cases: { session_load: true }, incremental_usd: 0, paid_fallback_allowed: false },
  });
  assert.equal(x.promote, false);
  assert.equal(x.pin, '2.0.0');
  assert.equal(x.reason, 'CANARY_INCOMPLETE');
});

test('canary with paid fallback cannot promote', () => {
  const cases = Object.fromEntries(REQUIRED_CANARY_CASES.map(k => [k, true]));
  const x = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.1.0', result: 'PASS', cases, incremental_usd: 0, paid_fallback_allowed: true },
  });
  assert.equal(x.promote, false);
  assert.equal(x.reason, 'ZERO_COST_OR_FALLBACK_GUARD_FAIL');
});

test('negative or nonfinite costs cannot promote', () => {
  const cases = Object.fromEntries(REQUIRED_CANARY_CASES.map(k => [k, true]));
  const neg = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.1.0', result: 'PASS', cases, incremental_usd: -1, paid_fallback_allowed: false },
  });
  assert.equal(neg.promote, false);
  assert.equal(neg.reason, 'ZERO_COST_OR_FALLBACK_GUARD_FAIL');
  const nonfinite = evaluateOpenCodePinPromotion({
    current_version: '2.0.0',
    candidate_version: '2.1.0',
    canary: { version: '2.1.0', result: 'PASS', cases, incremental_usd: NaN, paid_fallback_allowed: false },
  });
  assert.equal(nonfinite.promote, false);
  assert.equal(nonfinite.reason, 'ZERO_COST_OR_FALLBACK_GUARD_FAIL');
});

test('evaluateOpenCodePinPromotion supports explicit current_pin', () => {
  const cases = Object.fromEntries(REQUIRED_CANARY_CASES.map(k => [k, true]));
  const x = evaluateOpenCodePinPromotion({
    current_pin: '9.0.0',
    candidate_version: '9.1.0',
    canary: { version: '9.1.0', result: 'PASS', cases, incremental_usd: 0, paid_fallback_allowed: false },
  });
  assert.equal(x.promote, true);
  assert.equal(x.pin, '9.1.0');
  assert.equal(x.reason, 'CANARY_PASS');
});
