import {createHash} from 'node:crypto';
import {canonicalJson} from './fingerprint.mjs';
import {selectNextUnit} from './scheduler.mjs';

const FACTS_SCHEMA = 'vnext5.2.operation-facts.v1';
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const FACT_STATES = new Set([
  'DONE', 'NOT_STARTED', 'RUNNING', 'WAITING_EXTERNAL', 'WAITING_HUMAN',
  'WAITING_REVIEW', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'
]);
const LOCAL_EFFECTS = new Set(['READ_ONLY', 'CANDIDATE_SOURCE', 'LOCAL_SPIKE']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function factsPayload(facts) {
  const payload = structuredClone(facts);
  delete payload.facts_sha256;
  return payload;
}

export function operationCatalogDigest(catalog) {
  return sha256(canonicalJson(catalog));
}

export function sealOperationFacts(facts) {
  if (!record(facts)) fail('OPERATION_FACTS_RECORD_REQUIRED');
  const payload = factsPayload(facts);
  return {...payload, facts_sha256: sha256(canonicalJson(payload))};
}

function validEvidenceList(value) {
  return Array.isArray(value) && value.every((item) => record(item) &&
    typeof item.ref === 'string' && item.ref.trim() === item.ref && item.ref.length > 0 &&
    SHA256.test(item.sha256 || '') && Number.isFinite(Date.parse(item.observed_at_utc || '')));
}

function bindingMatches(binding, authority) {
  return record(binding) && record(authority) &&
    binding.control_ref === authority.control_ref &&
    binding.control_head === authority.control_head &&
    binding.checkpoint_seq === authority.checkpoint_seq &&
    binding.checkpoint_digest === authority.checkpoint_digest;
}

function inspectFacts({catalog, facts, authority, now}) {
  const expectedIds = catalog.units.map((unit) => unit.id).sort();
  const reasons = [];
  if (!record(facts) || facts.schema !== FACTS_SCHEMA) reasons.push('FACT_SCHEMA_UNKNOWN');
  if (!record(facts) || facts.catalog_sha256 !== operationCatalogDigest(catalog)) reasons.push('CATALOG_DIGEST_MISMATCH');
  if (!record(facts) || facts.facts_sha256 !== sha256(canonicalJson(factsPayload(facts)))) reasons.push('FACTS_DIGEST_INVALID');
  if (!record(facts?.source_inventory) || !SHA256.test(facts.source_inventory.sha256 || '') ||
      typeof facts.source_inventory.ref !== 'string' || !facts.source_inventory.ref.trim()) {
    reasons.push('SOURCE_INVENTORY_RECEIPT_INVALID');
  }
  if (!bindingMatches(facts?.canonical_binding, authority)) reasons.push('CANONICAL_BINDING_MISMATCH');
  const captured = Date.parse(facts?.captured_at_utc || '');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const maxAge = facts?.freshness?.max_age_seconds;
  const futureSkew = facts?.freshness?.max_future_skew_seconds;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 86400 ||
      !Number.isSafeInteger(futureSkew) || futureSkew < 0 || futureSkew > 300 ||
      !Number.isFinite(captured) || !Number.isFinite(nowMs) ||
      nowMs - captured > maxAge * 1000 || captured - nowMs > futureSkew * 1000) {
    reasons.push('FACTS_STALE_OR_CLOCK_INVALID');
  }
  const supplied = Array.isArray(facts?.units) ? facts.units : [];
  const suppliedIds = supplied.map((item) => item?.id).filter((id) => typeof id === 'string').sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(suppliedIds) ||
      new Set(suppliedIds).size !== suppliedIds.length) reasons.push('EXPECTED_EVALUATED_ID_SET_MISMATCH');
  const factById = new Map(supplied.filter((item) => record(item) && typeof item.id === 'string')
    .map((item) => [item.id, item]));
  for (const id of expectedIds) {
    const fact = factById.get(id);
    if (!fact || !FACT_STATES.has(fact.state) ||
        !['AUTHORIZED', 'NOT_ESTABLISHED', 'HUMAN_RESERVED', 'EXACT_PRESTATE_REQUIRED'].includes(fact.authorization_state) ||
        !validEvidenceList(fact.evidence || [])) {
      reasons.push(`UNIT_FACT_INVALID:${id}`);
    }
    if (fact?.state === 'UNKNOWN') reasons.push(`UNIT_FACT_UNKNOWN:${id}`);
    if (fact && ['WAITING_EXTERNAL', 'WAITING_HUMAN', 'WAITING_REVIEW',
      'FAILED_RETRYABLE', 'FAILED_TERMINAL'].includes(fact.state) &&
        (typeof fact.reason !== 'string' || fact.reason.trim() !== fact.reason || fact.reason.length === 0)) {
      reasons.push(`UNIT_FACT_REASON_MISSING:${id}`);
    }
    if (fact?.state === 'RUNNING' &&
        !['VALID', 'EXPIRED', 'UNKNOWN'].includes(fact.owner_authority)) {
      reasons.push(`UNIT_OWNER_AUTHORITY_UNKNOWN:${id}`);
    }
    if (fact?.state === 'DONE' && (!Array.isArray(fact.evidence) || fact.evidence.length === 0)) {
      reasons.push(`DONE_RECEIPT_MISSING:${id}`);
    }
  }
  return {expectedIds, factById, reasons, complete: reasons.length === 0};
}

export function evaluateOperationReadiness({catalog, facts, authority, now = new Date()}) {
  if (!record(catalog) || catalog.schema !== 'vnext5.2.operation-construction-plan.v2' ||
      !Array.isArray(catalog.units) || catalog.units.length === 0) fail('OPERATION_CATALOG_INVALID');
  const ids = catalog.units.map((unit) => unit?.id);
  if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    fail('OPERATION_CATALOG_IDS_INVALID');
  }
  const idSet = new Set(ids);
  for (const unit of catalog.units) {
    if (!Array.isArray(unit.start_dependencies) || !Array.isArray(unit.completion_dependencies) ||
        [...unit.start_dependencies, ...unit.completion_dependencies].some((id) => !idSet.has(id))) {
      fail(`OPERATION_CATALOG_DEPENDENCY_INVALID:${unit.id}`);
    }
  }

  const inspected = inspectFacts({catalog, facts, authority, now});
  const rawById = inspected.factById;
  const acceptedState = new Map();
  for (const unit of catalog.units) {
    const fact = rawById.get(unit.id);
    let state = fact?.state || 'UNKNOWN';
    let reason = fact?.reason || null;
    if (state === 'DONE') {
      const missing = unit.completion_dependencies.filter((id) => rawById.get(id)?.state !== 'DONE');
      if (missing.length > 0) {
        state = 'WAITING_EXTERNAL';
        reason = 'COMPLETION_DEPENDENCIES_NOT_ACCEPTED';
      }
    }
    acceptedState.set(unit.id, {state, reason});
  }

  const units = catalog.units.map((definition) => {
    const fact = rawById.get(definition.id);
    const current = acceptedState.get(definition.id);
    let state = current.state;
    let reason = current.reason;
    if (!inspected.complete) {
      state = state === 'DONE' ? 'DONE' : 'WAITING_EXTERNAL';
      reason ||= 'READINESS_INCOMPLETE';
    } else if (state === 'NOT_STARTED') {
      const unmet = definition.start_dependencies.filter((id) => acceptedState.get(id)?.state !== 'DONE');
      if (unmet.length > 0) {
        state = 'WAITING_EXTERNAL';
        reason = 'START_DEPENDENCIES_NOT_ACCEPTED';
      } else if (fact.authorization_state === 'HUMAN_RESERVED') {
        state = 'WAITING_HUMAN';
        reason = fact.reason || 'HUMAN_RESERVED_GATE';
      } else if (fact.authorization_state !== 'AUTHORIZED') {
        state = 'WAITING_EXTERNAL';
        reason = fact.reason || 'EXACT_OPERATION_AUTHORITY_NOT_ESTABLISHED';
      } else if (!LOCAL_EFFECTS.has(definition.effect_class) && definition.effect_class !== 'CANDIDATE_PUBLISH') {
        state = 'WAITING_EXTERNAL';
        reason = `EXACT_EFFECT_AUTHORITY_REQUIRED:${definition.effect_class}`;
      } else if (definition.effect_class === 'CANDIDATE_PUBLISH' && fact.target_prestate?.status !== 'FRESH_MATCHED') {
        state = 'WAITING_EXTERNAL';
        reason = 'EXACT_PROVIDER_TARGET_PRESTATE_REQUIRED';
      } else {
        state = 'READY';
        reason = null;
      }
    } else if (state === 'UNKNOWN') {
      state = 'WAITING_EXTERNAL';
      reason ||= 'READINESS_INCOMPLETE';
    }
    return {
      id: definition.id,
      state,
      priority: definition.priority_hint,
      mandatory: definition.mandatory === true,
      effect_class: definition.effect_class,
      start_dependencies: [...definition.start_dependencies],
      completion_dependencies: [...definition.completion_dependencies],
      start_blockers: definition.start_dependencies.filter((id) => acceptedState.get(id)?.state !== 'DONE'),
      completion_blockers: definition.completion_dependencies.filter((id) => acceptedState.get(id)?.state !== 'DONE'),
      ...(fact?.owner_authority ? {owner_authority: fact.owner_authority} : {}),
      ...(fact?.retry_allowed === true ? {retry_allowed: true,
        retry_budget_remaining: fact.retry_budget_remaining, effect_status: fact.effect_status} : {}),
      reason,
      execution_scope: 'SHADOW_PLAN_ONLY',
      effects: [],
      plan_only: true
    };
  });
  const ready = units.filter((unit) => unit.state === 'READY');
  const scheduled = selectNextUnit(units, {max_concurrency: 1});
  const globalDecision = !inspected.complete ? 'READINESS_INCOMPLETE'
    : ready.length > 0 ? 'READY_AVAILABLE'
      : 'GLOBAL_EXHAUSTED';
  return {
    schema: 'vnext5.2.operation-readiness.v1',
    mode: 'SHADOW_PLAN_ONLY',
    facts_schema: facts?.schema || null,
    catalog_sha256: operationCatalogDigest(catalog),
    facts_sha256: facts?.facts_sha256 || null,
    facts_fresh: inspected.complete,
    input_completeness: inspected.complete ? 'COMPLETE' : 'READINESS_INCOMPLETE',
    input_reasons: [...new Set(inspected.reasons)].sort(),
    expected_ids: inspected.expectedIds,
    evaluated_ids: units.map((unit) => unit.id).sort(),
    ready_ids: ready.map((unit) => unit.id).sort((a, b) => {
      const left = units.find((unit) => unit.id === a);
      const right = units.find((unit) => unit.id === b);
      return left.priority - right.priority || a.localeCompare(b, 'en');
    }),
    planned_decision: scheduled.decision,
    planned_unit: scheduled.unit || null,
    queue_scope: 'FULL_CATALOG',
    global_decision: globalDecision,
    units,
    side_effects: {host_dispatch: false, host_mutation: false, canonical_write: false, local_work_dispatch: false}
  };
}

export const OPERATION_FACTS_SCHEMA = FACTS_SCHEMA;
