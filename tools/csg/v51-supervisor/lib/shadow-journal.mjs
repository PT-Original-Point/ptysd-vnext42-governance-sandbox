import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {canonicalJson} from './fingerprint.mjs';

const JOURNAL_NAME = 'runtime-shadow-journal.jsonl';
const JOURNAL_SCHEMA_V1 = 'VNEXT5_2_D02_RUNTIME_SHADOW_JOURNAL_V1';
const JOURNAL_SCHEMA = 'VNEXT5_2_D02_RUNTIME_SHADOW_JOURNAL_V2';
const PROJECTION_SCHEMA_V1 = 'VNEXT5_2_D02_RUNTIME_SHADOW_PROJECTION_V1';
const PROJECTION_SCHEMA = 'VNEXT5_2_D02_RUNTIME_SHADOW_PROJECTION_V2';
const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const CONTROL_REF = 'refs/heads/v45/factory-control';
const READ_ORDER = Object.freeze([
  'PROJECT_DIRECTORY',
  'CURRENT_POINTER',
  'MISSION_POLICY_CHECKPOINT_RUN_TASK_ATTEMPT_OWNER_EFFECTS',
  'FRESH_LIVE_PROVIDER_RUNTIME_OBSERVATION',
  'READY_RECOMPUTED_FROM_FRESH_READS'
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;
const MAX_LINE_BYTES = 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function digestJson(value) {
  return 'sha256:' + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function shadowProjection(result) {
  if (!isRecord(result) || result.project_id !== PROJECT_ID ||
      !isRecord(result.authority) || result.authority.project_id !== PROJECT_ID ||
      !isRecord(result.live_observation) || !isRecord(result.readiness) ||
      !isRecord(result.execution) || !isRecord(result.side_effects)) {
    fail('LOCAL_SHADOW_PROJECTION_INVALID');
  }

  const authority = result.authority;
  if (authority.canonical_state_fresh !== true || authority.control_ref !== CONTROL_REF ||
      !GIT_OID.test(authority.control_head || '') ||
      !Number.isSafeInteger(authority.checkpoint_seq) || authority.checkpoint_seq < 0 ||
      !SHA256.test(authority.checkpoint_digest || '') ||
      !text(authority.mission_revision) || !text(authority.policy_revision) ||
      !text(authority.run_id) || !text(authority.task_id) || !text(authority.attempt_id) ||
      !Number.isSafeInteger(authority.attempt_epoch) || authority.attempt_epoch < 0 ||
      !text(authority.owner_authority) || !text(authority.mission_lifecycle) ||
      typeof authority.stop_requested !== 'boolean') {
    fail('LOCAL_SHADOW_AUTHORITY_INVALID');
  }
  if (JSON.stringify(result.read_order) !== JSON.stringify(READ_ORDER)) {
    fail('LOCAL_SHADOW_FRESH_READ_ORDER_INVALID');
  }
  if (result.live_observation.status !== 'UNAVAILABLE' ||
      result.live_observation.attempted !== true ||
      result.live_observation.provider_read !== false ||
      result.live_observation.host_probe !== false ||
      result.live_observation.reason !== 'D02_SHADOW_HOST_PROBE_DISABLED') {
    fail('LOCAL_SHADOW_LIVE_OBSERVATION_INVALID');
  }
  const units = result.readiness.units;
  const planned = result.readiness.shadow_status;
  const expectedIds = planned?.expected_ids;
  const evaluatedIds = planned?.evaluated_ids;
  const readyIds = planned?.ready_ids;
  if (!Array.isArray(units) || !isRecord(result.readiness.selected) ||
      !isRecord(planned) || planned.mode !== 'SHADOW_PLAN_ONLY' ||
      planned.queue_scope !== 'FULL_CATALOG' ||
      !['COMPLETE', 'READINESS_INCOMPLETE'].includes(planned.input_completeness) ||
      !text(planned.planned_decision) || !text(planned.global_decision) ||
      !SHA256.test(planned.catalog_sha256 || '') ||
      !(planned.facts_sha256 === null || SHA256.test(planned.facts_sha256 || '')) ||
      !Array.isArray(expectedIds) || !Array.isArray(evaluatedIds) || !Array.isArray(readyIds) ||
      expectedIds.length !== units.length || evaluatedIds.length !== units.length ||
      new Set(expectedIds).size !== expectedIds.length ||
      JSON.stringify([...expectedIds].sort()) !== JSON.stringify([...evaluatedIds].sort()) ||
      JSON.stringify([...expectedIds].sort()) !== JSON.stringify(units.map((unit) => unit.id).sort()) ||
      readyIds.some((id) => !expectedIds.includes(id)) ||
      !isRecord(planned.side_effects) ||
      ['host_dispatch', 'host_mutation', 'canonical_write', 'local_work_dispatch']
        .some((key) => planned.side_effects[key] !== false) ||
      units.some((unit) => !isRecord(unit) || !text(unit.id) || !text(unit.state))) {
    fail('LOCAL_SHADOW_READINESS_INVALID');
  }
  if (result.execution.status !== 'PARKED' || !isRecord(result.execution.permit) ||
      result.execution.permit.allowed !== false ||
      result.execution.permit.reason !== 'NO_READY_UNIT_SELECTED' ||
      result.execution.unit_id !== null || result.execution.logical_work_fingerprint !== null ||
      result.execution_allowed === true) {
    fail('LOCAL_SHADOW_EXECUTION_INVALID');
  }
  for (const key of ['host_dispatch', 'host_mutation', 'canonical_write', 'local_work_dispatch']) {
    if (result.side_effects[key] !== false) fail('LOCAL_SHADOW_SIDE_EFFECT_FORBIDDEN');
  }
  if (result.mission_lifecycle_changed !== false) fail('LOCAL_SHADOW_MISSION_MUTATION_FORBIDDEN');
  if (!Array.isArray(result.stale_wake_fields_ignored) ||
      result.stale_wake_fields_ignored.some((field) => !text(field))) {
    fail('LOCAL_SHADOW_WAKE_FIELDS_INVALID');
  }

  return {
    schema: PROJECTION_SCHEMA,
    mode: 'SHADOW_ONLY',
    project_id: PROJECT_ID,
    authority: {
      control_ref: authority.control_ref,
      control_head: authority.control_head,
      checkpoint_seq: authority.checkpoint_seq,
      checkpoint_digest: authority.checkpoint_digest,
      mission_revision: authority.mission_revision,
      policy_revision: authority.policy_revision,
      run_id: authority.run_id,
      task_id: authority.task_id,
      attempt_id: authority.attempt_id,
      attempt_epoch: authority.attempt_epoch,
      owner_authority: authority.owner_authority,
      owner_lease_status: authority.owner_lease_status || 'UNKNOWN',
      owner_process_liveness: authority.owner_process_liveness || 'UNKNOWN',
      trusted_clock_observed_at_utc: authority.trusted_clock_observed_at_utc || null,
      trusted_clock_source: authority.trusted_clock_source || null,
      trusted_clock_uncertainty_seconds: authority.trusted_clock_uncertainty_seconds ?? null,
      mission_lifecycle: authority.mission_lifecycle,
      stop_requested: authority.stop_requested
    },
    live_observation: {
      status: 'UNAVAILABLE',
      attempted: true,
      provider_read: false,
      host_probe: false,
      reason: 'D02_SHADOW_HOST_PROBE_DISABLED'
    },
    readiness: {
      unit_count: units.length,
      decision: result.readiness.selected.decision,
      planned_decision: planned.planned_decision,
      planned_unit: planned.planned_unit || null,
      global_decision: planned.global_decision,
      input_completeness: planned.input_completeness,
      input_reasons: [...(planned.input_reasons || [])],
      catalog_sha256: planned.catalog_sha256,
      facts_sha256: planned.facts_sha256 || null,
      facts_fresh: planned.facts_fresh === true,
      expected_ids: [...expectedIds].sort(),
      evaluated_ids: [...evaluatedIds].sort(),
      ready_ids: [...readyIds].sort(),
      units: units.map((unit) => ({id: unit.id, state: unit.state, priority: unit.priority,
        reason: unit.reason || null, start_dependencies: [...(unit.start_dependencies || [])],
        completion_dependencies: [...(unit.completion_dependencies || [])],
        completion_blockers: [...(unit.completion_blockers || [])]})).sort((a, b) => a.id.localeCompare(b.id, 'en'))
    },
    execution: {
      unit_id: null,
      logical_work_fingerprint: null,
      status: 'PARKED',
      permit: {allowed: false, reason: 'NO_READY_UNIT_SELECTED'}
    },
    stale_wake_fields_ignored: [...result.stale_wake_fields_ignored].sort(),
    read_order: [...READ_ORDER],
    side_effects: {
      host_dispatch: false,
      host_mutation: false,
      canonical_write: false,
      local_work_dispatch: false
    },
    mission_lifecycle_changed: false
  };
}

function validateProjection(projection) {
  if (isRecord(projection) && projection.schema === PROJECTION_SCHEMA_V1) {
    if (projection.mode !== 'SHADOW_ONLY' || projection.project_id !== PROJECT_ID ||
        projection.live_observation?.status !== 'UNAVAILABLE' ||
        projection.live_observation?.reason !== 'D02_SHADOW_HOST_PROBE_DISABLED' ||
        projection.readiness?.unit_count !== 0 ||
        projection.readiness?.decision !== 'WAITING_EXTERNAL_NO_READY' ||
        projection.readiness?.shadow_status?.reason !== 'F01_ISOLATED_AGENT_ROUTE_NOT_PROVEN' ||
        projection.readiness?.shadow_status?.gate_unit_id !== 'D02_SHADOW_GATE' ||
        projection.execution?.status !== 'PARKED' || projection.execution?.permit?.allowed !== false ||
        projection.execution?.permit?.reason !== 'NO_READY_UNIT_SELECTED' ||
        projection.mission_lifecycle_changed !== false || !Array.isArray(projection.read_order) ||
        JSON.stringify(projection.read_order) !== JSON.stringify(READ_ORDER) ||
        !isRecord(projection.side_effects) ||
        ['host_dispatch', 'host_mutation', 'canonical_write', 'local_work_dispatch']
          .some((key) => projection.side_effects[key] !== false)) {
      fail('LOCAL_SHADOW_LEGACY_PROJECTION_INVALID');
    }
    return projection;
  }
  if (!isRecord(projection) || projection.schema !== PROJECTION_SCHEMA ||
      projection.mode !== 'SHADOW_ONLY' || projection.project_id !== PROJECT_ID ||
      projection.live_observation?.status !== 'UNAVAILABLE' ||
      projection.live_observation?.attempted !== true ||
      projection.live_observation?.provider_read !== false ||
      projection.live_observation?.host_probe !== false ||
      projection.live_observation?.reason !== 'D02_SHADOW_HOST_PROBE_DISABLED' ||
      !Number.isSafeInteger(projection.readiness?.unit_count) || projection.readiness.unit_count < 0 ||
      !['COMPLETE', 'READINESS_INCOMPLETE'].includes(projection.readiness?.input_completeness) ||
      !text(projection.readiness?.planned_decision) || !text(projection.readiness?.global_decision) ||
      !SHA256.test(projection.readiness?.catalog_sha256 || '') ||
      !(projection.readiness?.facts_sha256 === null || SHA256.test(projection.readiness?.facts_sha256 || '')) ||
      !Array.isArray(projection.readiness?.expected_ids) ||
      !Array.isArray(projection.readiness?.evaluated_ids) ||
      !Array.isArray(projection.readiness?.ready_ids) ||
      !Array.isArray(projection.readiness?.units) ||
      projection.readiness.units.length !== projection.readiness.unit_count ||
      JSON.stringify([...projection.readiness.expected_ids].sort()) !== JSON.stringify([...projection.readiness.evaluated_ids].sort()) ||
      JSON.stringify([...projection.readiness.expected_ids].sort()) !== JSON.stringify(projection.readiness.units.map((unit) => unit.id).sort()) ||
      projection.readiness.ready_ids.some((id) => !projection.readiness.expected_ids.includes(id)) ||
      projection.execution?.status !== 'PARKED' ||
      projection.execution?.permit?.allowed !== false ||
      projection.execution?.permit?.reason !== 'NO_READY_UNIT_SELECTED' ||
      projection.mission_lifecycle_changed !== false ||
      !Array.isArray(projection.read_order) ||
      JSON.stringify(projection.read_order) !== JSON.stringify(READ_ORDER) ||
      !isRecord(projection.side_effects) ||
      ['host_dispatch', 'host_mutation', 'canonical_write', 'local_work_dispatch']
        .some((key) => projection.side_effects[key] !== false)) {
    fail('LOCAL_SHADOW_PROJECTION_INVALID');
  }
  return projection;
}

function readEntries(filePath) {
  let fileStat;
  try {
    fileStat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) fail('LOCAL_SHADOW_JOURNAL_FILE_INVALID');
  const bytes = fs.readFileSync(filePath);
  if (bytes.length === 0) return [];
  let raw;
  try {
    raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    fail('LOCAL_SHADOW_JOURNAL_ENCODING_INVALID');
  }
  if (!raw.endsWith('\n')) fail('LOCAL_SHADOW_JOURNAL_TRUNCATED');
  const lines = raw.slice(0, -1).split('\n');
  let previousDigest = null;
  const entries = lines.map((line, index) => {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) fail('LOCAL_SHADOW_JOURNAL_RECORD_TOO_LARGE');
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      fail('LOCAL_SHADOW_JOURNAL_CORRUPT');
    }
    if (!isRecord(entry) || ![JOURNAL_SCHEMA_V1, JOURNAL_SCHEMA].includes(entry.schema) ||
        entry.sequence !== index + 1 || entry.previous_digest !== previousDigest ||
        !SHA256.test(entry.id || '') ||
        typeof entry.recorded_at !== 'string' || !Number.isFinite(Date.parse(entry.recorded_at))) {
      fail('LOCAL_SHADOW_JOURNAL_CHAIN_INVALID');
    }
    if (!isRecord(entry.projection) || digestJson(entry.projection) !== entry.id) {
      fail('LOCAL_SHADOW_JOURNAL_PROJECTION_DIGEST_INVALID');
    }
    const projection = validateProjection(entry.projection);
    if ((entry.schema === JOURNAL_SCHEMA_V1 && projection.schema !== PROJECTION_SCHEMA_V1) ||
        (entry.schema === JOURNAL_SCHEMA && projection.schema !== PROJECTION_SCHEMA)) {
      fail('LOCAL_SHADOW_JOURNAL_SCHEMA_PROJECTION_MISMATCH');
    }
    const {digest, ...unsigned} = entry;
    if (!SHA256.test(digest || '') || digestJson(unsigned) !== digest) {
      fail('LOCAL_SHADOW_JOURNAL_CHAIN_INVALID');
    }
    previousDigest = digest;
    return entry;
  });
  return entries;
}

export function createShadowJournal(root) {
  if (!text(root)) fail('LOCAL_SHADOW_STATE_DIRECTORY_REQUIRED');
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) fail('LOCAL_SHADOW_STATE_DIRECTORY_MISSING');
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('LOCAL_SHADOW_STATE_DIRECTORY_INVALID');
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const filePath = path.join(realRoot, JOURNAL_NAME);

  return Object.freeze({
    filePath,
    restore() {
      const entries = readEntries(filePath);
      const last = entries.at(-1) || null;
      return {
        status: entries.length === 0 ? 'EMPTY' : 'RESTORED',
        sequence: last?.sequence || 0,
        last_digest: last?.digest || null,
        records: entries
      };
    },
    append(result) {
      const projection = shadowProjection(result);
      const id = digestJson(projection);
      const before = readEntries(filePath);
      const existing = before.find((entry) => entry.id === id);
      if (existing) {
        return {durable: true, id, existing: true, sequence: existing.sequence, path: filePath};
      }

      const unsigned = {
        schema: JOURNAL_SCHEMA,
        sequence: before.length + 1,
        previous_digest: before.at(-1)?.digest || null,
        id,
        recorded_at: new Date().toISOString(),
        projection
      };
      const entry = {...unsigned, digest: digestJson(unsigned)};
      const line = JSON.stringify(entry) + '\n';
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) fail('LOCAL_SHADOW_JOURNAL_RECORD_TOO_LARGE');
      const fd = fs.openSync(filePath, 'a');
      try {
        fs.writeSync(fd, line, null, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      const after = readEntries(filePath);
      const persisted = after.at(-1);
      if (after.length !== before.length + 1 || persisted?.digest !== entry.digest ||
          persisted?.id !== id) fail('LOCAL_SHADOW_JOURNAL_READBACK_MISMATCH');
      return {durable: true, id, existing: false, sequence: entry.sequence, path: filePath};
    }
  });
}

export const D02_SHADOW_READ_ORDER = READ_ORDER;
