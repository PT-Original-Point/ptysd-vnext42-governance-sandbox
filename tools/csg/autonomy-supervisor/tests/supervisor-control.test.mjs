import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateSupervisorState} from '../lib/supervisor-control.mjs';

const fingerprint = {
  project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  directory: {head: 'd', revision: 5},
  control: {head: 'c', generation: 2},
  checkpoint: {seq: 192, digest: 'cp'},
  run: {id: 'r', attempt: 'a', epoch: 1},
  accepted_source: {head: 's'},
  mailbox: {comment_id: 4},
  factory: {readback: 'NOT_AVAILABLE_FROM_THIS_TASK'},
  runtime: {selected_path: 'node.exe', selected_sha256: 'n', node_version: 'v22.0.0'},
  supervisor_source: {script: 's'},
  workspace: {head: 'w', status: 'clean'}
};

test('production control bridge combines durable fingerprint and work scheduler', () => {
  const result = evaluateSupervisorState({
    fingerprint,
    units: [
      {id: 'blocked', state: 'WAITING_EXTERNAL', priority: 0},
      {id: 'ready', state: 'READY', priority: 4, retry_allowed: false}
    ]
  });
  assert.match(result.fingerprint_digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.scheduler, {decision: 'DISPATCH', unit: 'ready'});
});

test('control bridge CLI reads JSON and emits one deterministic decision', () => {
  const script = fileURLToPath(new URL('../lib/supervisor-control.mjs', import.meta.url));
  const input = JSON.stringify({fingerprint, units: [{id: 'one', state: 'READY', priority: 0}]});
  const run = spawnSync(process.execPath, [script], {input, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.schema, 'vnext5.autonomy-supervisor-control.v1');
  assert.match(result.fingerprint_digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.scheduler, {decision: 'DISPATCH', unit: 'one'});
});
