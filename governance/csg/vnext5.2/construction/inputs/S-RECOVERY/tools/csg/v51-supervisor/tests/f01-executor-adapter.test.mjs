import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createF01ExecutionAdapter, validateOuterReviewReceipt} from '../lib/f01-executor-adapter.mjs';
import {canonicalJson} from '../lib/fingerprint.mjs';

const identity = Object.freeze({
  project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  operation_id: 'F01.ISOLATED_EXECUTION',
  run_id: 'V52-F01-001',
  task_id: 'F01-CANARY-01',
  attempt_id: 'F01-CANARY-01-A1',
  attempt_epoch: 1,
  control_head: 'd39486601d851e31256852a24e9c1393b9046fe5',
  checkpoint_seq: 200,
  logical_work_fingerprint: `sha256:${'a'.repeat(64)}`
});
const freshness = Object.freeze({evaluated_at: '2026-10-03T04:00:00Z', max_age_seconds: 300});
const proof = (digit) => ({ref: `provider://${digit}/receipt`, sha256: `sha256:${digit.repeat(64)}`});
const identityDigest = `sha256:${createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex')}`;

function route(overrides = {}) {
  return {
    provider_id: 'opencode',
    route_id: 'opencode-acp-v1',
    protocol: 'ACP',
    protocol_version: '1',
    observed_at: '2026-10-03T03:59:00Z',
    authenticated: true,
    health: 'HEALTHY',
    quota: 'AVAILABLE',
    capabilities: ['TASK_PREPARE', 'TASK_START', 'TASK_CANCEL', 'TASK_RECEIPT_READ', 'SANDBOX_PROOF_READ'],
    route_proof: proof('b'),
    sandbox_proof: {
      provider_id: 'opencode',
      route_id: 'opencode-acp-v1',
      cell_id: 'ubuntu-hv-canary-1',
      execution_cell: 'HYPERV_UBUNTU_ISOLATED_WORKTREE',
      isolated: true,
      isolation_profile_digest: `sha256:${'c'.repeat(64)}`,
      proof: proof('d')
    },
    fleet_selection: {
      decision: 'SELECTED', provider: 'opencode', role: 'BUILDER',
      execution_cell: 'HYPERV_UBUNTU_ISOLATED_WORKTREE', worker_provider_write_credentials: 0,
      paid_fallback: false, production: false
    },
    ...overrides
  };
}

function taskReceipt(status, overrides = {}) {
  return {
    identity: {...identity},
    provider_id: 'opencode',
    route_id: 'opencode-acp-v1',
    status,
    observed_at: '2026-10-03T04:00:00Z',
    proof: proof('e'),
    ...(status === 'NOT_FOUND_CONFIRMED' ? {} : {provider_task_id: 'provider-task-1'}),
    ...(status === 'CANCELLED' ? {capacity_released: true} : {}),
    ...overrides
  };
}

function ports(overrides = {}) {
  const events = [];
  let receiptReads = 0;
  let authorizedIdentityDigest = null;
  const base = {
    async verifyDispatchAuthorization(request) {
      events.push(`authorize:${request.action}`);
      authorizedIdentityDigest = request.identity_digest;
      return {status: 'VERIFIED', identity_digest: request.identity_digest, action: request.action,
        worker_provider_write_credentials: 0, paid_fallback: false, production: false};
    },
    async verifyRouteObservation(request) {
      events.push('verify-route');
      return {status: 'VERIFIED', provider_id: request.route.provider_id, route_id: request.route.route_id,
        route_digest: request.route_digest, route_proof_sha256: request.route.route_proof.sha256,
        sandbox_proof_sha256: request.route.sandbox_proof.sha256};
    },
    async readTaskReceipt() {
      events.push('read-receipt');
      receiptReads++;
      return receiptReads === 1 ? taskReceipt('NOT_FOUND_CONFIRMED') : taskReceipt('RUNNING');
    },
    async verifyTaskReceipt({receipt, identity: exactIdentity, route: exactRoute}) {
      events.push('verify-receipt');
      return {status: 'VERIFIED', identity_digest: authorizedIdentityDigest, provider_id: exactRoute.provider_id,
        route_id: exactRoute.route_id, receipt_sha256: receipt.proof.sha256,
        ...(exactIdentity.task_id === identity.task_id ? {} : {identity_digest: 'mismatch'})};
    },
    async startTask() { events.push('start-task'); return {status: 'STARTED'}; },
    async cancelTask() { events.push('cancel-task'); return {status: 'CANCEL_REQUESTED'}; }
  };
  return {events, build: () => createF01ExecutionAdapter({...base, ...overrides})};
}

test('adapter composition requires every provider and proof port', () => {
  assert.throws(() => createF01ExecutionAdapter({}), {code: 'F01_EXECUTION_PORT_REQUIRED:verifyDispatchAuthorization'});
});

test('missing cancel capability parks the route and never starts an agent task', async () => {
  const harness = ports();
  const adapter = harness.build();
  const result = await adapter.startTask({identity, route: route({capabilities: ['TASK_PREPARE', 'TASK_START']}), freshness});
  assert.equal(result.status, 'PARKED');
  assert.equal(result.reason, 'F01_ROUTE_REQUIRED_CAPABILITY_MISSING');
  assert.equal(harness.events.includes('start-task'), false);
  assert.equal(harness.events.includes('read-receipt'), false);
});

test('stale or future capability observations park before task read or start', async () => {
  for (const observedAt of ['2026-10-03T03:00:00Z', '2026-10-03T04:01:00Z']) {
    const harness = ports();
    const result = await harness.build().startTask({identity, route: route({observed_at: observedAt}), freshness});
    assert.equal(result.status, 'PARKED');
    assert.equal(result.reason, 'F01_ROUTE_OBSERVATION_STALE_OR_FUTURE');
    assert.equal(harness.events.includes('start-task'), false);
    assert.equal(harness.events.includes('read-receipt'), false);
  }
});

test('pre-dispatch exact NOT_FOUND readback precedes one start and verified post-readback', async () => {
  const harness = ports();
  const result = await harness.build().startTask({identity, route: route(), freshness});
  assert.equal(result.status, 'PROVIDER_READBACK_CONFIRMED');
  assert.equal(result.receipt.status, 'RUNNING');
  assert.deepEqual(harness.events, ['authorize:START', 'verify-route', 'read-receipt', 'verify-receipt',
    'start-task', 'read-receipt', 'verify-receipt']);
});

test('an existing or identity-mismatched receipt prevents duplicate start', async () => {
  const existing = ports({async readTaskReceipt() { return taskReceipt('RUNNING'); }});
  const parked = await existing.build().startTask({identity, route: route(), freshness});
  assert.equal(parked.status, 'PARKED_EXISTING_OR_UNKNOWN_TASK');
  assert.equal(existing.events.includes('start-task'), false);

  const mismatch = ports({async readTaskReceipt() {
    return taskReceipt('NOT_FOUND_CONFIRMED', {identity: {...identity, attempt_epoch: 2}});
  }});
  const unknown = await mismatch.build().startTask({identity, route: route(), freshness});
  assert.equal(unknown.status, 'UNKNOWN_EFFECT_READBACK_REQUIRED');
  assert.equal(mismatch.events.includes('start-task'), false);
});

test('an unknown start is read back once and is never blindly redispatched', async () => {
  let reads = 0;
  let starts = 0;
  const harness = ports({
    async readTaskReceipt() {
      reads++;
      return reads === 1 ? taskReceipt('NOT_FOUND_CONFIRMED') : taskReceipt('RUNNING');
    },
    async startTask() { starts++; throw Object.assign(new Error('transport timeout'), {code: 'TIMEOUT'}); }
  });
  const result = await harness.build().startTask({identity, route: route(), freshness});
  assert.equal(result.status, 'PROVIDER_READBACK_CONFIRMED');
  assert.equal(result.dispatch_outcome, 'UNKNOWN_RECONCILED');
  assert.equal(starts, 1);
  assert.equal(reads, 2);
});

test('cancel requires a live exact task and only releases capacity after provider confirmation', async () => {
  let reads = 0;
  const harness = ports({
    async readTaskReceipt() {
      reads++;
      return reads === 1 ? taskReceipt('QUEUED') : taskReceipt('CANCELLED', {capacity_released: false});
    }
  });
  const result = await harness.build().cancelTask({identity, route: route(), freshness});
  assert.equal(result.status, 'CANCEL_OR_CAPACITY_RELEASE_UNCONFIRMED');
  assert.equal(result.capacity_released, false);
  assert.equal(harness.events.filter((event) => event === 'cancel-task').length, 1);
});

test('cancel timeout is reconciled by one exact readback and never repeated', async () => {
  let reads = 0;
  let cancels = 0;
  const harness = ports({
    async readTaskReceipt() {
      reads++;
      return reads === 1 ? taskReceipt('RUNNING') : taskReceipt('CANCELLED', {capacity_released: true});
    },
    async cancelTask() { cancels++; throw Object.assign(new Error('timeout'), {code: 'TIMEOUT'}); }
  });
  const result = await harness.build().cancelTask({identity, route: route(), freshness});
  assert.equal(result.status, 'CANCELLED_AND_CAPACITY_RELEASED_CONFIRMED');
  assert.equal(result.dispatch_outcome, 'UNKNOWN_RECONCILED');
  assert.equal(result.capacity_released, true);
  assert.equal(cancels, 1);
  assert.equal(reads, 2);
});

test('outer review structure binds a separate read-only invocation but is not an authenticated verdict', async () => {
  const result = await validateOuterReviewReceipt({
    identity: {...identity},
    identity_digest: identityDigest,
    producer: {invocation_id: 'builder-invocation'},
    reviewer: {role: 'REVIEWER', invocation_id: 'reviewer-invocation'},
    read_only: true,
    worker_provider_write_credentials: 0,
    verdict: 'PASS',
    observed_at: '2026-10-03T04:00:00Z',
    proof: proof('f')
  });
  assert.equal(result.status, 'STRUCTURE_VALID_REQUIRES_TRUSTED_REVIEWER_READBACK');
  await assert.rejects(() => validateOuterReviewReceipt({
    identity: {...identity}, identity_digest: identityDigest,
    producer: {invocation_id: 'same'}, reviewer: {role: 'REVIEWER', invocation_id: 'same'},
    read_only: true, worker_provider_write_credentials: 0, verdict: 'PASS',
    observed_at: '2026-10-03T04:00:00Z', proof: proof('f')
  }), {code: 'F01_OUTER_REVIEW_RECEIPT_INVALID'});
});
