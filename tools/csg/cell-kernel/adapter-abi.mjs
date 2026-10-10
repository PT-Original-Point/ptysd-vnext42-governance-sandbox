import { createHash } from 'node:crypto';

export const ADAPTER_ABI_VERSION = 'v48.adapter-abi.v1';
export const INTERFACE_PRECEDENCE = Object.freeze({
  OPEN_CODE_NATIVE_HTTP: 500,
  NATIVE_ACP: 400,
  THIN_ACP_ADAPTER: 300,
  CLI_WRAPPER: 200,
  TERMINAL_SCRAPING: 100,
});
export const REQUIRED_CANARY_CASES = Object.freeze([
  'session_load', 'session_resume', 'session_fork', 'model', 'effort',
  'mode', 'reasoning', 'abort_reconnect',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PAID_ROUTE = /(?:api[_-]?key|paid|billing|metered)/i;
const fail = (code) => { throw new Error(code); };
const reqId = (v, code) => { if (typeof v !== 'string' || !ID.test(v)) fail(code); return v; };
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const digest = (v) => `sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;

function validateDescriptor(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) fail('ADAPTER_DESCRIPTOR_REQUIRED');
  reqId(x.adapter_id, 'INVALID_ADAPTER_ID');
  if (!Object.hasOwn(INTERFACE_PRECEDENCE, x.interface_kind)) fail('INVALID_INTERFACE_KIND');
  if (x.qualified !== true) fail('ADAPTER_NOT_QUALIFIED');
  if (x.paid_fallback_allowed !== false || x.incremental_usd !== 0) fail('PAID_FALLBACK_FORBIDDEN');
  if (x.binary_required === true && x.binary_present !== true) fail('ENGINE_BINARY_MISSING');
  if (!Array.isArray(x.capabilities)) fail('ADAPTER_CAPABILITIES_REQUIRED');
  if (x.route && PAID_ROUTE.test(x.route)) fail('PAID_ROUTE_FORBIDDEN');
  return x;
}

export function selectNativeAdapter(candidates, requiredCapabilities = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) fail('ADAPTER_CANDIDATES_REQUIRED');
  if (!Array.isArray(requiredCapabilities)) fail('REQUIRED_CAPABILITIES_INVALID');
  const sorted = [...candidates].sort((a, b) => (INTERFACE_PRECEDENCE[b.interface_kind] ?? -1) - (INTERFACE_PRECEDENCE[a.interface_kind] ?? -1) || String(a.adapter_id).localeCompare(String(b.adapter_id)));
  let firstMissingBinary = null;
  for (const raw of sorted) {
    if (!raw || raw.qualified !== true) continue;
    if (raw.paid_fallback_allowed !== false || raw.incremental_usd !== 0 || (raw.route && PAID_ROUTE.test(raw.route))) continue;
    if (raw.binary_required === true && raw.binary_present !== true) {
      firstMissingBinary ??= raw;
      continue;
    }
    const cap = new Set(raw.capabilities ?? []);
    if (!requiredCapabilities.every(x => cap.has(x))) continue;
    const selected = validateDescriptor(raw);
    return { schema: ADAPTER_ABI_VERSION, selected: structuredClone(selected), precedence: INTERFACE_PRECEDENCE[selected.interface_kind], selection_digest: digest(selected) };
  }
  if (firstMissingBinary) fail('ENGINE_BINARY_MISSING');
  fail('NO_QUALIFIED_ZERO_COST_ADAPTER');
}

export function createAdapterInvocation(selection, identity, request) {
  const a = validateDescriptor(selection?.selected ?? selection);
  const i = identity ?? {};
  for (const k of ['project_id','run_id','task_id','attempt_id']) reqId(i[k], `INVALID_${k.toUpperCase()}`);
  if (!Number.isSafeInteger(i.attempt_epoch) || i.attempt_epoch < 1) fail('INVALID_ATTEMPT_EPOCH');
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('ADAPTER_REQUEST_REQUIRED');
  if (request.api_key || request.provider_write_credential) fail('PROVIDER_WRITE_CREDENTIAL_FORBIDDEN');
  const out = { schema:'v48.adapter-invocation.v1', adapter_id:a.adapter_id, interface_kind:a.interface_kind, identity:structuredClone(i), request:structuredClone(request), paid_fallback_allowed:false, incremental_usd:0 };
  out.invocation_digest = digest(out);
  return out;
}

export function normalizeAdapterResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('ADAPTER_RESULT_REQUIRED');
  if (!['RUNNING','AWAITING_APPROVAL','COMPLETED','FAILED','CANCELLED','RECOVERY_REQUIRED'].includes(result.status)) fail('ADAPTER_RESULT_EXPLICIT_STATUS_REQUIRED');
  if (result.status === 'COMPLETED' && !result.receipt_ref) fail('EMPTY_SUCCESS_FORBIDDEN');
  return structuredClone(result);
}

export function evaluateOpenCodePinPromotion({ current_pin, current_version = current_pin, candidate_version, canary = null } = {}) {
  const pin = typeof current_version === 'string' && current_version.trim() ? current_version.trim() : 'UNKNOWN';
  if (pin === 'UNKNOWN' || typeof candidate_version !== 'string' || !candidate_version.trim()) return { promote: false, pin, reason: 'DENY' };
  if (!canary || canary.result !== 'PASS') return { promote: false, pin, reason: 'CANARY_NOT_PASS' };
  if (canary.version !== candidate_version) return { promote: false, pin, reason: 'VERSION_MISMATCH' };
  if (!REQUIRED_CANARY_CASES.every(k => canary.cases?.[k] === true)) return { promote: false, pin, reason: 'CANARY_INCOMPLETE' };
  if (canary.incremental_usd !== 0 || canary.paid_fallback_allowed !== false) return { promote: false, pin, reason: 'ZERO_COST_OR_FALLBACK_GUARD_FAIL' };
  return { promote: true, pin: candidate_version, reason: 'CANARY_PASS' };
}
