const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function safeToken(value) {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function safePositiveInteger(value, max = 2_147_483_647) {
  return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : null;
}

function projectRecord(value) {
  const record = value && typeof value === 'object' ? value : {};
  const controlOid = typeof record.control_oid === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(record.control_oid)
    ? record.control_oid
    : null;
  return {
    request_id: typeof record.request_id === 'string' && /^[0-9a-f]{32}$/.test(record.request_id) ? record.request_id : null,
    project_id: safeToken(record.project_id),
    capability_id: safeToken(record.capability_id),
    operation_id: safeToken(record.operation_id),
    control_oid: controlOid,
    checkpoint_digest: typeof record.checkpoint_digest === 'string' && DIGEST.test(record.checkpoint_digest) ? record.checkpoint_digest : null,
    authorization_envelope_digest: typeof record.authorization_envelope_digest === 'string' && DIGEST.test(record.authorization_envelope_digest)
      ? record.authorization_envelope_digest
      : null,
    capability_generation: safePositiveInteger(record.capability_generation),
    run_id: safeToken(record.run_id),
    task_id: safeToken(record.task_id),
    attempt_id: safeToken(record.attempt_id),
    attempt_epoch: safePositiveInteger(record.attempt_epoch),
    started_at_utc: safeTimestamp(record.started_at_utc),
    finished_at_utc: safeTimestamp(record.finished_at_utc),
    timeout_seconds: safePositiveInteger(record.timeout_seconds, 86_400),
    state: 'ORPHANED',
    side_effect_state: safeToken(record.side_effect_state),
    error_code: safeToken(record.error_code),
    receipt_digest: typeof record.receipt_digest === 'string' && DIGEST.test(record.receipt_digest) ? record.receipt_digest : null,
  };
}

/** Return a bounded, allowlisted orphan view without modifying the input. */
export function projectOrphanStatusView(lane, limit = 16) {
  const source = lane && typeof lane === 'object' ? lane : {};
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 16) : 16;
  const inputRecords = Array.isArray(source.orphan_records) ? source.orphan_records : [];
  const records = inputRecords.filter((record) => record && record.state === 'ORPHANED').map(projectRecord);
  const hasExactCount = Object.prototype.hasOwnProperty.call(source, 'orphan_records_total_count');
  const rawCount = hasExactCount ? source.orphan_records_total_count : source.orphan_count;
  const hasKnownCount = Number.isSafeInteger(rawCount) && rawCount >= 0;
  const totalCount = hasKnownCount
    ? Math.max(rawCount, inputRecords.length)
    : hasExactCount ? null : inputRecords.length;
  const readStatus = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(source.orphan_records_read_status)
    ? source.orphan_records_read_status
    : 'UNAVAILABLE';
  const truncated = source.orphan_records_truncated === true || totalCount > Math.min(records.length, safeLimit) || records.length !== inputRecords.length || readStatus !== 'COMPLETE';

  return {
    orphan_records_schema: 'v49.factory-mcp.orphan-records.v1',
    orphan_records_read_status: readStatus,
    orphan_records_read_at_utc: safeTimestamp(source.orphan_records_read_at_utc),
    orphan_records_total_count: totalCount,
    orphan_records_truncated: truncated,
    orphan_records: records.slice(0, safeLimit),
  };
}
