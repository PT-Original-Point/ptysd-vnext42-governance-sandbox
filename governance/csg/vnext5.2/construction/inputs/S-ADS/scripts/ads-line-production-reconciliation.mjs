import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryD1ReadOnly } from "./cloudflare-d1-readonly.mjs";

export const ADS_LINE_READ_QUERY_ID = "ADS_LINE_RECONCILIATION_V1";
export const ADS_LINE_READ_SCOPE_SCHEMA = "hanyao.ads-line.read-scope.v1";
export const ADS_LINE_READ_HARD_LIMITS = Object.freeze({
  windowDays: 30, queryCount: 8, rowsPerQuery: 200, totalRows: 1000,
  sourceRowsRead: 10000, responseBytes: 64 * 1024,
});
export const ADS_LINE_READ_REQUIRED_SCOPE = Object.freeze({
  line_events: ["match_reason", "match_status", "received_at", "token_extraction_count"],
  business_conversions: ["business_conversion_id", "conversion_time", "conversion_type", "eligibility_state", "outcome_state"],
  conversion_outbox: ["conversion_type", "event_timestamp", "status", "terminal_result"],
  provider_attempts: ["attempt_id", "business_conversion_id"],
  provider_attempt_events: ["ambiguous", "attempt_id", "event_type", "normalized_status", "provider_request_id"],
  message_asset_metrics_daily: ["clicks", "cost_micros", "impressions", "interactions", "message_chats", "message_impressions", "metric_date"],
  message_asset_metrics_collector_state: ["last_failure_code", "last_row_count"],
});
const CREDENTIAL_ENV_BY_REF = Object.freeze({
  "env:CLOUDFLARE_API_TOKEN": "CLOUDFLARE_API_TOKEN",
  "env:WRANGLER_AUTH_TOKEN": "WRANGLER_AUTH_TOKEN",
});

const TIMEZONE = "Asia/Taipei";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_STATUS = new Set(["MATCHED_ADS", "UNMATCHED", "AMBIGUOUS", "WRONG_CHANNEL", "IGNORED_NON_TEXT", "MATCHED_UNATTRIBUTED"]);
const LINE_REASON = new Set(["MATCHED_ADS", "NO_TOKEN", "UNKNOWN_TOKEN", "MULTIPLE_TOKENS", "WRONG_CHANNEL", "IGNORED_NON_TEXT", "LEGACY_MATCHED_UNATTRIBUTED", "LEGACY_UNCLASSIFIED"]);
const hash = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error("ADS_LINE_RECONCILIATION_" + code); };
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const rows = (result) => Array.isArray(result?.results) ? result.results : [];
const isReadOnly = (meta) => meta?.changedDb === false && Number(meta?.rowsWritten ?? 0) === 0 && Number(meta?.changes ?? 0) === 0;
const positiveBound = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;
const safeCount = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail("RESULT_VALUE_INVALID");
  return n;
};
const sameSet = (a, b) => {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const actual = [...a].sort();
  const expected = [...b].sort();
  return actual.every((value, i) => value === expected[i]);
};
const safeDate = (value, from, to) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) fail("RESULT_DATE_INVALID");
  const ms = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value || value < from || value > to) {
    fail("RESULT_DATE_OUT_OF_SCOPE");
  }
  return value;
};
const safeCategory = (value, allowed) => typeof value === "string" && value.length <= 64 && allowed.has(value) ? value : "OTHER";

export const validateDateWindow = (from, to) => {
  if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "")) fail("DATE_INVALID");
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) ||
      new Date(start).toISOString().slice(0, 10) !== from ||
      new Date(end).toISOString().slice(0, 10) !== to || start > end) fail("WINDOW_INVALID");
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > ADS_LINE_READ_HARD_LIMITS.windowDays) fail("WINDOW_TOO_LARGE");
  return { from, to, days };
};

export const buildLineReasonExpression = (hasMatchReason) => hasMatchReason
  ? "COALESCE(match_reason, 'LEGACY_UNCLASSIFIED')"
  : [
      "CASE",
      " WHEN match_status='MATCHED_ADS' THEN 'MATCHED_ADS'",
      " WHEN match_status='UNMATCHED' AND token_extraction_count=0 THEN 'NO_TOKEN'",
      " WHEN match_status='UNMATCHED' AND token_extraction_count=1 THEN 'UNKNOWN_TOKEN'",
      " WHEN match_status='AMBIGUOUS' THEN 'MULTIPLE_TOKENS'",
      " WHEN match_status='WRONG_CHANNEL' THEN 'WRONG_CHANNEL'",
      " WHEN match_status='IGNORED_NON_TEXT' THEN 'IGNORED_NON_TEXT'",
      " WHEN match_status='MATCHED_UNATTRIBUTED' THEN 'LEGACY_MATCHED_UNATTRIBUTED'",
      " ELSE 'LEGACY_UNCLASSIFIED'",
      "END",
    ].join("\n");

export const validateAdmittedReadScope = (receipt, { accountId, databaseId, now = new Date().toISOString() } = {}) => {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) fail("SCOPE_RECEIPT_REQUIRED");
  if (receipt.schema !== ADS_LINE_READ_SCOPE_SCHEMA || receipt.status !== "ADMITTED") fail("SCOPE_NOT_ADMITTED");
  if (receipt.repository_full_name !== "t14210184/hanyao" || receipt.query_id !== ADS_LINE_READ_QUERY_ID) fail("SCOPE_BINDING_MISMATCH");
  if (typeof receipt.approval_ref !== "string" || !receipt.approval_ref || receipt.approval_ref.length > 256 ||
      !/^(?:env|secretref|vault):[A-Za-z0-9._/:-]{1,200}$/i.test(receipt.credential_ref ?? "")) fail("SCOPE_REFERENCE_INVALID");
  if (!Object.hasOwn(CREDENTIAL_ENV_BY_REF, receipt.credential_ref)) fail("CREDENTIAL_REFERENCE_UNSUPPORTED");
  if (receipt.read_only !== true || receipt.raw_rows_allowed !== false || receipt.timezone !== TIMEZONE) fail("SCOPE_MODE_INVALID");
  if (!accountId || !databaseId || receipt.target_account_id_sha256 !== hash(accountId) ||
      receipt.target_database_id_sha256 !== hash(databaseId)) fail("TARGET_MISMATCH");
  const expiry = Date.parse(receipt.expires_at ?? "");
  const current = Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(current) || current >= expiry) fail("SCOPE_EXPIRED");

  const tables = receipt.tables;
  const requiredNames = Object.keys(ADS_LINE_READ_REQUIRED_SCOPE).sort();
  if (!tables || typeof tables !== "object" || Array.isArray(tables) || !sameSet(Object.keys(tables), requiredNames)) fail("TABLE_SCOPE_MISMATCH");
  for (const [table, fields] of Object.entries(ADS_LINE_READ_REQUIRED_SCOPE)) {
    if (!sameSet(tables[table], fields)) fail("FIELD_SCOPE_MISMATCH");
  }

  const limits = receipt.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits) ||
      !positiveBound(limits.window_days, ADS_LINE_READ_HARD_LIMITS.windowDays) ||
      !positiveBound(limits.query_count, ADS_LINE_READ_HARD_LIMITS.queryCount) ||
      !positiveBound(limits.rows_per_query, ADS_LINE_READ_HARD_LIMITS.rowsPerQuery) ||
      !positiveBound(limits.total_rows, ADS_LINE_READ_HARD_LIMITS.totalRows) ||
      !positiveBound(limits.source_rows_read, ADS_LINE_READ_HARD_LIMITS.sourceRowsRead) ||
      !positiveBound(limits.response_bytes, ADS_LINE_READ_HARD_LIMITS.responseBytes)) fail("SCOPE_LIMITS_INVALID");
  return {
    approval_ref: receipt.approval_ref,
    credential_ref: receipt.credential_ref,
    limits: {
      window_days: limits.window_days, query_count: limits.query_count,
      rows_per_query: limits.rows_per_query, total_rows: limits.total_rows,
      source_rows_read: limits.source_rows_read, response_bytes: limits.response_bytes,
    },
  };
};

export const resolveAdmittedCredential = (receipt, environment = process.env) => {
  const environmentName = CREDENTIAL_ENV_BY_REF[receipt?.credential_ref];
  if (!environmentName) fail("CREDENTIAL_REFERENCE_UNSUPPORTED");
  const token = environment?.[environmentName]?.trim();
  if (!token) fail("SCOPED_CREDENTIAL_UNAVAILABLE");
  return token;
};

const dailyTotals = (inputRows, countField, from, to, outputField) => {
  const totals = new Map();
  for (const row of inputRows) {
    const day = safeDate(row.metric_date, from, to);
    const next = (totals.get(day) ?? 0) + safeCount(row[countField]);
    if (!Number.isSafeInteger(next)) fail("RESULT_COUNT_OVERFLOW");
    totals.set(day, next);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([metric_date, count]) => ({ metric_date, [outputField]: count }));
};

export async function runAdsLineReconciliation({
  from, to, accountId, databaseId, token, scopeReceipt,
  query = queryD1ReadOnly, now = new Date().toISOString(),
}) {
  const window = validateDateWindow(from, to);
  const scope = validateAdmittedReadScope(scopeReceipt, { accountId, databaseId, now });
  if (window.days > scope.limits.window_days) fail("WINDOW_EXCEEDS_ADMITTED_SCOPE");
  if (!accountId || !token) fail("CLOUDFLARE_READ_CREDENTIAL_REQUIRED");

  let queryCount = 0;
  let totalRows = 0;
  let sourceRowsRead = 0;
  const results = [];
  const q = async (sql, params = []) => {
    queryCount += 1;
    if (queryCount > scope.limits.query_count) fail("QUERY_COUNT_LIMIT_EXCEEDED");
    const cap = scope.limits.rows_per_query;
    const result = await query({
      accountId, databaseId, token,
      sql: sql.trim() + " LIMIT ?",
      params: [...params, cap + 1],
      maxResponseBytes: scope.limits.response_bytes,
      maxResultRows: cap + 1,
      maxRowsRead: scope.limits.source_rows_read - sourceRowsRead,
    });
    if (!isReadOnly(result?.meta)) fail("READ_ONLY_GUARD_FAILED");
    const resultRows = rows(result);
    if (resultRows.length > cap) fail("QUERY_ROW_LIMIT_EXCEEDED");
    totalRows += resultRows.length;
    sourceRowsRead += Number(result.meta?.rowsRead ?? 0);
    if (totalRows > scope.limits.total_rows) fail("TOTAL_ROW_LIMIT_EXCEEDED");
    if (!Number.isSafeInteger(sourceRowsRead) || sourceRowsRead > scope.limits.source_rows_read) fail("SOURCE_ROW_LIMIT_EXCEEDED");
    results.push(result);
    return result;
  };

  const columns = await q("SELECT name FROM pragma_table_info('line_events') ORDER BY cid");
  const hasMatchReason = rows(columns).some((row) => row.name === "match_reason");
  const reason = buildLineReasonExpression(hasMatchReason);
  const inventory = await q([
    "SELECT name FROM sqlite_master",
    "WHERE type='table' AND name IN ('business_conversions','conversion_outbox','provider_attempts','provider_attempt_events',",
    "'message_asset_metrics_daily','message_asset_metrics_collector_state') ORDER BY name",
  ].join("\n"));
  const tables = new Set(rows(inventory).map((row) => row.name));

  const line = await q([
    "SELECT date(received_at, '+8 hours') AS metric_date, match_status,",
    reason + " AS match_reason, COUNT(*) AS event_count",
    "FROM line_events WHERE date(received_at, '+8 hours') BETWEEN ? AND ?",
    "GROUP BY metric_date, match_status, match_reason ORDER BY metric_date, match_status, match_reason",
  ].join("\n"), [from, to]);

  const business = tables.has("business_conversions") ? await q([
    "SELECT date(conversion_time, '+8 hours') AS metric_date, conversion_type, eligibility_state, outcome_state,",
    "COUNT(*) AS conversion_count FROM business_conversions",
    "WHERE date(conversion_time, '+8 hours') BETWEEN ? AND ?",
    "GROUP BY metric_date, conversion_type, eligibility_state, outcome_state",
    "ORDER BY metric_date, conversion_type, eligibility_state, outcome_state",
  ].join("\n"), [from, to]) : null;

  const outbox = tables.has("conversion_outbox") ? await q([
    "SELECT date(event_timestamp, '+8 hours') AS metric_date, conversion_type, status, terminal_result,",
    "COUNT(*) AS outbox_count FROM conversion_outbox",
    "WHERE date(event_timestamp, '+8 hours') BETWEEN ? AND ?",
    "GROUP BY metric_date, conversion_type, status, terminal_result",
    "ORDER BY metric_date, conversion_type, status, terminal_result",
  ].join("\n"), [from, to]) : null;

  const provider = tables.has("provider_attempts") && tables.has("provider_attempt_events") && tables.has("business_conversions")
    ? await q([
        "SELECT date(bc.conversion_time, '+8 hours') AS metric_date,",
        "COUNT(DISTINCT pa.attempt_id) AS attempt_count,",
        "COUNT(DISTINCT CASE WHEN pae.provider_request_id IS NOT NULL THEN pa.attempt_id END) AS request_id_count,",
        "SUM(CASE WHEN pae.event_type='SUCCESS' OR pae.normalized_status='SUCCESS' THEN 1 ELSE 0 END) AS success_event_count,",
        "SUM(CASE WHEN pae.event_type='FAILED' OR pae.normalized_status='FAILED' THEN 1 ELSE 0 END) AS failed_event_count,",
        "SUM(CASE WHEN pae.ambiguous=1 OR pae.event_type='RECONCILIATION_REQUIRED' THEN 1 ELSE 0 END) AS reconciliation_event_count",
        "FROM provider_attempts pa JOIN business_conversions bc ON bc.business_conversion_id=pa.business_conversion_id",
        "LEFT JOIN provider_attempt_events pae ON pae.attempt_id=pa.attempt_id",
        "WHERE date(bc.conversion_time, '+8 hours') BETWEEN ? AND ?",
        "GROUP BY metric_date ORDER BY metric_date",
      ].join("\n"), [from, to]) : null;

  const assets = tables.has("message_asset_metrics_daily") ? await q([
    "SELECT metric_date, SUM(impressions) AS impressions, SUM(interactions) AS interactions,",
    "SUM(clicks) AS clicks, SUM(message_impressions) AS message_impressions,",
    "SUM(message_chats) AS message_chats, SUM(cost_micros) AS cost_micros",
    "FROM message_asset_metrics_daily WHERE metric_date BETWEEN ? AND ?",
    "GROUP BY metric_date ORDER BY metric_date",
  ].join("\n"), [from, to]) : null;

  const collector = tables.has("message_asset_metrics_collector_state") ? await q([
    "SELECT COUNT(*) AS collector_count,",
    "SUM(CASE WHEN last_failure_code IS NOT NULL THEN 1 ELSE 0 END) AS collector_failure_count,",
    "COALESCE(SUM(last_row_count), 0) AS collected_row_count",
    "FROM message_asset_metrics_collector_state",
  ].join("\n")) : null;

  if (!results.every((result) => isReadOnly(result.meta))) fail("READ_ONLY_GUARD_FAILED");
  const output = {
    schema: "hanyao.ads-line.reconciliation-bounded.v2",
    result: "READBACK_PASS_BOUNDED",
    from, to, timezone: TIMEZONE, query_id: ADS_LINE_READ_QUERY_ID,
    approval_ref: scope.approval_ref,
    target_database_id_sha256: hash(databaseId),
    line_match_reason_mode: hasMatchReason ? "EXPLICIT_COLUMN" : "LEGACY_CONSERVATIVE_INFERENCE",
    line: rows(line).map((row) => ({
      metric_date: safeDate(row.metric_date, from, to),
      match_status: safeCategory(row.match_status, LINE_STATUS),
      match_reason: safeCategory(row.match_reason, LINE_REASON),
      event_count: safeCount(row.event_count),
    })),
    business: dailyTotals(rows(business), "conversion_count", from, to, "conversion_count"),
    outbox: dailyTotals(rows(outbox), "outbox_count", from, to, "outbox_count"),
    provider: rows(provider).map((row) => ({
      metric_date: safeDate(row.metric_date, from, to),
      attempt_count: safeCount(row.attempt_count),
      request_id_count: safeCount(row.request_id_count),
      success_event_count: safeCount(row.success_event_count),
      failed_event_count: safeCount(row.failed_event_count),
      reconciliation_event_count: safeCount(row.reconciliation_event_count),
    })),
    message_assets: rows(assets).map((row) => ({
      metric_date: safeDate(row.metric_date, from, to),
      impressions: safeCount(row.impressions),
      interactions: safeCount(row.interactions),
      clicks: safeCount(row.clicks),
      message_impressions: safeCount(row.message_impressions),
      message_chats: safeCount(row.message_chats),
      cost_micros: safeCount(row.cost_micros),
    })),
    collector_state: rows(collector).map((row) => ({
      collector_count: safeCount(row.collector_count),
      collector_failure_count: safeCount(row.collector_failure_count),
      collected_row_count: safeCount(row.collected_row_count),
    })),
    missing_tables: [
      "business_conversions", "conversion_outbox", "provider_attempts", "provider_attempt_events",
      "message_asset_metrics_daily", "message_asset_metrics_collector_state",
    ].filter((name) => !tables.has(name)),
    query_count: queryCount,
    aggregate_rows_returned: totalRows,
    read_only_guard: true,
    raw_rows_included: false,
    limits: scope.limits,
  };
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > scope.limits.response_bytes) fail("SANITIZED_OUTPUT_LIMIT_EXCEEDED");
  return output;
}

async function main() {
  const scopeReceiptPath = arg("--scope-receipt");
  if (!scopeReceiptPath) {
    console.log(JSON.stringify({
      schema: ADS_LINE_READ_SCOPE_SCHEMA,
      result: "PARKED_SCOPE_NOT_ADMITTED",
      query_id: ADS_LINE_READ_QUERY_ID,
      provider_query_performed: false,
      required_input: "externally admitted read-scope receipt",
    }));
    return;
  }
  const scopeReceipt = JSON.parse(readFileSync(path.resolve(scopeReceiptPath), "utf8"));
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = process.env.HG10_PRODUCTION_D1_ID?.trim();
  validateAdmittedReadScope(scopeReceipt, { accountId, databaseId });
  const token = resolveAdmittedCredential(scopeReceipt, process.env);
  const result = await runAdsLineReconciliation({
    from: arg("--from"),
    to: arg("--to"),
    accountId,
    token,
    databaseId,
    scopeReceipt,
  });
  console.log(JSON.stringify(result));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) await main();
