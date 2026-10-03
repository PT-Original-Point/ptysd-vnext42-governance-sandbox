import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLocalEvidenceLedger} from '../lib/evidence-ledger.mjs';
import {runSupervisor} from '../lib/supervisor.mjs';

const sha = (char) => `sha256:${char.repeat(64)}`;
const oid = (char) => char.repeat(40);

function snapshot() {
  const mission = {mission_revision_id: 'M1', mission_hash: sha('1')};
  const policy = {policy_revision_id: 'P1', policy_hash: sha('2')};
  const run = {path: 'runs/run.json', run_id: 'RUN1', active_task_id: 'TASK1', attempt_id: 'ATTEMPT1',
    attempt_epoch: 1, execution_owner: null, stop_requested: false, unresolved_operation_ids: []};
  const checkpoint = {path: 'checkpoints/000200.json', checkpoint_seq: 200, payload_digest: sha('3'),
    lifecycle: 'ACTIVE', recorded_at: '2026-09-30T02:52:35Z', owner: null, stop_requested: false,
    mission_anchor: {revision: 'M1', declared_hash: sha('1')},
    policy_anchor: {revision: 'P1', declared_hash: sha('2')}, run_ref: {path: 'runs/run.json'},
    task_id: 'TASK1', attempt_id: 'ATTEMPT1', attempt_epoch: 1, unresolved_effect_refs: []};
  const directory = {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', directory_revision: 5,
    control_locator: {ref: 'refs/heads/v45/factory-control', current_path: 'governance/csg/current.json'}};
  const pointer = {ref: 'refs/heads/v45/factory-control', path: 'governance/csg/current.json',
    control_head: oid('4'), checkpoint_seq: 200, checkpoint_path: 'checkpoints/000200.json', checkpoint_digest: sha('3')};
  return {project_directory: directory, pointer, mission, policy, checkpoint, run};
}

test('supervisor rereads authority each wake and reports only new durable evidence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v51-supervisor-loop-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const ledger = createLocalEvidenceLedger(root);
  const source = snapshot();
  const controller = new AbortController();
  const counts = {directory: 0, pointer: 0, canonical: 0, live: 0, ready: 0, evidence: 0, errors: 0, waits: 0};
  const result = await runSupervisor({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1',
    poll_interval_ms: 250, signal: controller.signal,
    onEvidence() { counts.evidence++; },
    onOperationalError() { counts.errors++; }
  }, {
    async readProjectDirectory(input) {
      counts.directory++;
      assert.deepEqual(input, {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'});
      return source.project_directory;
    },
    async readCurrentPointer() { counts.pointer++; return source.pointer; },
    async readCanonicalSnapshot() { counts.canonical++; return source; },
    async readLiveObservation() { counts.live++; return {status: 'UNAVAILABLE', reason: 'NO_FACTORY_ROUTE'}; },
    async recomputeReady() {
      counts.ready++;
      return {units: [{id: 'C1', state: 'WAITING_EXTERNAL', priority: 1}], recomputed_at: 'fixed'};
    },
    async appendLocalEvidence(result) { return ledger.append(result); },
    async wait() {
      counts.waits++;
      if (counts.waits === 2) controller.abort();
    }
  });

  assert.deepEqual(result.status, 'STOPPED_BY_PROCESS_SIGNAL');
  assert.equal(result.cycles, 2);
  assert.equal(result.evidence_deltas, 1);
  assert.deepEqual(counts, {directory: 2, pointer: 2, canonical: 2, live: 2, ready: 2,
    evidence: 1, errors: 0, waits: 2});
  assert.equal(fs.readFileSync(ledger.filePath, 'utf8').trimEnd().split('\n').length, 1);
});

test('supervisor fails closed on invalid polling configuration', async () => {
  const controller = new AbortController();
  await assert.rejects(runSupervisor({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'd',
    poll_interval_ms: 1, signal: controller.signal}, {appendLocalEvidence() {}, readProjectDirectory() {}}),
  {code: 'SUPERVISOR_POLL_INTERVAL_INVALID'});
});

test('supervisor honors GitHub Retry-After instead of hot-looping a rate-limited provider', async () => {
  const controller = new AbortController();
  const delays = [];
  let errors = 0;
  const ports = {
    async readProjectDirectory() {
      const error = new Error('rate limited');
      error.code = 'GITHUB_PROVIDER_WAITING_EXTERNAL';
      error.retry_after = '2';
      throw error;
    },
    async readCurrentPointer() { assert.fail('pointer must not be read after a directory wait'); },
    async readCanonicalSnapshot() { assert.fail('canonical data must not be read after a directory wait'); },
    async readLiveObservation() { assert.fail('live state must not be read without canonical authority'); },
    async recomputeReady() { assert.fail('READY must not be recomputed without canonical authority'); },
    async appendLocalEvidence() { return {durable: true, id: 'unused'}; },
    async wait(ms) { delays.push(ms); controller.abort(); }
  };
  const result = await runSupervisor({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1',
    poll_interval_ms: 250, signal: controller.signal,
    onOperationalError() { errors++; }
  }, ports);
  assert.equal(result.cycles, 1);
  assert.deepEqual(delays, [2000]);
  assert.equal(errors, 1);
});

test('supervisor exponentially backs off repeated identical local read failures', async () => {
  const controller = new AbortController();
  const delays = [];
  let errors = 0;
  const ports = {
    async readProjectDirectory() { throw Object.assign(new Error('temporary'), {code: 'TEMP_READ_FAILURE'}); },
    async readCurrentPointer() {},
    async readCanonicalSnapshot() {},
    async readLiveObservation() {},
    async recomputeReady() {},
    async appendLocalEvidence() { return {durable: true}; },
    async wait(ms) { delays.push(ms); if (delays.length === 3) controller.abort(); }
  };
  const result = await runSupervisor({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1',
    poll_interval_ms: 250, max_backoff_ms: 1000, signal: controller.signal,
    onOperationalError() { errors++; }
  }, ports);
  assert.equal(result.cycles, 3);
  assert.deepEqual(delays, [250, 500, 1000]);
  assert.equal(errors, 1);
});
