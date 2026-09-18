import fs from 'node:fs';

export const REQUIRED_PROVIDER = 'opencode';
export const REQUIRED_MODEL = 'muse-spark-1.3-contributor-free';
export const REQUIRED_OPENCODE_MODEL = 'opencode/muse-spark-1.3-contributor-free';
export const REQUIRED_ENDPOINT = 'https://opencode.ai/zen/v1/responses';
export const ALLOWED_DATA_CLASSES = new Set(['PUBLIC', 'SYNTHETIC']);

export function evaluateModelProfile(profile, request, nowMs = Date.now()) {
  const failures = [];
  const add = (code, ok) => { if (!ok) failures.push(code); };
  const p = profile ?? {};
  const r = request ?? {};

  add('SCHEMA', p.schema === 'factory.model_profile.v2');
  add('PROVIDER', p.provider_id === REQUIRED_PROVIDER);
  add('MODEL_ID', p.model_id === REQUIRED_MODEL);
  add('OPENCODE_MODEL_ID', p.opencode_model_id === REQUIRED_OPENCODE_MODEL);
  add('ENDPOINT', p.endpoint === REQUIRED_ENDPOINT);
  add('CATALOG_ACTIVE', p.catalog_status === 'active');
  add('ENTITLEMENT', p.account_entitlement === 'PASS_CURRENT_REAL_INFERENCE');
  add('DYNAMIC_REFRESH', p.dynamic_refresh_required === true);
  add('PAID_FALLBACK_DISABLED', p.paid_fallback_allowed === false);
  add('FALLBACK_EMPTY', Array.isArray(p.fallback_model_ids) && p.fallback_model_ids.length === 0);
  add('AUTO_RELOAD_DISABLED', p.auto_reload_disabled === true);
  add('TRAINING_DISCLOSED', p.training_allowed_by_provider === true);
  add('NON_ZDR_DISCLOSED', p.zero_data_retention === false);
  add('REGION_ELIGIBLE', p.region_eligibility === 'PASS_PROVIDER_OBSERVED');

  const cost = p.live_cost ?? {};
  add('COST_INPUT_ZERO', cost.input === 0);
  add('COST_OUTPUT_ZERO', cost.output === 0);
  add('COST_CACHE_READ_ZERO', cost.cache_read === 0);
  add('COST_CACHE_WRITE_ZERO', cost.cache_write === 0);

  const observedAt = Date.parse(p.observed_at ?? '');
  const ttlSeconds = p.ttl_seconds;
  add('TTL_VALUE', Number.isInteger(ttlSeconds) && ttlSeconds > 0 && ttlSeconds <= 3600);
  add('OBSERVED_AT', Number.isFinite(observedAt));
  if (Number.isFinite(observedAt) && Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
    add('NOT_FUTURE', observedAt <= nowMs + 60_000);
    add('NOT_EXPIRED', nowMs <= observedAt + ttlSeconds * 1000);
  }

  add('REQUEST_PROVIDER', r.provider_id === REQUIRED_PROVIDER);
  add('REQUEST_MODEL', r.model_id === REQUIRED_MODEL || r.model_id === REQUIRED_OPENCODE_MODEL);
  add('REQUEST_DATA_CLASS', ALLOWED_DATA_CLASSES.has(r.data_class));
  add('REQUEST_NO_PAID_FALLBACK', r.paid_fallback_allowed === false);

  return {
    allow: failures.length === 0,
    result: failures.length === 0 ? 'PASS_PRE_DISPATCH_MODEL_PROFILE' : 'WAITING_RESOURCE',
    failures
  };
}

function main() {
  const [profilePath, requestPath, nowIso] = process.argv.slice(2);
  if (!profilePath || !requestPath) {
    console.error('usage: node scripts/v46-model-profile-guard.mjs <profile.json> <request.json> [now-iso]');
    process.exit(64);
  }
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  if (!Number.isFinite(nowMs)) {
    console.error('invalid now-iso');
    process.exit(64);
  }
  const result = evaluateModelProfile(profile, request, nowMs);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.allow ? 0 : 78);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
