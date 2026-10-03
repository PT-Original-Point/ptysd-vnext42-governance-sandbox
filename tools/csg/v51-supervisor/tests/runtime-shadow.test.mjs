import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createShadowJournal, D02_SHADOW_READ_ORDER} from '../lib/shadow-journal.mjs';
import {createShadowRuntime} from '../lib/shadow-runtime.mjs';
import {operationCatalogDigest, OPERATION_FACTS_SCHEMA, sealOperationFacts} from '../lib/operation-planner.mjs';
import {canonicalJson} from '../lib/fingerprint.mjs';

const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const CONTROL_REF = 'refs/heads/v45/factory-control';
const OPERATION_CATALOG = JSON.parse(fs.readFileSync(new URL('../operation-plan.union-59.json', import.meta.url), 'utf8'));

function sha(character) {
  return 'sha256:' + character.repeat(64);
}

function oid(character) {
  return character.repeat(40);
}

function canonicalFixture() {
  const checkpointPath = 'governance/csg/checkpoints/200.json';
  const runPath = 'governance/csg/runs/V51-R2-001.json';
  const directory = {
    project_id: PROJECT_ID,
    control_locator: {
      provider: 'github',
      ref: CONTROL_REF,
      current_path: 'governance/csg/current.json'
    }
  };
  const pointer = {
    project_id: PROJECT_ID,
    ref: CONTROL_REF,
    path: 'governance/csg/current.json',
    control_head: oid('a'),
    pointer_blob_oid: oid('b'),
    checkpoint_seq: 200,
    checkpoint_path: checkpointPath,
    checkpoint_digest: sha('c')
  };
  const checkpoint = {
    checkpoint_seq: 200,
    path: checkpointPath,
    payload_digest: sha('c'),
    mission_anchor: {revision: 'mission-r1', declared_hash: sha('d')},
    policy_anchor: {revision: 'policy-r1', declared_hash: sha('e')},
    run_ref: {path: runPath},
    task_id: 'task-1',
    attempt_id: 'attempt-1',
    attempt_epoch: 2,
    owner: null,
    lifecycle: 'ACTIVE',
    stop_requested: false,
    unresolved_effect_refs: []
  };
  const mission = {mission_revision_id: 'mission-r1', mission_hash: sha('d')};
  const policy = {policy_revision_id: 'policy-r1', policy_hash: sha('e')};
  const run = {
    path: runPath,
    run_id: 'V51-R2-001',
    active_task_id: 'task-1',
    attempt_id: 'attempt-1',
    attempt_epoch: 2,
    execution_owner: null,
    unresolved_operation_ids: []
  };
  return {directory, pointer, checkpoint, mission, policy, run};
}

function validOperationFacts(overrides = {}) {
  const capturedAt = '2026-10-03T00:00:00.000Z';
  const localEffects = new Set(['READ_ONLY', 'READ_ONLY_DIAGNOSTIC', 'CANDIDATE_SOURCE', 'LOCAL_SPIKE']);
  const units = OPERATION_CATALOG.units.map((definition) => {
    const override = overrides[definition.id] || {};
    const state = override.state || (['B00.RECOVER', 'D01.DECISION', 'M02.LOCAL_CANARY', 'A00.ADMISSION'].includes(definition.id)
      ? 'DONE' : 'NOT_STARTED');
    const fact = {
      id: definition.id,
      state,
      authorization_state: override.authorization_state ||
        (localEffects.has(definition.effect_class) ? 'AUTHORIZED' : 'NOT_ESTABLISHED'),
      evidence: override.evidence || (state === 'DONE' ? [{
        ref: `fixture:${definition.id}`,
        sha256: `sha256:${'a'.repeat(64)}`,
        observed_at_utc: capturedAt
      }] : [])
    };
    if (override.reason || (['WAITING_EXTERNAL', 'WAITING_HUMAN', 'WAITING_REVIEW',
      'FAILED_RETRYABLE', 'FAILED_TERMINAL'].includes(state))) {
      fact.reason = override.reason || 'FIXTURE_SCOPED_BLOCKER';
    }
    if (override.target_prestate) fact.target_prestate = override.target_prestate;
    return fact;
  });
  return sealOperationFacts({
    schema: OPERATION_FACTS_SCHEMA,
    catalog_sha256: operationCatalogDigest(OPERATION_CATALOG),
    captured_at_utc: capturedAt,
    freshness: {max_age_seconds: 3600, max_future_skew_seconds: 300},
    source_inventory: {ref: 'fixture:receipt-inventory', sha256: `sha256:${'b'.repeat(64)}`},
    canonical_binding: {
      control_ref: CONTROL_REF,
      control_head: oid('a'),
      checkpoint_seq: 200,
      checkpoint_digest: sha('c')
    },
    units
  });
}

function fakeReader(events = []) {
  const snapshot = canonicalFixture();
  return {
    async readProjectDirectory(wake) {
      events.push(['PROJECT_DIRECTORY', wake.project_id]);
      return snapshot.directory;
    },
    async readCurrentPointer(locator) {
      events.push(['CURRENT_POINTER', locator.ref]);
      return snapshot.pointer;
    },
    async readCanonicalSnapshot(directory, pointer) {
      events.push(['CANONICAL_SNAPSHOT', directory.project_id, pointer.checkpoint_seq]);
      return {
        checkpoint: snapshot.checkpoint,
        mission: snapshot.mission,
        policy: snapshot.policy,
        run: snapshot.run
      };
    }
  };
}

function tempStateDir(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext52-d02-shadow-'));
  t.after(() => fs.rmSync(stateDir, {recursive: true, force: true}));
  return stateDir;
}

function sampleShadowResult() {
  return {
    project_id: PROJECT_ID,
    authority: {
      project_id: PROJECT_ID,
      canonical_state_fresh: true,
      control_ref: CONTROL_REF,
      control_head: oid('a'),
      checkpoint_seq: 200,
      checkpoint_digest: sha('c'),
      mission_revision: 'mission-r1',
      policy_revision: 'policy-r1',
      run_id: 'V51-R2-001',
      task_id: 'task-1',
      attempt_id: 'attempt-1',
      attempt_epoch: 2,
      owner_authority: 'NONE',
      mission_lifecycle: 'ACTIVE',
      stop_requested: false
    },
    live_observation: {
      status: 'UNAVAILABLE',
      attempted: true,
      provider_read: false,
      host_probe: false,
      reason: 'D02_SHADOW_HOST_PROBE_DISABLED'
    },
    readiness: {
      units: [{
        id: 'B01.OPERATIONS',
        state: 'READY',
        priority: 1,
        start_dependencies: ['B00.RECOVER'],
        completion_dependencies: [],
        completion_blockers: []
      }],
      selected: {decision: 'WAITING_EXTERNAL_NO_READY'},
      shadow_status: {
        mode: 'SHADOW_PLAN_ONLY',
        state: 'READY_AVAILABLE',
        reason: null,
        planned_decision: 'CONTINUE_READY',
        planned_unit: 'B01.OPERATIONS',
        global_decision: 'READY_AVAILABLE',
        input_completeness: 'COMPLETE',
        input_reasons: [],
        catalog_sha256: `sha256:${'c'.repeat(64)}`,
        facts_sha256: `sha256:${'d'.repeat(64)}`,
        facts_fresh: true,
        queue_scope: 'FULL_CATALOG',
        expected_ids: ['B01.OPERATIONS'],
        evaluated_ids: ['B01.OPERATIONS'],
        ready_ids: ['B01.OPERATIONS'],
        side_effects: {host_dispatch: false, host_mutation: false, canonical_write: false,
          local_work_dispatch: false}
      }
    },
    execution: {
      unit_id: null,
      logical_work_fingerprint: null,
      status: 'PARKED',
      permit: {allowed: false, reason: 'NO_READY_UNIT_SELECTED'}
    },
    read_order: [...D02_SHADOW_READ_ORDER],
    stale_wake_fields_ignored: [],
    side_effects: {
      host_dispatch: false,
      host_mutation: false,
      canonical_write: false,
      local_work_dispatch: false
    },
    mission_lifecycle_changed: false
  };
}

function legacyJournalLine() {
  const projection = {
    schema: 'VNEXT5_2_D02_RUNTIME_SHADOW_PROJECTION_V1',
    mode: 'SHADOW_ONLY',
    project_id: PROJECT_ID,
    authority: {},
    live_observation: {status: 'UNAVAILABLE', reason: 'D02_SHADOW_HOST_PROBE_DISABLED'},
    readiness: {unit_count: 0, decision: 'WAITING_EXTERNAL_NO_READY', shadow_status: {
      state: 'WAITING_EXTERNAL', reason: 'F01_ISOLATED_AGENT_ROUTE_NOT_PROVEN', gate_unit_id: 'D02_SHADOW_GATE'}},
    execution: {unit_id: null, logical_work_fingerprint: null, status: 'PARKED',
      permit: {allowed: false, reason: 'NO_READY_UNIT_SELECTED'}},
    stale_wake_fields_ignored: [],
    read_order: [...D02_SHADOW_READ_ORDER],
    side_effects: {host_dispatch: false, host_mutation: false, canonical_write: false,
      local_work_dispatch: false},
    mission_lifecycle_changed: false
  };
  const digest = (value) => `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
  const unsigned = {schema: 'VNEXT5_2_D02_RUNTIME_SHADOW_JOURNAL_V1', sequence: 1,
    previous_digest: null, id: digest(projection), recorded_at: '2026-10-03T00:00:00.000Z', projection};
  return JSON.stringify({...unsigned, digest: digest(unsigned)}) + '\n';
}

test('shadow wake rereads canonical authority and persists a non-dispatching result', async (t) => {
  const stateDir = tempStateDir(t);
  const events = [];
  const runtime = createShadowRuntime({
    stateDir,
    reader: fakeReader(events),
    readOperationFacts: async () => validOperationFacts(),
    now: () => new Date('2026-10-03T00:00:00.000Z')
  });

  assert.equal(Object.hasOwn(runtime.ports, 'dispatchLocalWork'), false);
  const run = await runtime.runOnce();

  assert.deepEqual(events, [
    ['PROJECT_DIRECTORY', PROJECT_ID],
    ['CURRENT_POINTER', CONTROL_REF],
    ['CANONICAL_SNAPSHOT', PROJECT_ID, 200]
  ]);
  assert.deepEqual(run.result.read_order, D02_SHADOW_READ_ORDER);
  assert.equal(run.result.live_observation.status, 'UNAVAILABLE');
  assert.equal(run.result.live_observation.attempted, true);
  assert.equal(run.result.live_observation.provider_read, false);
  assert.equal(run.result.live_observation.reason, 'D02_SHADOW_HOST_PROBE_DISABLED');
  assert.equal(run.result.readiness.selected.decision, 'WAITING_EXTERNAL_NO_READY');
  assert.equal(run.result.readiness.shadow_status.global_decision, 'READY_AVAILABLE');
  assert.equal(run.result.readiness.shadow_status.planned_unit, 'B01.OPERATIONS');
  assert.equal(run.result.readiness.units.length, 59);
  assert.equal(run.result.execution.status, 'PARKED');
  assert.equal(run.result.execution_allowed, false);
  assert.deepEqual(run.result.side_effects, {
    host_dispatch: false,
    host_mutation: false,
    canonical_write: false,
    local_work_dispatch: false
  });
  assert.equal(run.result.mission_lifecycle_changed, false);
  assert.equal(run.result.persistence.status, 'DURABLE_LOCAL_PROJECTION');
  assert.equal(run.journal_readback.sequence, 1);
});

test('a fresh runtime restores its journal and deduplicates the same canonical shadow', async (t) => {
  const stateDir = tempStateDir(t);
  const events = [];
  const options = {
    stateDir,
    reader: fakeReader(events),
    readOperationFacts: async () => validOperationFacts(),
    now: () => new Date('2026-10-03T00:00:00.000Z')
  };
  const first = await createShadowRuntime(options).runOnce();
  const restarted = await createShadowRuntime(options).runOnce();

  assert.equal(first.journal_readback.sequence, 1);
  assert.equal(restarted.restored.status, 'RESTORED');
  assert.equal(restarted.restored.sequence, 1);
  assert.equal(restarted.result.persistence.new_record, false);
  assert.equal(restarted.journal_readback.sequence, 1);
  assert.equal(events.length, 6);
});

test('a journal written by a terminating child process restores after process restart', async (t) => {
  const stateDir = tempStateDir(t);
  const journalUrl = JSON.stringify(new URL('../lib/shadow-journal.mjs', import.meta.url).href);
  const resultText = JSON.stringify(sampleShadowResult());
  const script = [
    'import {createShadowJournal} from ' + journalUrl + ';',
    'const journal = createShadowJournal(process.env.D02_STATE_DIR);',
    'journal.append(' + resultText + ');',
    'process.exit(73);'
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {...process.env, D02_STATE_DIR: stateDir}
  });
  assert.equal(child.status, 73, child.stderr);

  const restored = createShadowJournal(stateDir).restore();
  assert.equal(restored.status, 'RESTORED');
  assert.equal(restored.sequence, 1);
  const duplicate = createShadowJournal(stateDir).append(sampleShadowResult());
  assert.equal(duplicate.existing, true);
  assert.equal(createShadowJournal(stateDir).restore().sequence, 1);
});

test('truncated and modified journal tails fail closed without repair', async (t) => {
  const truncatedDir = tempStateDir(t);
  const truncatedJournal = createShadowJournal(truncatedDir);
  truncatedJournal.append(sampleShadowResult());
  fs.appendFileSync(truncatedJournal.filePath, '{"schema":"partial"');
  assert.throws(() => truncatedJournal.restore(), {code: 'LOCAL_SHADOW_JOURNAL_TRUNCATED'});

  const modifiedDir = tempStateDir(t);
  const modifiedJournal = createShadowJournal(modifiedDir);
  modifiedJournal.append(sampleShadowResult());
  const modified = fs.readFileSync(modifiedJournal.filePath, 'utf8')
    .replace('B01.OPERATIONS', 'B01_MUTATED');
  fs.writeFileSync(modifiedJournal.filePath, modified, 'utf8');
  assert.throws(() => modifiedJournal.restore(), {code: 'LOCAL_SHADOW_JOURNAL_PROJECTION_DIGEST_INVALID'});
});

test('legacy V1 journal validates and remains in the chain when V2 evidence is appended', async (t) => {
  const stateDir = tempStateDir(t);
  const journal = createShadowJournal(stateDir);
  const legacy = legacyJournalLine();
  fs.writeFileSync(journal.filePath, legacy, 'utf8');

  const restored = journal.restore();
  assert.equal(restored.sequence, 1);
  assert.equal(restored.records[0].schema, 'VNEXT5_2_D02_RUNTIME_SHADOW_JOURNAL_V1');
  const appended = journal.append(sampleShadowResult());
  assert.equal(appended.sequence, 2);
  const after = journal.restore();
  assert.equal(after.sequence, 2);
  assert.equal(after.records[1].schema, 'VNEXT5_2_D02_RUNTIME_SHADOW_JOURNAL_V2');
  assert.equal(fs.readFileSync(journal.filePath, 'utf8').startsWith(legacy), true);
});

test('canonical read failure stops before producing a durable shadow receipt', async (t) => {
  const stateDir = tempStateDir(t);
  const reader = {
    async readProjectDirectory() {
      const error = new Error('READ_UNAVAILABLE');
      error.code = 'READ_UNAVAILABLE';
      throw error;
    },
    async readCurrentPointer() {
      throw new Error('MUST_NOT_READ_POINTER');
    },
    async readCanonicalSnapshot() {
      throw new Error('MUST_NOT_READ_SNAPSHOT');
    }
  };
  const runtime = createShadowRuntime({stateDir, reader});
  await assert.rejects(runtime.runOnce(), {code: 'READ_UNAVAILABLE'});
  assert.equal(runtime.journal.restore().status, 'EMPTY');
});

test('journal inspection CLI reads an empty journal without contacting GitHub or creating files', async (t) => {
  const stateDir = tempStateDir(t);
  const entrypoint = fileURLToPath(new URL('../bin/host-supervisor.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [
    entrypoint,
    '--inspect-journal',
    '--state-dir',
    stateDir
  ], {encoding: 'utf8'});

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'INSPECT_JOURNAL');
  assert.equal(output.status, 'EMPTY');
  assert.equal(output.record_count, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'runtime-shadow-journal.jsonl')), false);
});
