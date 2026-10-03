export const GOOGLE_ADS_READ_SCOPE = "https://www.googleapis.com/auth/adwords";

export const GOOGLE_ADS_REPORTING_LIMITS = Object.freeze({
  maxQueries: 2,
  maxRows: 201,
  maxResponseBytes: 65_536,
  maxTotalResponseBytes: 131_072,
});

export type GoogleAdsReadScopeExpected = {
  targetCustomerId: string;
  apiVersion: string;
  loginCustomerId: string | null;
};

export type GoogleAdsCredentialRef =
  | "env:GOOGLE_ADS_ACCESS_TOKEN"
  | "env:GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON";

export type GoogleAdsReadScopeReceipt = {
  schema: "hanyao.google-ads.read-scope.v1";
  operation: "ADS_REPORTING_MONITOR_V1";
  approval_ref: string;
  custodian_ref: string;
  credential_ref: GoogleAdsCredentialRef;
  google_cloud_project_id: string;
  google_cloud_project_api_access: "EXPLORER" | "BASIC" | "STANDARD";
  project_access_evidence_ref: string;
  target_customer_id: string;
  account_access: "DIRECT" | "MANAGER";
  login_customer_id: string | null;
  api_version: string;
  oauth_scope: typeof GOOGLE_ADS_READ_SCOPE;
  read_only: true;
  raw_rows: false;
  max_queries: 2;
  max_rows: 201;
  max_response_bytes: 65_536;
  max_total_response_bytes: 131_072;
  expires_at_utc: string;
  credential_expires_at_utc: string | null;
};

export type GoogleAdsReadScopeResult =
  | {
      ok: true;
      receipt: GoogleAdsReadScopeReceipt;
    }
  | {
      ok: false;
      reason: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasBoundedText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= 256;

const validCustomerId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{10}$/.test(value);

const parseFutureExpiry = (
  value: unknown,
  now: number,
  maximumFutureMs: number
): value is string => {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now && parsed <= now + maximumFutureMs;
};

export const validateGoogleAdsReadScopeReceipt = (
  serializedReceipt: string | undefined,
  expected: GoogleAdsReadScopeExpected,
  now = Date.now()
): GoogleAdsReadScopeResult => {
  if (!serializedReceipt || serializedReceipt.length > 16_384) {
    return { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_MISSING_OR_OVERSIZED" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedReceipt);
  } catch {
    return { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_INVALID_JSON" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_INVALID" };
  }

  const receipt = parsed;
  if (receipt.schema !== "hanyao.google-ads.read-scope.v1" ||
      receipt.operation !== "ADS_REPORTING_MONITOR_V1") {
    return { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_SCHEMA_MISMATCH" };
  }
  if (!hasBoundedText(receipt.approval_ref) ||
      !hasBoundedText(receipt.custodian_ref) ||
      !hasBoundedText(receipt.project_access_evidence_ref)) {
    return { ok: false, reason: "ADS_READ_SCOPE_AUTHORITY_FACTS_MISSING" };
  }
  if (receipt.credential_ref !== "env:GOOGLE_ADS_ACCESS_TOKEN" &&
      receipt.credential_ref !== "env:GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON") {
    return { ok: false, reason: "ADS_READ_SCOPE_CREDENTIAL_REF_UNSUPPORTED" };
  }
  if (typeof receipt.google_cloud_project_id !== "string" ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(receipt.google_cloud_project_id)) {
    return { ok: false, reason: "ADS_READ_SCOPE_CLOUD_PROJECT_INVALID" };
  }
  if (receipt.google_cloud_project_api_access !== "EXPLORER" &&
      receipt.google_cloud_project_api_access !== "BASIC" &&
      receipt.google_cloud_project_api_access !== "STANDARD") {
    return { ok: false, reason: "ADS_READ_SCOPE_PROJECT_ACCESS_UNVERIFIED" };
  }
  if (!validCustomerId(receipt.target_customer_id) ||
      receipt.target_customer_id !== expected.targetCustomerId) {
    return { ok: false, reason: "ADS_READ_SCOPE_TARGET_MISMATCH" };
  }
  if (receipt.account_access !== "DIRECT" && receipt.account_access !== "MANAGER") {
    return { ok: false, reason: "ADS_READ_SCOPE_ACCOUNT_ACCESS_INVALID" };
  }
  if (receipt.login_customer_id !== expected.loginCustomerId ||
      (receipt.login_customer_id !== null &&
       !validCustomerId(receipt.login_customer_id)) ||
      (receipt.account_access === "DIRECT" && receipt.login_customer_id !== null) ||
      (receipt.account_access === "MANAGER" && receipt.login_customer_id === null)) {
    return { ok: false, reason: "ADS_READ_SCOPE_LOGIN_CUSTOMER_MISMATCH" };
  }
  if (receipt.api_version !== expected.apiVersion ||
      receipt.oauth_scope !== GOOGLE_ADS_READ_SCOPE) {
    return { ok: false, reason: "ADS_READ_SCOPE_API_OR_OAUTH_SCOPE_MISMATCH" };
  }
  if (receipt.read_only !== true || receipt.raw_rows !== false ||
      receipt.max_queries !== GOOGLE_ADS_REPORTING_LIMITS.maxQueries ||
      receipt.max_rows !== GOOGLE_ADS_REPORTING_LIMITS.maxRows ||
      receipt.max_response_bytes !== GOOGLE_ADS_REPORTING_LIMITS.maxResponseBytes ||
      receipt.max_total_response_bytes !==
        GOOGLE_ADS_REPORTING_LIMITS.maxTotalResponseBytes) {
    return { ok: false, reason: "ADS_READ_SCOPE_READ_BOUND_MISMATCH" };
  }
  if (!parseFutureExpiry(receipt.expires_at_utc, now, 24 * 60 * 60 * 1000)) {
    return { ok: false, reason: "ADS_READ_SCOPE_RECEIPT_EXPIRED_OR_TOO_LONG" };
  }
  if (receipt.credential_ref === "env:GOOGLE_ADS_ACCESS_TOKEN") {
    if (!parseFutureExpiry(receipt.credential_expires_at_utc, now, 60 * 60 * 1000)) {
      return { ok: false, reason: "ADS_READ_SCOPE_ACCESS_TOKEN_EXPIRY_REQUIRED" };
    }
  } else if (receipt.credential_expires_at_utc !== null) {
    return { ok: false, reason: "ADS_READ_SCOPE_SERVICE_ACCOUNT_EXPIRY_INVALID" };
  }

  return {
    ok: true,
    receipt: receipt as unknown as GoogleAdsReadScopeReceipt,
  };
};

export const readResponseTextBounded = async (
  response: Response,
  maximumBytes: number
): Promise<{ text: string; bytes: number }> => {
  if (!response.body || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("GOOGLE_ADS_RESPONSE_STREAM_UNAVAILABLE");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) &&
      Number(contentLength) > maximumBytes) {
    await response.body.cancel();
    throw new Error("GOOGLE_ADS_RESPONSE_BYTE_CAP_EXCEEDED");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new Error("GOOGLE_ADS_RESPONSE_BYTE_CAP_EXCEEDED");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "GOOGLE_ADS_RESPONSE_BYTE_CAP_EXCEEDED") {
      throw error;
    }
    throw new Error("GOOGLE_ADS_RESPONSE_READ_FAILED");
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), bytes };
  } catch {
    throw new Error("GOOGLE_ADS_RESPONSE_MALFORMED_UTF8");
  }
};
