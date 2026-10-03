import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {canonicalJson} from './fingerprint.mjs';
import {validateEvidenceRecord} from './evidence-contract.mjs';

const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const FILE_NAME = 'continuity-evidence.jsonl';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digestProjection(projection) {
  return `sha256:${createHash('sha256').update(canonicalJson(projection), 'utf8').digest('hex')}`;
}

function projectionOf(result) {
  if (result?.project_id !== PROJECT_ID || !result.authority || !result.readiness) {
    fail('LOCAL_EVIDENCE_PROJECTION_INVALID');
  }
  const readiness = {...result.readiness};
  if (readiness.evidence_records !== undefined) {
    if (!Array.isArray(readiness.evidence_records)) fail('LOCAL_EVIDENCE_EVIDENCE_RECORDS_INVALID');
    readiness.evidence_records = readiness.evidence_records.map(validateEvidenceRecord);
  }
  return {
    schema: 'VNEXT5_1_R2_LOCAL_CONTINUITY_EVIDENCE_V1',
    project_id: result.project_id,
    authority: result.authority,
    live_observation: result.live_observation ?? null,
    readiness,
    execution: result.execution ?? null,
    read_order: result.read_order ?? [],
    stale_wake_fields_ignored: result.stale_wake_fields_ignored ?? [],
    side_effects: result.side_effects ?? {host_dispatch: false, host_mutation: false, canonical_write: false,
      local_work_dispatch: false},
    mission_lifecycle_changed: false
  };
}

function readRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.length === 0) return [];
  if (!raw.endsWith('\n')) fail('LOCAL_EVIDENCE_LEDGER_TRUNCATED');
  const lines = raw.slice(0, -1).split('\n');
  return lines.map((line) => {
    try {
      const record = JSON.parse(line);
      if (record.schema !== 'VNEXT5_1_R2_LOCAL_CONTINUITY_EVIDENCE_V1' ||
          typeof record.id !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.id) ||
          typeof record.recorded_at !== 'string' || !Number.isFinite(Date.parse(record.recorded_at))) {
        fail('LOCAL_EVIDENCE_LEDGER_CORRUPT');
      }
      const {id, recorded_at, ...projection} = record;
      if (digestProjection(projection) !== id) fail('LOCAL_EVIDENCE_LEDGER_CORRUPT');
      return record;
    } catch (error) {
      if (error?.code === 'LOCAL_EVIDENCE_LEDGER_CORRUPT') throw error;
      fail('LOCAL_EVIDENCE_LEDGER_CORRUPT');
    }
  });
}

export function createLocalEvidenceLedger(root) {
  if (typeof root !== 'string' || root.length === 0) fail('LOCAL_EVIDENCE_ROOT_REQUIRED');
  const resolvedRoot = path.resolve(root);
  fs.mkdirSync(resolvedRoot, {recursive: true});
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) fail('LOCAL_EVIDENCE_ROOT_REPARSE_POINT');
  const realRoot = fs.realpathSync(resolvedRoot);
  const filePath = path.join(realRoot, FILE_NAME);

  return Object.freeze({
    filePath,
    append(result) {
      const projection = projectionOf(result);
      const id = digestProjection(projection);
      const existing = readRecords(filePath).find((record) => record.id === id);
      if (existing) return {durable: true, id, existing: true, path: filePath};

      const record = {...projection, id, recorded_at: new Date().toISOString()};
      const line = `${JSON.stringify(record)}\n`;
      if (Buffer.byteLength(line, 'utf8') > 1048576) fail('LOCAL_EVIDENCE_RECORD_TOO_LARGE');
      const fd = fs.openSync(filePath, 'a');
      try {
        fs.writeSync(fd, line, null, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      const persisted = readRecords(filePath).find((item) => item.id === id);
      if (!persisted) fail('LOCAL_EVIDENCE_READBACK_MISMATCH');
      return {durable: true, id, existing: false, path: filePath};
    }
  });
}
