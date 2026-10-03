import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_ADS_READ_SCOPE,
  GOOGLE_ADS_REPORTING_LIMITS,
  readResponseTextBounded,
  validateGoogleAdsReadScopeReceipt,
  type GoogleAdsReadScopeReceipt,
} from "./google-ads-read-scope.ts";

const NOW = Date.parse("2026-10-03T05:00:00.000Z");
const EXPECTED = {
  targetCustomerId: "4801404246",
  apiVersion: "v25",
  loginCustomerId: null,
};

const validReceipt = (
  overrides: Partial<GoogleAdsReadScopeReceipt> = {}
): GoogleAdsReadScopeReceipt => ({
  schema: "hanyao.google-ads.read-scope.v1",
  operation: "ADS_REPORTING_MONITOR_V1",
  approval_ref: "approval:ads-read:20261003",
  custodian_ref: "custodian:ads-read",
  credential_ref: "env:GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON",
  google_cloud_project_id: "ads-read-project-123",
  google_cloud_project_api_access: "BASIC",
  project_access_evidence_ref: "cloud-console:ads-api-access",
  target_customer_id: EXPECTED.targetCustomerId,
  account_access: "DIRECT",
  login_customer_id: null,
  api_version: EXPECTED.apiVersion,
  oauth_scope: GOOGLE_ADS_READ_SCOPE,
  read_only: true,
  raw_rows: false,
  max_queries: GOOGLE_ADS_REPORTING_LIMITS.maxQueries,
  max_rows: GOOGLE_ADS_REPORTING_LIMITS.maxRows,
  max_response_bytes: GOOGLE_ADS_REPORTING_LIMITS.maxResponseBytes,
  max_total_response_bytes: GOOGLE_ADS_REPORTING_LIMITS.maxTotalResponseBytes,
  expires_at_utc: "2026-10-03T05:20:00.000Z",
  credential_expires_at_utc: null,
  ...overrides,
});

const serialized = (
  receipt: GoogleAdsReadScopeReceipt
): string => JSON.stringify(receipt);

test("exact bounded read receipt validates for the fixed Ads reporting route", () => {
  const result = validateGoogleAdsReadScopeReceipt(
    serialized(validReceipt()),
    EXPECTED,
    NOW
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.receipt.target_customer_id, EXPECTED.targetCustomerId);
    assert.equal(result.receipt.oauth_scope, GOOGLE_ADS_READ_SCOPE);
  }
});

test("missing receipt fails closed before any provider credentials are needed", () => {
  assert.deepEqual(
    validateGoogleAdsReadScopeReceipt(undefined, EXPECTED, NOW),
    { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_MISSING_OR_OVERSIZED" }
  );
});

test("wrong target, login customer, API version, or scope fails closed", () => {
  const cases = [
    [
      validReceipt({ target_customer_id: "4801404247" }),
      EXPECTED,
      "ADS_READ_SCOPE_TARGET_MISMATCH",
    ],
    [
      validReceipt({
        account_access: "MANAGER",
        login_customer_id: "9876543210",
      }),
      EXPECTED,
      "ADS_READ_SCOPE_LOGIN_CUSTOMER_MISMATCH",
    ],
    [
      validReceipt({ api_version: "v24" }),
      EXPECTED,
      "ADS_READ_SCOPE_API_OR_OAUTH_SCOPE_MISMATCH",
    ],
    [
      validReceipt({ oauth_scope: "https://www.googleapis.com/auth/cloud-platform" }),
      EXPECTED,
      "ADS_READ_SCOPE_API_OR_OAUTH_SCOPE_MISMATCH",
    ],
  ] as const;
  for (const [receipt, expected, reason] of cases) {
    const result = validateGoogleAdsReadScopeReceipt(
      serialized(receipt),
      expected,
      NOW
    );
    assert.deepEqual(result, { ok: false, reason });
  }
});

test("unsupported credential references and unbounded receipts fail closed", () => {
  const unsupported = {
    ...validReceipt(),
    credential_ref: "file:C:/private/key.json",
  };
  assert.deepEqual(
    validateGoogleAdsReadScopeReceipt(
      JSON.stringify(unsupported),
      EXPECTED,
      NOW
    ),
    { ok: false, reason: "ADS_READ_SCOPE_CREDENTIAL_REF_UNSUPPORTED" }
  );

  assert.deepEqual(
    validateGoogleAdsReadScopeReceipt(
      serialized(validReceipt({ max_response_bytes: 65_537 })),
      EXPECTED,
      NOW
    ),
    { ok: false, reason: "ADS_READ_SCOPE_READ_BOUND_MISMATCH" }
  );
});

test("expired receipt and unbounded direct-token expiry fail closed", () => {
  assert.deepEqual(
    validateGoogleAdsReadScopeReceipt(
      serialized(validReceipt({ expires_at_utc: "2026-10-03T04:59:59.000Z" })),
      EXPECTED,
      NOW
    ),
    { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_EXPIRED_OR_TOO_LONG" }
  );

  assert.deepEqual(
    validateGoogleAdsReadScopeReceipt(
      serialized(
        validReceipt({
          credential_ref: "env:GOOGLE_ADS_ACCESS_TOKEN",
          credential_expires_at_utc: null,
        })
      ),
      EXPECTED,
      NOW
    ),
    { ok: false, reason: "ADS_READ_SCOPE_ACCESS_TOKEN_EXPIRY_REQUIRED" }
  );
});

test("response body byte cap is enforced while reading the stream", async () => {
  const accepted = await readResponseTextBounded(
    new Response('{"results":[]}', {
      headers: { "content-length": "14" },
    }),
    32
  );
  assert.deepEqual(accepted, { text: '{"results":[]}', bytes: 14 });

  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456"));
        controller.enqueue(new TextEncoder().encode("7890"));
        controller.close();
      },
    })
  );
  await assert.rejects(
    readResponseTextBounded(oversized, 8),
    /GOOGLE_ADS_RESPONSE_BYTE_CAP_EXCEEDED/
  );
});
