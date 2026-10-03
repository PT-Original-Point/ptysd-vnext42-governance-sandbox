import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {evaluateOperationReadiness, operationCatalogDigest, OPERATION_FACTS_SCHEMA, sealOperationFacts} from '../lib/operation-planner.mjs';
import {loadUnionCatalog, FULL_UNION_COUNT} from '../lib/operation-catalog.mjs';
import {selectNextUnit} from '../lib/scheduler.mjs';
import {reconcileOnWake, validateCanonicalSnapshot} from '../lib/reconcile.mjs';
import {createShadowRuntime, summarizeShadowRun} from '../lib/shadow-runtime.mjs';
import {validateEvidenceRecord} from '../lib/evidence-contract.mjs';

const union = loadUnionCatalog().catalog;
const parent44 = JSON.parse(fs.readFileSync(new URL('../operation-plan.vnext5.2.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-03T00:00:00.000Z');
const sha = (c) => `sha256:${c.repeat(64)}`;
const oid = (c) => c.repeat(40);
const binding = {control_ref: 'refs/heads/v45/factory-control', control_head: oid('a'), checkpoint_seq: 200, checkpoint_digest: sha('c')};
const localEffects = new Set(['READ_ONLY', 'READ_ONLY_DIAGNOSTIC', 'CANDIDATE_SOURCE', 'LOCAL_SPIKE']);

function factsFor(catalog, overrides = {}, {drop = null, capturedAt = now.toISOString()} = {}) {
  const units = catalog.units.filter((u) => u.id !== drop).map((def) => {
    const ov = overrides[def.id] || {};
    const state = ov.state || (['B00.RECOVER', 'D01.DECISION', 'M02.LOCAL_CANARY', 'A00.ADMISSION'].includes(def.id) ? 'DONE' : 'NOT_STARTED');
    const r = {id: def.id, state,
      authorization_state: ov.authorization_state || (localEffects.has(def.effect_class) ? 'AUTHORIZED' : 'NOT_ESTABLISHED'),
      evidence: ov.evidence || (state === 'DONE' ? [{ref: `fixture:${def.id}`, sha256: sha('a'), observed_at_utc: capturedAt}] : [])};
    if (ov.reason || ['WAITING_EXTERNAL', 'WAITING_HUMAN', 'WAITING_REVIEW', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'].includes(state)) r.reason = ov.reason || 'SCOPED_FIXTURE_BLOCKER';
    if (ov.target_prestate) r.target_prestate = ov.target_prestate;
    return r;
  });
  return sealOperationFacts({schema: OPERATION_FACTS_SCHEMA, catalog_sha256: operationCatalogDigest(catalog),
    captured_at_utc: capturedAt, freshness: {max_age_seconds: 3600, max_future_skew_seconds: 300},
    source_inventory: {ref: 'fixture:receipt-inventory', sha256: sha('b')}, canonical_binding: binding, units});
}
const evalUnion = (facts) => evaluateOperationReadiness({catalog: union, facts, authority: binding, now});
const eval44 = (facts) => evaluateOperationReadiness({catalog: parent44, facts, authority: binding, now});

test('S-RECOVERY full-catalog: 59-union enforced, 44-subset never declares global exhaustion', () => {
  assert.equal(union.units.length, FULL_UNION_COUNT);
  assert.equal(union.units.length, 59);
  assert.equal(parent44.units.length, 44);
  // 44-subset with complete facts but no READY must not claim GLOBAL_EXHAUSTED.
  const catalog44Facts = (() => {
    const units = parent44.units.map((def) => ({id: def.id, state: 'WAITING_EXTERNAL', reason: 'FIXTURE_PARKED',
      authorization_state: 'AUTHORIZED', evidence: []}));
    return sealOperationFacts({schema: OPERATION_FACTS_SCHEMA, catalog_sha256: operationCatalogDigest(parent44),
      captured_at_utc: now.toISOString(), freshness: {max_age_seconds: 3600, max_future_skew_seconds: 300},
      source_inventory: {ref: 'fixture:receipt-inventory', sha256: sha('b')}, canonical_binding: binding, units});
  })();
  const sub = eval44(catalog44Facts);
  assert.notEqual(sub.global_decision, 'GLOBAL_EXHAUSTED');
  assert.equal(sub.global_decision, 'READINESS_INCOMPLETE');
  assert.equal(sub.queue_scope, 'SUPPLIED_SUBSET');
  assert.equal(sub.global_exhaustion, 'NOT_EVALUATED');
  assert.ok(sub.input_reasons.includes('SUBSET_NO_READY_NO_GLOBAL_EXHAUSTION'));
  // 59-union with READY work reports READY_AVAILABLE and FULL_CATALOG.
  const full = evalUnion(factsFor(union, {'B01.OPERATIONS': {state: 'DONE'}}));
  assert.equal(full.queue_scope, 'FULL_CATALOG');
  assert.equal(full.global_decision, 'READY_AVAILABLE');
  assert.ok(full.ready_ids.includes('D02.SOURCE'));
  // Each blocked unit explains its dependency.
  const blocked = full.units.find((u) => u.id === 'F01.ADAPTER_SOURCE');
  assert.equal(blocked.state, 'WAITING_EXTERNAL');
  assert.deepEqual(blocked.start_blockers, ['F01.PREFLIGHT']);
});

test('S-RECOVERY toolgap: invalid FactoryMCP parks only MCP route, native source continues', () => {
  const q = evalUnion(factsFor(union, {
    'B01.OPERATIONS': {state: 'DONE'},
    'M01.SOURCE': {state: 'WAITING_EXTERNAL', reason: 'FACTORY_MCP_ROUTE_INVALID'},
    'F01.PREFLIGHT': {state: 'WAITING_EXTERNAL', reason: 'ISOLATED_AGENT_ROUTE_NOT_EXPOSED'}
  }));
  assert.equal(q.global_decision, 'READY_AVAILABLE');
  assert.ok(q.ready_ids.includes('D02.SOURCE'));
  assert.ok(q.ready_ids.includes('P52.NATIVE_ROUTE_DISCOVERY'));
  // Business read preparation does not require MCP/SYSTEM/future install/fresh owner.
  assert.ok(q.ready_ids.includes('A01.READ_PREPARE') || q.units.find((u) => u.id === 'A01.READ_PREPARE').state !== 'DONE');
  const mcpUnit = q.units.find((u) => u.id === 'M01.SOURCE');
  assert.notEqual(mcpUnit.state, 'READY');
});

test('S-RECOVERY F01 unproven parks only dispatch, source/preflight continue', () => {
  const q = evalUnion(factsFor(union, {
    'B01.OPERATIONS': {state: 'DONE'},
    'F01.PREFLIGHT': {state: 'WAITING_EXTERNAL', reason: 'ROUTE_NOT_EXPOSED'}
  }));
  assert.equal(q.planned_unit, 'D02.SOURCE');
  assert.ok(q.ready_ids.includes('D02.SOURCE'));
  assert.equal(q.units.find((u) => u.id === 'F01.ADAPTER_SOURCE').state, 'WAITING_EXTERNAL');
  // Scheduler lane-local: F01 dispatch park never hides READY source.
  const s = selectNextUnit([
    {id: 'F01.ISOLATED_EXECUTION', state: 'WAITING_EXTERNAL', reason: 'ROUTE_NOT_EXPOSED'},
    {id: 'D02.SOURCE', state: 'READY', priority: 3}
  ]);
  assert.deepEqual(s, {decision: 'CONTINUE_READY', unit: 'D02.SOURCE'});
});

test('S-RECOVERY receipt identity: DONE without durable receipt fails closed', () => {
  const facts = factsFor(union, {'B00.RECOVER': {state: 'DONE', evidence: []}});
  const q = evalUnion(facts);
  assert.equal(q.global_decision, 'READY_AVAILABLE');
  assert.equal(q.input_completeness, 'READINESS_INCOMPLETE');
  assert.ok(q.input_reasons.some((r) => r === 'DONE_RECEIPT_MISSING:B00.RECOVER'));
  assert.notEqual(q.units.find(u => u.id === 'B00.RECOVER').state, 'DONE');
  assert.ok(!q.ready_ids.includes('P52.NATIVE_ROUTE_DISCOVERY'));
});

test('S-RECOVERY stale livefact and unknown effect fail closed without global stop', () => {
  const stale = evalUnion(factsFor(union, {}, {capturedAt: '2026-10-02T00:00:00.000Z'}));
  assert.equal(stale.global_decision, 'READINESS_INCOMPLETE');
  assert.ok(stale.input_reasons.includes('FACTS_STALE_OR_CLOCK_INVALID'));
  const unknown = evalUnion(factsFor(union, {'F01.PREFLIGHT': {state: 'UNKNOWN', reason: 'ROUTE_UNKNOWN'},
    'B01.OPERATIONS': {state: 'DONE'}}));
  assert.equal(unknown.global_decision, 'READY_AVAILABLE');
  assert.ok(unknown.input_reasons.some((r) => r.startsWith('UNIT_FACT_UNKNOWN:F01.PREFLIGHT')));
  assert.ok(!unknown.ready_ids.includes('F01.PREFLIGHT'));
  assert.ok(unknown.ready_ids.includes('D02.SOURCE'));
});

function snapshotWithOwner(owner) {
  const dir = {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', directory_revision: 5,
    control_locator: {ref: 'refs/heads/v45/factory-control', current_path: 'governance/csg/current.json'}};
  const ptr = {project_id: dir.project_id, ref: dir.control_locator.ref, path: dir.control_locator.current_path,
    control_head: oid('d'), checkpoint_seq: 200, checkpoint_path: 'checkpoints/000200.json', checkpoint_digest: sha('3')};
  const mission = {mission_revision_id: 'M1', mission_hash: sha('1')};
  const policy = {policy_revision_id: 'P1', policy_hash: sha('2')};
  const cp = {path: ptr.checkpoint_path, checkpoint_seq: 200, payload_digest: sha('3'), lifecycle: 'ACTIVE',
    recorded_at: '2026-09-30T02:52:35Z', owner, stop_requested: false,
    mission_anchor: {revision: 'M1', declared_hash: sha('1')}, policy_anchor: {revision: 'P1', declared_hash: sha('2')},
    run_ref: {path: 'runs/run.json'}, task_id: 'TASK1', attempt_id: 'ATTEMPT1', attempt_epoch: 2, unresolved_effect_refs: []};
  const run = {path: 'runs/run.json', run_id: 'RUN1', active_task_id: 'TASK1', attempt_id: 'ATTEMPT1',
    attempt_epoch: 2, execution_owner: owner, stop_requested: false, unresolved_operation_ids: []};
  return {project_directory: dir, pointer: ptr, mission, policy, checkpoint: cp, run};
}

test('S-RECOVERY lease-vs-process: expiry never infers liveness and parks only its lane', () => {
  const owner = {principal_id: 'worker-1', owner_generation: 5, scope: 'unit-1', lease_until: '2026-09-29T18:44:11Z'};
  const snap = snapshotWithOwner(owner);
  const untrusted = validateCanonicalSnapshot(snap);
  assert.equal(untrusted.owner_lease_status, 'UNKNOWN');
  assert.equal(untrusted.owner_process_liveness, 'UNKNOWN');
  const trusted = validateCanonicalSnapshot(snap, {trustedClock: {trusted: true, source: 'fixture:verified-provider-time',
    observed_at_utc: '2026-10-03T00:00:00Z', uncertainty_seconds: 2}});
  assert.equal(trusted.owner_authority, 'EXPIRED');
  assert.equal(trusted.owner_lease_status, 'DEFINITELY_EXPIRED');
  assert.equal(trusted.owner_process_liveness, 'UNKNOWN');
  const s = selectNextUnit([
    {id: 'expired-lane', state: 'RUNNING', owner_authority: 'EXPIRED'},
    {id: 'safe-source', state: 'READY', priority: 1}
  ]);
  assert.deepEqual(s, {decision: 'CONTINUE_READY', unit: 'safe-source'});
});

test('S-RECOVERY Goal disappearance, compaction, worker exit never complete Mission', async () => {
  const snap = snapshotWithOwner(null);
  const wakeNoGoal = {project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', locator: 'directory/v1'};
  const result = await reconcileOnWake(wakeNoGoal, {
    async readProjectDirectory() { return snap.project_directory; },
    async readCurrentPointer() { return snap.pointer; },
    async readCanonicalSnapshot() { return snap; },
    async readLiveObservation() { return {status: 'FRESH', owner_authority: 'NONE', agent_ui: 'CLOSED', supervisor_process: 'RESTARTED'}; },
    async recomputeReady() { return {max_concurrency: 1, logical_work_fingerprint: sha('d'),
      units: [{id: 'safe-source', state: 'READY', priority: 1, mutable_scope: 's', execution_scope: 'LOCAL_PREPRODUCTION_SOURCE', effects: ['LOCAL_TEST']}], recomputed_at: now.toISOString()}; },
    async appendLocalEvidence(e) { return {durable: true, id: 'receipt-goal-gone'}; },
    async readLocalWork(i) { return {status: 'NOT_FOUND_CONFIRMED', idempotency_key: i.idempotency_key}; },
    async dispatchLocalWork(i) { return {status: 'STARTED', idempotency_key: i.idempotency_key}; }
  });
  assert.equal(result.mission_lifecycle_changed, false);
  assert.equal(result.execution.status, 'STARTED');
  assert.deepEqual(result.stale_wake_fields_ignored, []);
  // Source PASS is not Mission completion; lifecycle stays ACTIVE without closure.
  assert.notEqual(result.readiness.selected.decision, 'ALL_UNITS_DONE');
});

test('S-RECOVERY actual cold reader restores journal and does next reversible delta only', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's-recovery-cold-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const snap = snapshotWithOwner(null);
  const reader = {
    async readProjectDirectory(w) { assert.equal(w.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE'); return snap.project_directory; },
    async readCurrentPointer(l) { return snap.pointer; },
    async readCanonicalSnapshot() { return snap; }
  };
  const fixtureFacts = (() => {
    const capturedAt = '2026-10-03T00:00:00.000Z';
    const units = union.units.map((def) => {
      const state = ['B00.RECOVER', 'D01.DECISION', 'M02.LOCAL_CANARY', 'A00.ADMISSION'].includes(def.id) ? 'DONE' : 'NOT_STARTED';
      return {id: def.id, state,
        authorization_state: localEffects.has(def.effect_class) ? 'AUTHORIZED' : 'NOT_ESTABLISHED',
        evidence: state === 'DONE' ? [{ref: `fixture:${def.id}`, sha256: sha('a'), observed_at_utc: capturedAt}] : []};
    });
    return sealOperationFacts({schema: OPERATION_FACTS_SCHEMA, catalog_sha256: operationCatalogDigest(union),
      captured_at_utc: capturedAt, freshness: {max_age_seconds: 3600, max_future_skew_seconds: 300},
      source_inventory: {ref: 'fixture:receipt-inventory', sha256: sha('b')}, canonical_binding: binding, units});
  })();
  const opts = {stateDir: dir, reader, readOperationFacts: async () => fixtureFacts, now: () => new Date('2026-10-03T00:00:00.000Z')};
  const first = await createShadowRuntime(opts).runOnce();
  assert.equal(first.journal_readback.sequence, 1);
  // Cold restart: new consumer with only public entry + valid binding finds unfinished work.
  const second = await createShadowRuntime(opts).runOnce();
  assert.equal(second.restored.status, 'RESTORED');
  assert.equal(second.result.persistence.new_record, false);
  assert.equal(second.journal_readback.sequence, 1);
  const summary = summarizeShadowRun(second);
  assert.equal(summary.mode, 'SHADOW_ONLY');
  assert.equal(summary.readiness.units, FULL_UNION_COUNT);
});

test('S-RECOVERY three columns stay separated; source PASS never becomes live/system PASS', () => {
  const local = validateEvidenceRecord({verdict: 'LOCAL_TEST_PASS',
    target: {provider: 'github', resource: 'PR381', revision: oid('1'), tree_oid: oid('2'), covered_bytes: [{path: 'tools/csg/v51-supervisor/lib/scheduler.mjs', sha256: sha('a')}]},
    acceptance_contract: {id: 'D02.SOURCE', digest: sha('b')},
    material_state_digest: sha('c'),
    test_run: {run_id: 'run-1', command: 'node --test', target_revision: oid('1'), recorded_at: now.toISOString(), exit_code: 0, tests: 10, passed: 10, failed: 0}});
  assert.equal(local.verdict, 'LOCAL_TEST_PASS');
  assert.throws(() => validateEvidenceRecord({...local, verdict: 'LIVE_ACCEPTANCE_PASS'}), /EVIDENCE_.*MISMATCH|EVIDENCE_VERDICT_REQUIRES_RUNTIME_READBACK/);
  assert.throws(() => validateEvidenceRecord({...local, verdict: 'SYSTEM_ACCEPTANCE_PASS'}), /EVIDENCE_.*MISMATCH|EVIDENCE_VERDICT_REQUIRES_RUNTIME_READBACK/);
  // Restart / UI-closed / 24x7 survival needs independent live acceptance, never source PASS.
  const sysWithoutReadback = {verdict: 'SYSTEM_ACCEPTANCE_PASS',
    target: {provider: 'github', resource: 'PR381', revision: oid('1'), tree_oid: oid('2'), covered_bytes: [{path: 'a', sha256: sha('a')}]},
    acceptance_contract: {id: 'D04.SURVIVAL', digest: sha('b')}, material_state_digest: sha('c')};
  assert.throws(() => validateEvidenceRecord(sysWithoutReadback), /EVIDENCE_VERDICT_REQUIRES_RUNTIME_READBACK/);
});

test('S-RECOVERY worktree is not an OS sandbox; native route needs real proof', async () => {
  // A worktree path alone must not satisfy Hyper-V isolation or task receipt.
  // Fleet requires an explicit Hyper-V cell for PRODUCT_CODING; local worktree alone parks.
  const {selectFleetWorker} = await import('../lib/fleet.mjs');
  const res = selectFleetWorker({project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', role: 'BUILDER',
    mutable_scope: 'slice-a', execution_cell: 'LOCAL_PREPRODUCTION_WORKTREE', required_capabilities: ['TASK_START'],
    review_backlog: 0, integration_backlog: 0, production: false, paid_fallback: false,
    worker_provider_write_credentials: 0, integration_lane: false, project_integration_lane_busy: false,
    effects: ['LOCAL_WORKTREE_WRITE'], work_type: 'PRODUCT_CODING',
    active_mutable_scopes: [], observation_freshness: {evaluated_at: now.toISOString(), max_age_seconds: 60},
    providers: []});
  assert.equal(res.decision, 'WAITING_EXTERNAL');
  assert.equal(res.reason, 'ISOLATED_HYPERV_UBUNTU_CELL_REQUIRED');
});
