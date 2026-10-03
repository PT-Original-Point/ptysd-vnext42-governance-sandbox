import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  ADS_LINE_READ_HARD_LIMITS,
  ADS_LINE_READ_QUERY_ID,
  ADS_LINE_READ_REQUIRED_SCOPE,
  ADS_LINE_READ_SCOPE_SCHEMA,
  buildLineReasonExpression,
  resolveAdmittedCredential,
  runAdsLineReconciliation,
  validateAdmittedReadScope,
  validateDateWindow,
} from "./ads-line-production-reconciliation.mjs";

const databaseId = "test-database-id";
const accountId = "account";
const now = "2026-10-03T12:00:00.000Z";
const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const makeReceipt = (overrides = {}) => ({
  schema: ADS_LINE_READ_SCOPE_SCHEMA,
  status: "ADMITTED",
  repository_full_name: "t14210184/hanyao",
  query_id: ADS_LINE_READ_QUERY_ID,
  approval_ref: "read-scope-approval:test-fixture",
  credential_ref: "env:CLOUDFLARE_API_TOKEN",
  target_account_id_sha256: digest(accountId),
  target_database_id_sha256: digest(databaseId),
  expires_at: "2026-10-04T00:00:00.000Z",
  read_only: true,
  raw_rows_allowed: false,
  timezone: "Asia/Taipei",
  tables: structuredClone(ADS_LINE_READ_REQUIRED_SCOPE),
  limits: {
    window_days: ADS_LINE_READ_HARD_LIMITS.windowDays,
    query_count: ADS_LINE_READ_HARD_LIMITS.queryCount,
    rows_per_query: ADS_LINE_READ_HARD_LIMITS.rowsPerQuery,
    total_rows: ADS_LINE_READ_HARD_LIMITS.totalRows,
    source_rows_read: ADS_LINE_READ_HARD_LIMITS.sourceRowsRead,
    response_bytes: ADS_LINE_READ_HARD_LIMITS.responseBytes,
  },
  ...overrides,
});

const makeQuery = ({ overflowFirst = false } = {}) => {
  const calls = [];
  const query = async (input) => {
    calls.push(input);
    let results = [];
    if (calls.length === 1) {
      results = overflowFirst ? Array.from({ length: 201 }, (_, index) => ({ name: "column_" + index })) : [{ name: "match_reason" }];
    } else if (input.sql.includes("sqlite_master")) {
      results = [
        { name: "business_conversions" },
        { name: "conversion_outbox" },
        { name: "provider_attempts" },
        { name: "provider_attempt_events" },
        { name: "message_asset_metrics_daily" },
        { name: "message_asset_metrics_collector_state" },
      ];
    } else if (input.sql.includes("FROM line_events")) {
      results = [{ metric_date: "2026-09-17", match_status: "MATCHED_ADS", match_reason: "MATCHED_ADS", event_count: 4, customer_id: "private-customer" }];
    } else if (input.sql.includes("FROM business_conversions")) {
      results = [{ metric_date: "2026-09-17", conversion_type: "private-category", eligibility_state: "private-state", outcome_state: "private-outcome", conversion_count: 2, customer_id: "private-customer" }];
    } else if (input.sql.includes("FROM conversion_outbox")) {
      results = [{ metric_date: "2026-09-17", conversion_type: "private-category", status: "private-status", terminal_result: "private-result", outbox_count: 1 }];
    } else if (input.sql.includes("FROM provider_attempts")) {
      results = [{ metric_date: "2026-09-17", attempt_count: 3, request_id_count: 2, success_event_count: 1, failed_event_count: 1, reconciliation_event_count: 1 }];
    } else if (input.sql.includes("FROM message_asset_metrics_daily")) {
      results = [{ metric_date: "2026-09-17", impressions: 10, interactions: 4, clicks: 3, message_impressions: 2, message_chats: 1, cost_micros: 900, campaign_id: "private-campaign", asset_id: "private-asset" }];
    } else if (input.sql.includes("FROM message_asset_metrics_collector_state")) {
      results = [{ collector_count: 1, collector_failure_count: 0, collected_row_count: 12, customer_id: "private-customer", last_failure_code: "private-failure" }];
    }
    return { results, meta: { changedDb: false, rowsWritten: 0, changes: 0, rowsRead: results.length } };
  };
  return { calls, query };
};

test("bounds calendar-valid date windows and rejects overlarge or impossible dates", () => {
  assert.deepEqual(validateDateWindow("2026-09-17", "2026-09-28"), { from: "2026-09-17", to: "2026-09-28", days: 12 });
  assert.equal(validateDateWindow("2026-09-01", "2026-09-30").days, 30);
  assert.throws(() => validateDateWindow("2026-09-01", "2026-10-01"), /WINDOW_TOO_LARGE/);
  assert.throws(() => validateDateWindow("2026-02-30", "2026-03-01"), /WINDOW_INVALID/);
  assert.throws(() => validateDateWindow("2026/09/17", "2026-09-28"), /DATE_INVALID/);
});

test("requires an admitted exact-target scope receipt before the first query", async () => {
  const fixture = makeQuery();
  await assert.rejects(runAdsLineReconciliation({
    from: "2026-09-17", to: "2026-09-28", accountId: "account", databaseId, token: "token",
    query: fixture.query, now,
  }), /SCOPE_RECEIPT_REQUIRED/);
  assert.equal(fixture.calls.length, 0);

  assert.throws(() => validateAdmittedReadScope(makeReceipt({ status: "PENDING" }), { accountId, databaseId, now }), /SCOPE_NOT_ADMITTED/);
  assert.throws(() => validateAdmittedReadScope(makeReceipt(), { accountId, databaseId: "other-db", now }), /TARGET_MISMATCH/);
  assert.throws(() => validateAdmittedReadScope(makeReceipt(), { accountId: "other-account", databaseId, now }), /TARGET_MISMATCH/);
  assert.throws(() => validateAdmittedReadScope(makeReceipt({ credential_ref: "env:HANYAO_D1_READ_TOKEN" }), { accountId, databaseId, now }), /CREDENTIAL_REFERENCE_UNSUPPORTED/);
  assert.throws(() => validateAdmittedReadScope(makeReceipt({ expires_at: "2026-10-03T11:59:59Z" }), { accountId, databaseId, now }), /SCOPE_EXPIRED/);
});

test("binds the admitted credential reference to one exact supported environment variable", () => {
  assert.equal(resolveAdmittedCredential(makeReceipt(), { CLOUDFLARE_API_TOKEN: "scoped-test-token" }), "scoped-test-token");
  assert.throws(() => resolveAdmittedCredential(makeReceipt(), { WRANGLER_AUTH_TOKEN: "unrelated-token" }), /SCOPED_CREDENTIAL_UNAVAILABLE/);
  assert.throws(() => resolveAdmittedCredential(makeReceipt({ credential_ref: "vault:HG10_READ" }), { CLOUDFLARE_API_TOKEN: "token" }), /CREDENTIAL_REFERENCE_UNSUPPORTED/);
});

test("uses fixed capped queries and returns only bounded redacted aggregates", async () => {
  const fixture = makeQuery();
  const result = await runAdsLineReconciliation({
    from: "2026-09-17", to: "2026-09-28", accountId: "account", databaseId, token: "token",
    scopeReceipt: makeReceipt(), query: fixture.query, now,
  });

  assert.equal(fixture.calls.length, 8);
  assert.equal(result.result, "READBACK_PASS_BOUNDED");
  assert.equal(result.raw_rows_included, false);
  assert.equal(result.read_only_guard, true);
  assert.equal(result.target_database_id_sha256, digest(databaseId));
  assert.equal(result.line[0].event_count, 4);
  assert.deepEqual(result.business, [{ metric_date: "2026-09-17", conversion_count: 2 }]);
  assert.deepEqual(result.outbox, [{ metric_date: "2026-09-17", outbox_count: 1 }]);
  assert.equal(result.message_assets[0].clicks, 3);
  assert.equal(result.collector_state[0].collector_count, 1);
  assert.ok(fixture.calls.every((call) => call.sql.trim().endsWith("LIMIT ?")));
  assert.ok(fixture.calls.every((call) => call.params.at(-1) === 201));
  assert.ok(fixture.calls.every((call) => call.maxResponseBytes === ADS_LINE_READ_HARD_LIMITS.responseBytes));
  const serialized = JSON.stringify(result);
  for (const privateValue of ["private-customer", "private-campaign", "private-asset", "private-category", "private-failure"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("rejects provider results above the per-query cap before continuing", async () => {
  const fixture = makeQuery({ overflowFirst: true });
  await assert.rejects(runAdsLineReconciliation({
    from: "2026-09-17", to: "2026-09-28", accountId: "account", databaseId, token: "token",
    scopeReceipt: makeReceipt(), query: fixture.query, now,
  }), /QUERY_ROW_LIMIT_EXCEEDED/);
  assert.equal(fixture.calls.length, 1);
});

test("an admitted receipt can narrow limits but cannot widen any hard cap", () => {
  const narrow = makeReceipt({ limits: { ...makeReceipt().limits, window_days: 7, rows_per_query: 25 } });
  assert.equal(validateAdmittedReadScope(narrow, { accountId, databaseId, now }).limits.window_days, 7);
  const wide = makeReceipt({ limits: { ...makeReceipt().limits, response_bytes: ADS_LINE_READ_HARD_LIMITS.responseBytes + 1 } });
  assert.throws(() => validateAdmittedReadScope(wide, { accountId, databaseId, now }), /SCOPE_LIMITS_INVALID/);
});
