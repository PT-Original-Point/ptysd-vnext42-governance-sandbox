import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStatus, projectStatusSafe, STATUS_VIEWS } from '../status-projection.mjs';

const sample = () => ({
  revision: 1,
  state: 'READY',
  stop_requested: false,
  approval: null,
  error: null,
  unresolved_effect_refs: [],
  evidence: [],
  metadata: {
    task_id: 'T1',
    attempt_id: 'A1',
    attempt_epoch: 0,
    phase: 'INIT',
    completion_state: 'RUNNING'
  }
});

test('boundary: unknown view is rejected with INVALID_STATUS_VIEW', () => {
  assert.throws(() => projectStatus(sample(), { view: 'telemetry' }), /INVALID_STATUS_VIEW/);
});

test('boundary: negative or non-integer since_revision throws INVALID_SINCE_REVISION', () => {
  assert.throws(() => projectStatus(sample(), { since_revision: -1 }), /INVALID_SINCE_REVISION/);
  assert.throws(() => projectStatus(sample(), { since_revision: 2.5 }), /INVALID_SINCE_REVISION/);
});

test('invalid input: empty artifact ref object fails validation', () => {
  const s = sample();
  s.unresolved_effect_refs = [{}];
  assert.throws(() => projectStatus(s), /EMPTY_ARTIFACT_REF/);
});

test('invalid input: non-sha256 digest format fails validation', () => {
  const s = sample();
  s.unresolved_effect_refs = [{ digest: 'sha1:deadbeef' }];
  assert.throws(() => projectStatus(s), /INVALID_ARTIFACT_DIGEST/);
});

test('invalid input: non-uppercase state token is rejected', () => {
  const s = sample();
  s.state = 'running_state';
  assert.throws(() => projectStatus(s), /INVALID_STATUS_STATE/);
});

test('invalid input: malformed approval reason code is rejected', () => {
  const s = sample();
  s.approval = { required: true, reason_code: 'disallowed lowercase code' };
  assert.throws(() => projectStatus(s), /INVALID_APPROVAL_CODE/);
});

test('no-leak: unwhitelisted metadata attributes are never retained in projection', () => {
  const s = sample();
  s.metadata.auth_token = 'SECRET_TOKEN_DO_NOT_LEAK';
  s.metadata.private_key = 'KEY_MATERIAL_LEAK_TARGET';
  const res = projectStatus(s, { view: 'debug' });
  const serialized = JSON.stringify(res);
  assert.equal(serialized.includes('SECRET_TOKEN_DO_NOT_LEAK'), false);
  assert.equal(serialized.includes('KEY_MATERIAL_LEAK_TARGET'), false);
});

test('no-leak: projectStatusSafe fails closed cleanly without raw leaks on non-object input', () => {
  const res = projectStatusSafe(null, { view: 'standard' });
  assert.equal(res.projection_failed, true);
  assert.equal(res.error_code, 'STATUS_OBJECT_REQUIRED');
  assert.equal(res.view, 'standard');
});

test('boundary: string artifact_ref is wrapped into canonical ref object structure', () => {
  const s = sample();
  s.unresolved_effect_refs = ['bundle://artifact/manifest.json'];
  const res = projectStatus(s, { view: 'standard' });
  assert.equal(res.unresolved_count, 1);
  assert.equal(res.unresolved_refs[0].ref, 'bundle://artifact/manifest.json');
});
