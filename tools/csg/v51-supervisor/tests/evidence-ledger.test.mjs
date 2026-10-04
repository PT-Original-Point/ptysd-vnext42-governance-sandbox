import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLocalEvidenceLedger} from '../lib/evidence-ledger.mjs';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v51-r2-ledger-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

function evidence() {
  return {
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    authority: {control_head: 'd39486601d851e31256852a24e9c1393b9046fe5', checkpoint_seq: 200},
    live_observation: {status: 'UNAVAILABLE', reason: 'NO_PROVIDER_ROUTE'},
    readiness: {units: [{id: 'C7', state: 'READY'}], selected: {decision: 'CONTINUE_READY', unit: 'C7'}},
    read_order: ['PROJECT_DIRECTORY', 'CURRENT_POINTER', 'MISSION_POLICY_CHECKPOINT_RUN_TASK_ATTEMPT_OWNER_EFFECTS',
      'FRESH_LIVE_PROVIDER_RUNTIME_OBSERVATION', 'READY_RECOMPUTED_FROM_FRESH_READS'],
    side_effects: {host_dispatch: false, host_mutation: false, canonical_write: false},
    mission_lifecycle_changed: false
  };
}

test('local continuity evidence is fsynced and exact repeats reuse the existing receipt', (t) => {
  const root = tempRoot(t);
  const ledger = createLocalEvidenceLedger(root);
  const first = ledger.append(evidence());
  const second = ledger.append(evidence());
  const lines = fs.readFileSync(ledger.filePath, 'utf8').trimEnd().split('\n');
  assert.equal(first.durable, true);
  assert.equal(first.existing, false);
  assert.equal(second.durable, true);
  assert.equal(second.existing, true);
  assert.equal(first.id, second.id);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).mission_lifecycle_changed, false);
});

test('a changed canonical observation appends a distinct local receipt', (t) => {
  const root = tempRoot(t);
  const ledger = createLocalEvidenceLedger(root);
  const first = evidence();
  const next = evidence();
  next.authority.checkpoint_seq = 201;
  assert.notEqual(ledger.append(first).id, ledger.append(next).id);
  assert.equal(fs.readFileSync(ledger.filePath, 'utf8').trimEnd().split('\n').length, 2);
});

test('ledger rejects truncated or malformed prior bytes instead of appending blindly', (t) => {
  const root = tempRoot(t);
  const ledger = createLocalEvidenceLedger(root);
  fs.writeFileSync(ledger.filePath, '{"schema":"partial"}', 'utf8');
  assert.throws(() => ledger.append(evidence()), {code: 'LOCAL_EVIDENCE_LEDGER_TRUNCATED'});
});

test('ledger rejects a wrong Project identity', (t) => {
  const ledger = createLocalEvidenceLedger(tempRoot(t));
  const bad = evidence();
  bad.project_id = 'OTHER_PROJECT';
  assert.throws(() => ledger.append(bad), {code: 'LOCAL_EVIDENCE_PROJECTION_INVALID'});
});

test('ledger rejects prior records whose content no longer matches the receipt digest', (t) => {
  const ledger = createLocalEvidenceLedger(tempRoot(t));
  ledger.append(evidence());
  const record = JSON.parse(fs.readFileSync(ledger.filePath, 'utf8').trimEnd());
  record.live_observation.status = 'REWRITTEN';
  fs.writeFileSync(ledger.filePath, `${JSON.stringify(record)}\n`, 'utf8');
  assert.throws(() => ledger.append(evidence()), {code: 'LOCAL_EVIDENCE_LEDGER_CORRUPT'});
});

test('ledger validates and persists exact-target verdicts separately from readiness state', (t) => {
  const ledger = createLocalEvidenceLedger(tempRoot(t));
  const result = evidence();
  result.readiness.evidence_records = [{
    verdict: 'LOCAL_TEST_PASS',
    target: {provider: 'LOCAL_WORKTREE', resource: 'tools/csg/v51-supervisor',
      revision: 'branch@cp200', content_manifest_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      covered_bytes: [{path: 'lib/reconcile.mjs',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}]},
    acceptance_contract: {id: 'C7_LOCAL', digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'},
    material_state_digest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    test_run: {run_id: 'local-test-1', command: 'node --test tests/c7.test.mjs', target_revision: 'branch@cp200',
      recorded_at: '2026-10-02T10:00:01Z',
      exit_code: 0, tests: 1, passed: 1, failed: 0}
  }];
  const receipt = ledger.append(result);
  const saved = JSON.parse(fs.readFileSync(ledger.filePath, 'utf8').trimEnd());
  assert.equal(receipt.durable, true);
  assert.equal(saved.readiness.evidence_records[0].verdict, 'LOCAL_TEST_PASS');
  assert.equal(saved.readiness.evidence_records[0].target.covered_bytes[0].path, 'lib/reconcile.mjs');
});

test('ledger refuses invalid evidence claims before append', (t) => {
  const ledger = createLocalEvidenceLedger(tempRoot(t));
  const result = evidence();
  result.readiness.evidence_records = [{verdict: 'SYSTEM_ACCEPTANCE_PASS', target: {}, acceptance_contract: {}}];
  assert.throws(() => ledger.append(result), {code: 'EVIDENCE_TARGET_IDENTITY_REQUIRED'});
  assert.equal(fs.existsSync(ledger.filePath), false);
});
