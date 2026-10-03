import { exchangeServiceAccountTokenForScopes } from "../workers/google-ads-uploader/src/auth.ts";
import { GOOGLE_ADS_SCOPE } from "../workers/google-ads-uploader/src/types.ts";

export type GoogleAdsProviderAuthSource =
  | "ACCESS_TOKEN"
  | "SERVICE_ACCOUNT_JSON";

export type GoogleAdsAuthEnvironment = {
  [key: string]: string | undefined;
  GOOGLE_ADS_ACCESS_TOKEN?: string;
  GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON?: string;
};

export type GoogleAdsTokenExchange = (
  serializedServiceAccount: string,
  scopes: readonly string[]
) => Promise<{ accessToken: string; expiresIn: number | null }>;

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const hasGoogleAdsAuthInput = (
  env: GoogleAdsAuthEnvironment = process.env
): boolean =>
  Boolean(
    nonEmpty(env.GOOGLE_ADS_ACCESS_TOKEN) ||
      nonEmpty(env.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON)
  );

export const resolveGoogleAdsAccessToken = async (
  env: GoogleAdsAuthEnvironment = process.env,
  exchange: GoogleAdsTokenExchange = exchangeServiceAccountTokenForScopes
): Promise<{
  accessToken: string;
  source: GoogleAdsProviderAuthSource;
  tokenExpiresInSeconds: number | null;
}> => {
  const directAccessToken = nonEmpty(env.GOOGLE_ADS_ACCESS_TOKEN);
  if (directAccessToken) {
    if (/\s/.test(directAccessToken)) {
      throw new Error("GOOGLE_ADS_ACCESS_TOKEN_INVALID");
    }
    return {
      accessToken: directAccessToken,
      source: "ACCESS_TOKEN",
      tokenExpiresInSeconds: null,
    };
  }

  const serializedServiceAccount = nonEmpty(
    env.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_JSON
  );
  if (!serializedServiceAccount) {
    throw new Error("GOOGLE_ADS_PROVIDER_AUTH_REQUIRED");
  }

  const exchanged = await exchange(serializedServiceAccount, [GOOGLE_ADS_SCOPE]);
  return {
    accessToken: exchanged.accessToken,
    source: "SERVICE_ACCOUNT_JSON",
    tokenExpiresInSeconds: exchanged.expiresIn,
  };
};
