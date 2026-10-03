import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {evaluateOperationReadiness, operationCatalogDigest, OPERATION_FACTS_SCHEMA, sealOperationFacts} from '../lib/operation-planner.mjs';
import {selectNextUnit} from '../lib/scheduler.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../operation-plan.union-59.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-03T00:00:00.000Z');
const sha = (char) => `sha256:${char.repeat(64)}`;
const binding = {
  control_ref: 'refs/heads/v45/factory-control',
  control_head: 'a'.repeat(40),
  checkpoint_seq: 200,
  checkpoint_digest: sha('c')
};
const localEffects = new Set(['READ_ONLY', 'READ_ONLY_DIAGNOSTIC', 'CANDIDATE_SOURCE', 'LOCAL_SPIKE']);

function factsFor(overrides = {}, {drop = null, capturedAt = now.toISOString()} = {}) {
  const units = catalog.units.filter((unit) => unit.id !== drop).map((definition) => {
    const override = overrides[definition.id] || {};
    const state = override.state || (['B00.RECOVER', 'D01.DECISION', 'M02.LOCAL_CANARY', 'A00.ADMISSION'].includes(definition.id)
      ? 'DONE' : 'NOT_STARTED');
    const result = {
      id: definition.id,
      state,
      authorization_state: override.authorization_state ||
        (localEffects.has(definition.effect_class) ? 'AUTHORIZED' : 'NOT_ESTABLISHED'),
      evidence: override.evidence || (state === 'DONE' ? [{ref: `fixture:${definition.id}`,
        sha256: sha('a'), observed_at_utc: capturedAt}] : [])
    };
    if (override.reason || ['WAITING_EXTERNAL', 'WAITING_HUMAN', 'WAITING_REVIEW',
      'FAILED_RETRYABLE', 'FAILED_TERMINAL'].includes(state)) {
      result.reason = override.reason || 'SCOPED_FIXTURE_BLOCKER';
    }
    if (override.target_prestate) result.target_prestate = override.target_prestate;
    return result;
  });
  return sealOperationFacts({
    schema: OPERATION_FACTS_SCHEMA,
    catalog_sha256: operationCatalogDigest(catalog),
    captured_at_utc: capturedAt,
    freshness: {max_age_seconds: 3600, max_future_skew_seconds: 300},
    source_inventory: {ref: 'fixture:accepted-receipt-inventory', sha256: sha('b')},
    canonical_binding: binding,
    units
  });
}

function evaluate(facts) {
  return evaluateOperationReadiness({catalog, facts, authority: binding, now});
}

test('a parked F01 lane does not hide independently READY D02 source work', () => {
  const facts = factsFor({
    'B01.OPERATIONS': {state: 'DONE'},
    'F01.PREFLIGHT': {state: 'WAITING_EXTERNAL', reason: 'ISOLATED_AGENT_ROUTE_NOT_EXPOSED'}
  });
  const queue = evaluate(facts);
  assert.equal(queue.mode, 'SHADOW_PLAN_ONLY');
  assert.equal(queue.input_completeness, 'COMPLETE');
  assert.equal(queue.global_decision, 'READY_AVAILABLE');
  assert.equal(queue.planned_unit, 'D02.SOURCE');
  assert.ok(queue.ready_ids.includes('D02.SOURCE'));
  assert.equal(queue.units.find((unit) => unit.id === 'F01.ADAPTER_SOURCE').state, 'WAITING_EXTERNAL');
  assert.equal(queue.units.find((unit) => unit.id === 'F01.ADAPTER_SOURCE').reason, 'START_DEPENDENCIES_NOT_ACCEPTED');
  assert.deepEqual(queue.side_effects, {
    host_dispatch: false, host_mutation: false, canonical_write: false, local_work_dispatch: false
  });
});

test('fresh F01 route facts replan only the dependent lane while D02 remains READY', () => {
  const parked = evaluate(factsFor({
    'B01.OPERATIONS': {state: 'DONE'},
    'F01.PREFLIGHT': {state: 'WAITING_EXTERNAL', reason: 'ROUTE_NOT_EXPOSED'}
  }));
  const available = evaluate(factsFor({
    'B01.OPERATIONS': {state: 'DONE'},
    'F01.PREFLIGHT': {state: 'DONE'}
  }));
  assert.equal(parked.planned_unit, 'D02.SOURCE');
  assert.equal(available.planned_unit, 'D02.SOURCE');
  assert.ok(available.ready_ids.includes('F01.ADAPTER_SOURCE'));
  assert.notEqual(parked.facts_sha256, available.facts_sha256);
});

test('completion dependencies do not gate operation start readiness', () => {
  const facts = factsFor({
    'D02.SOURCE': {state: 'DONE'},
    'F01.ISOLATED_EXECUTION': {state: 'DONE'},
    'D02.PLAN_SHADOW': {state: 'NOT_STARTED'},
    'D02.LOCAL_RESTORE': {state: 'NOT_STARTED'}
  });
  const queue = evaluate(facts);
  const executor = queue.units.find((unit) => unit.id === 'D02.EXECUTOR_INTEGRATION');
  assert.deepEqual(executor.start_blockers, []);
  assert.deepEqual(executor.completion_blockers, ['D02.PLAN_SHADOW', 'D02.LOCAL_RESTORE']);
  assert.notEqual(executor.reason, 'COMPLETION_DEPENDENCIES_NOT_ACCEPTED');
});

test('missing or unknown unit facts park only their lane; shared completeness remains explicit', () => {
  const missing = evaluate(factsFor({}, {drop: 'F01.PREFLIGHT'}));
  assert.equal(missing.global_decision, 'READY_AVAILABLE');
  assert.equal(missing.input_completeness, 'READINESS_INCOMPLETE');
  assert.ok(missing.ready_ids.includes('B01.OPERATIONS'));
  assert.ok(!missing.ready_ids.includes('F01.PREFLIGHT'));

  const unknown = evaluate(factsFor({'F01.PREFLIGHT': {state: 'UNKNOWN', reason: 'ROUTE_UNKNOWN'}}));
  assert.equal(unknown.global_decision, 'READY_AVAILABLE');
  assert.ok(!unknown.ready_ids.includes('F01.PREFLIGHT'));
  assert.ok(unknown.input_reasons.some((reason) => reason.startsWith('UNIT_FACT_UNKNOWN:F01.PREFLIGHT')));
});

test('raw DONE cannot bypass a transitively unaccepted completion dependency', () => {
  const modified = structuredClone(catalog);
  modified.units.find(unit => unit.id === 'D01.DECISION').completion_dependencies = ['F01.PREFLIGHT'];
  const facts = factsFor({'B01.OPERATIONS': {state:'DONE'}});
  facts.catalog_sha256 = operationCatalogDigest(modified);
  const queue = evaluateOperationReadiness({catalog:modified,facts:sealOperationFacts(facts),authority:binding,now});
  assert.notEqual(queue.units.find(unit => unit.id === 'D01.DECISION').state, 'DONE');
  assert.ok(!queue.ready_ids.includes('D02.SOURCE'));
});

test('59 arbitrary or altered definitions never qualify as the full catalog', () => {
  const modified = structuredClone(catalog);
  modified.units[0].priority_hint += 1;
  const facts = factsFor();
  facts.catalog_sha256 = operationCatalogDigest(modified);
  const queue = evaluateOperationReadiness({catalog:modified,facts:sealOperationFacts(facts),authority:binding,now});
  assert.equal(queue.queue_scope, 'SUPPLIED_SUBSET');
  assert.equal(queue.global_exhaustion, 'NOT_EVALUATED');
});

test('stale facts do not produce an exhausted or READY verdict', () => {
  const stale = evaluate(factsFor({}, {capturedAt: '2026-10-02T00:00:00.000Z'}));
  assert.equal(stale.global_decision, 'READINESS_INCOMPLETE');
  assert.ok(stale.input_reasons.includes('FACTS_STALE_OR_CLOCK_INVALID'));
});

test('subset no-ready result is queue-local and never claims global exhaustion', () => {
  const subset = selectNextUnit([
    {id: 'F01.ISOLATED_EXECUTION', state: 'WAITING_EXTERNAL', reason: 'ROUTE_NOT_EXPOSED'}
  ]);
  assert.equal(subset.decision, 'WAITING_EXTERNAL_NO_READY');
  assert.equal(subset.queue_scope, 'SUPPLIED_SUBSET');
  assert.equal(subset.global_exhaustion, 'NOT_EVALUATED');
  assert.equal(Object.hasOwn(subset, 'all_legal_ready_lanes_exhausted'), false);
});
