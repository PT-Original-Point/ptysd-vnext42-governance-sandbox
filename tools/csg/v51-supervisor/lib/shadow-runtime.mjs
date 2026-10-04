import fs from 'node:fs';
import path from 'node:path';
import {createGitHubReadOnlyReader} from './github-readonly.mjs';
import {evaluateOperationReadiness, operationCatalogDigest} from './operation-planner.mjs';
import {loadUnionCatalog, FULL_UNION_COUNT, UNION_CANONICAL_DIGEST} from './operation-catalog.mjs';
import {reconcileOnWake} from './reconcile.mjs';
import {createShadowJournal} from './shadow-journal.mjs';

const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const DIRECTORY_LOCATOR = 'directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json';
// S-RECOVERY: the shadow always evaluates the full 59-operation union.
// The 44-unit parent file remains the provenance base; the union file carries
// the 15 P52 units plus required parent adjustments. Single-slice subsets
// must never declare global exhaustion.
const UNION_CATALOG_URL = new URL('../operation-plan.union-59.json', import.meta.url);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function ensureShadowStateDirectory(stateDir) {
  if (typeof stateDir !== 'string' || stateDir.trim() !== stateDir || !path.isAbsolute(stateDir)) {
    fail('LOCAL_SHADOW_ABSOLUTE_STATE_DIRECTORY_REQUIRED');
  }
  const resolved = path.resolve(stateDir);
  fs.mkdirSync(resolved, {recursive: true});
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('LOCAL_SHADOW_STATE_DIRECTORY_INVALID');
  return fs.realpathSync(resolved);
}

function assertShadowOnly(result) {
  if (result.execution_allowed !== false || result.execution?.status !== 'PARKED' ||
      result.mission_lifecycle_changed !== false ||
      result.side_effects?.host_dispatch !== false ||
      result.side_effects?.host_mutation !== false ||
      result.side_effects?.canonical_write !== false ||
      result.side_effects?.local_work_dispatch !== false ||
      result.live_observation?.status !== 'UNAVAILABLE' ||
      result.live_observation?.attempted !== true ||
      result.live_observation?.provider_read !== false ||
      result.live_observation?.host_probe !== false ||
      result.live_observation?.reason !== 'D02_SHADOW_HOST_PROBE_DISABLED' ||
      result.readiness?.shadow_status?.mode !== 'SHADOW_PLAN_ONLY' ||
      result.readiness?.shadow_status?.side_effects?.host_dispatch !== false ||
      result.readiness?.shadow_status?.side_effects?.host_mutation !== false ||
      result.readiness?.shadow_status?.side_effects?.canonical_write !== false ||
      result.readiness?.shadow_status?.side_effects?.local_work_dispatch !== false) {
    fail('D02_SHADOW_ONLY_INVARIANT_VIOLATION');
  }
}

export function createShadowRuntime({stateDir, reader = createGitHubReadOnlyReader(),
  now = () => new Date(), operationFactsPath = null,
  readOperationFacts = null, readTrustedClock = null} = {}) {
  if (!reader || typeof reader.readProjectDirectory !== 'function' ||
      typeof reader.readCurrentPointer !== 'function' ||
      typeof reader.readCanonicalSnapshot !== 'function') {
    fail('D02_READ_ONLY_READER_REQUIRED');
  }
  if (typeof now !== 'function') fail('D02_CLOCK_PORT_INVALID');
  const journal = createShadowJournal(stateDir);
  // Validate the full union once at construction; fail closed on drift.
  // The loader checks parent raw SHA, 59-count, DAG acyclic, required
  // parent adjustments, and union canonical digest. No second registry,
  // journal, or dispatcher is created here.
  loadUnionCatalog();
  const catalog = JSON.parse(fs.readFileSync(UNION_CATALOG_URL, 'utf8'));
  if (!Array.isArray(catalog.units) || catalog.units.length !== FULL_UNION_COUNT) {
    fail('OPERATION_UNION_COUNT_INVALID');
  }
  const resolvedFactsPath = operationFactsPath === null
    ? path.join(path.resolve(stateDir), 'operation-facts.json') : operationFactsPath;
  if (typeof resolvedFactsPath !== 'string' || !path.isAbsolute(resolvedFactsPath)) {
    fail('D02_OPERATION_FACTS_ABSOLUTE_PATH_REQUIRED');
  }
  const readFacts = readOperationFacts || (() => {
    try {
      const stat = fs.lstatSync(resolvedFactsPath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail('D02_OPERATION_FACTS_FILE_INVALID');
      return JSON.parse(fs.readFileSync(resolvedFactsPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  });
  if (typeof readFacts !== 'function') fail('D02_OPERATION_FACTS_PORT_INVALID');
  const readClock = readTrustedClock || (async () => ({
    trusted: false,
    source: 'TRUSTED_CLOCK_PORT_NOT_CONFIGURED'
  }));
  if (typeof readClock !== 'function') fail('D02_TRUSTED_CLOCK_PORT_INVALID');
  const ports = Object.freeze({
    shadowOnly: true,
    readTrustedClock: () => readClock(),
    readProjectDirectory(wake) {
      return reader.readProjectDirectory(wake);
    },
    readCurrentPointer(locator) {
      return reader.readCurrentPointer(locator);
    },
    readCanonicalSnapshot(directory, pointer) {
      return reader.readCanonicalSnapshot(directory, pointer);
    },
    async readLiveObservation() {
      return {status: 'UNAVAILABLE', attempted: true, provider_read: false, host_probe: false,
        reason: 'D02_SHADOW_HOST_PROBE_DISABLED'};
    },
    async recomputeReady({authority, snapshot, liveObservation}) {
      const observedAt = now();
      if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
        fail('D02_CLOCK_VALUE_INVALID');
      }
      const facts = await readFacts({authority, snapshot, liveObservation});
      const planned = evaluateOperationReadiness({catalog, facts, authority, now: observedAt});
      return {
        units: planned.units,
        max_concurrency: 1,
        shadow_status: {
          mode: planned.mode,
          state: planned.global_decision,
          reason: planned.input_reasons[0] || null,
          planned_decision: planned.planned_decision,
          planned_unit: planned.planned_unit,
          global_decision: planned.global_decision,
          input_completeness: planned.input_completeness,
          input_reasons: planned.input_reasons,
          queue_scope: planned.queue_scope,
          catalog_sha256: planned.catalog_sha256,
          facts_sha256: planned.facts_sha256,
          facts_fresh: planned.facts_fresh,
          expected_ids: planned.expected_ids,
          evaluated_ids: planned.evaluated_ids,
          ready_ids: planned.ready_ids,
          side_effects: planned.side_effects
        },
        recomputed_at: observedAt.toISOString(),
        canonical_state_fresh: authority.canonical_state_fresh === true,
        operation_catalog_sha256: operationCatalogDigest(catalog)
      };
    },
    appendLocalEvidence(result) {
      return journal.append(result);
    }
  });

  return Object.freeze({
    journal,
    ports,
    async runOnce() {
      const restored = journal.restore();
      const result = await reconcileOnWake({
        project_id: PROJECT_ID,
        locator: DIRECTORY_LOCATOR
      }, ports);
      assertShadowOnly(result);
      const readback = journal.restore();
      if (result.persistence?.status !== 'DURABLE_LOCAL_PROJECTION' ||
          readback.sequence < restored.sequence ||
          !readback.records.some((entry) => entry.id === result.persistence.receipt)) {
        fail('D02_SHADOW_DURABLE_READBACK_REQUIRED');
      }
      return {mode: 'SHADOW_ONLY', restored, result, journal_readback: readback};
    }
  });
}

export function summarizeShadowRun(run) {
  const result = run?.result;
  if (!result || run.mode !== 'SHADOW_ONLY') fail('D02_SHADOW_RUN_REQUIRED');
  // Three-column reporting. Construction, canonical, and installed facts are
  // never mixed. Construction is the Human-requested V5.2 union revision.
  // Canonical is the observed CP200 / V5.1-R2 control state. Installed stays
  // UNKNOWN until a real C7 Host acceptance proves otherwise. Source, local,
  // or structural PASS is never relabelled as semantic, live, or system PASS.
  const construction = {
    human_requested_spec: 'VNEXT5.2',
    architecture_revision: result.readiness?.shadow_status?.catalog_sha256
      ? `V52-UNION59-${result.readiness.shadow_status.catalog_sha256.slice(0, 12)}`
      : 'V52-UNION59-UNKNOWN',
    operation_union: `${result.readiness?.units?.length ?? 0}/${FULL_UNION_COUNT}`,
    union_digest: UNION_CANONICAL_DIGEST,
    role: 'HUMAN_REQUESTED_CONSTRUCTION_INTENT_NOT_CANONICAL_SELECTION'
  };
  const canonical = {
    control_ref: result.authority.control_ref,
    control_head: result.authority.control_head,
    checkpoint_seq: result.authority.checkpoint_seq,
    checkpoint_digest: result.authority.checkpoint_digest,
    mission_revision: result.authority.mission_revision,
    policy_revision: result.authority.policy_revision,
    spec: 'VNEXT5.1-R2',
    checkpoint: result.authority.checkpoint_seq,
    role: 'OBSERVATION_THIS_TURN_NOT_FUTURE_CURRENT'
  };
  const installed = {
    runtime_version: 'UNKNOWN',
    live_mcp: 'NOT_ACCEPTED',
    live_ads: 'NOT_ACCEPTED',
    real_new_session: 'NOT_ACCEPTED',
    role: 'NOT_OBSERVED_THIS_TURN'
  };
  if (construction.human_requested_spec === canonical.spec) fail('D02_COLUMN_MIXING_FORBIDDEN');
  if (installed.runtime_version !== 'UNKNOWN') fail('D02_INSTALLED_COLUMN_MUST_STAY_UNKNOWN_WITHOUT_LIVE_ACCEPTANCE');
  return {
    mode: run.mode,
    restored_sequence: run.restored.sequence,
    columns: {construction, canonical, installed},
    journal: {
      sequence: run.journal_readback.sequence,
      last_digest: run.journal_readback.last_digest,
      file: run.journal_readback.records.length > 0 ? 'runtime-shadow-journal.jsonl' : null
    },
    canonical: {
      control_ref: result.authority.control_ref,
      control_head: result.authority.control_head,
      checkpoint_seq: result.authority.checkpoint_seq,
      checkpoint_digest: result.authority.checkpoint_digest,
      mission_revision: result.authority.mission_revision,
      policy_revision: result.authority.policy_revision
    },
    read_order: result.read_order,
    live_observation: result.live_observation,
    readiness: {
      decision: result.readiness.selected.decision,
      units: result.readiness.units.length,
        shadow_status: result.readiness.shadow_status
    },
    execution: {
      status: result.execution.status,
      allowed: result.execution_allowed
    },
    side_effects: result.side_effects,
    persistence: result.persistence
  };
}
