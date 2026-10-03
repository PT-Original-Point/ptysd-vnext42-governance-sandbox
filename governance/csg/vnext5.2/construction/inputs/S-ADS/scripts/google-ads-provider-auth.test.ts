import assert from "node:assert/strict";
import test from "node:test";
import { GOOGLE_ADS_SCOPE } from "../workers/google-ads-uploader/src/types.ts";
import {
  hasGoogleAdsAuthInput,
  resolveGoogleAdsAccessToken,
  type GoogleAdsTokenExchange,
} from "./google-ads-provider-auth.ts";

test("direct short-lived Google Ads access token takes precedence without exchange", async () => {
  let exchangeCalled = false;
  const exchange = (async () => {
    exchangeCalled = true;
    throw new Error("exchange must not be called");
  }) as GoogleAdsTokenExchange;

  const result = await resolveGoogleAdsAccessToken(
    {
      GOOGLE_ADS_ACCESS_TOKEN: "short-lived-access-token-123",
      GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
    },
    exchange
  );

  assert.deepEqual(result, {
    accessToken: "short-lived-access-token-123",
    source: "ACCESS_TOKEN",
    tokenExpiresInSeconds: null,
  });
  assert.equal(exchangeCalled, false);
});

test("service-account JSON remains the fallback and requests only adwords scope", async () => {
  const calls: Array<{
    credential: string;
    scopes: readonly string[];
  }> = [];
  const exchange = (async (credential, scopes) => {
    calls.push({ credential, scopes });
    return { accessToken: "fallback-token", expiresIn: 3600 };
  }) as GoogleAdsTokenExchange;

  const result = await resolveGoogleAdsAccessToken(
    {
      GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON: "serialized-service-account",
    },
    exchange
  );

  assert.deepEqual(result, {
    accessToken: "fallback-token",
    source: "SERVICE_ACCOUNT_JSON",
    tokenExpiresInSeconds: 3600,
  });
  assert.deepEqual(calls, [
    {
      credential: "serialized-service-account",
      scopes: [GOOGLE_ADS_SCOPE],
    },
  ]);
});

test("missing auth input fails closed", async () => {
  assert.equal(hasGoogleAdsAuthInput({}), false);
  await assert.rejects(
    resolveGoogleAdsAccessToken({}, async () => {
      throw new Error("must not be called");
    }),
    /GOOGLE_ADS_PROVIDER_AUTH_REQUIRED/
  );
});

test("access tokens containing whitespace fail closed", async () => {
  await assert.rejects(
    resolveGoogleAdsAccessToken(
      { GOOGLE_ADS_ACCESS_TOKEN: "bad token" },
      async () => {
        throw new Error("must not be called");
      }
    ),
    /GOOGLE_ADS_ACCESS_TOKEN_INVALID/
  );
});

test("auth availability accepts either supported input without exposing values", () => {
  assert.equal(
    hasGoogleAdsAuthInput({ GOOGLE_ADS_ACCESS_TOKEN: "opaque-token" }),
    true
  );
  assert.equal(
    hasGoogleAdsAuthInput({
      GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON: "opaque-service-account-json",
    }),
    true
  );
});
