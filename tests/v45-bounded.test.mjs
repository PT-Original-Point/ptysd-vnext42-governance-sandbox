import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const control = JSON.parse(fs.readFileSync('governance/v45/control.json', 'utf8'));
const run = JSON.parse(fs.readFileSync('runs/V45-Z2-SYNTHETIC-001/run.json', 'utf8'));
const contract = JSON.parse(fs.readFileSync('runs/V45-Z2-SYNTHETIC-001/contract.json', 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

function contractHash(c) {
  const x = structuredClone(c);
  delete x.contract_hash;
  const raw = JSON.stringify(canonical(x));
  return 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
}

test('Z2 control is fail-closed until the approved self-hosted runner exists', () => {
  assert.equal(control.state, 'WAITING_RESOURCE');
  assert.equal(control.wait_reason, 'SELF_HOSTED_RUNNER_NOT_REGISTERED');
  assert.equal(run.state, 'WAITING_RESOURCE');
  assert.equal(run.attempt_epoch, 0);
  assert.equal(run.active_task_id, null);
  assert.deepEqual(run.unresolved_operation_ids, []);
});

test('Z2 contract is synthetic and cannot create external effects', () => {
  assert.equal(contract.model_profile_ref, 'SYNTHETIC_NOOP');
  assert.deepEqual(contract.allowed_effects, []);
  assert.ok(contract.exclude.includes('Production'));
  assert.ok(contract.exclude.includes('provider writes'));
  assert.equal(contractHash(contract), contract.contract_hash);
});

test('repo identity and governance identity are pinned', () => {
  assert.equal(control.repository_id, 1352411536);
  assert.equal(control.project_id, run.project_id);
  assert.equal(control.project_id, contract.project_id);
  assert.equal(control.mission_hash, contract.mission_hash);
  assert.equal(control.policy_hash, contract.policy_hash);
});
