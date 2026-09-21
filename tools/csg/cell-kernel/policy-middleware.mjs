import { createHash } from 'node:crypto';
import { evaluateAuthorization } from './authorization-envelope.mjs';

export const POLICY_MIDDLEWARE_VERSION = 'v48.policy-middleware.v1';
export const EFFECT_CLASSES = Object.freeze(['READ_ONLY','LOCAL_PREPARATION','LOCAL_EXECUTION','PROVIDER_EFFECT','HUMAN_RESERVED']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_KEY_RE = /(?:token|secret|password|passwd|api[_-]?key|private[_-]?key|credential|aws_|github_token|openai_api_key|anthropic_api_key)/i;
const DANGEROUS_GIT_ENV_RE = /^(?:GIT_CONFIG(?:_COUNT|_KEY_\d+|_VALUE_\d+)?|GIT_TEMPLATE_DIR|GIT_EXEC_PATH|GIT_SSH_COMMAND|GIT_DIR|GIT_WORK_TREE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES)$/i;
const NTFS_83_RE = /~[0-9](?:\.|$)/i;
const WIN_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const digest = v => `sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const deny = (...codes) => ({ allow:false, dispatch_allowed:false, decision:'DENY', reason_codes:[...new Set(codes.filter(Boolean))].sort() });
const reqId = (v, code) => (typeof v === 'string' && ID_RE.test(v)) ? v : (()=>{ throw new Error(code); })();

function pathKey(raw) {
  if (typeof raw !== 'string' || !raw) throw new Error('INVALID_PATH');
  if (raw.includes('\0')) throw new Error('PATH_NUL');
  const n = raw.normalize('NFC');
  if (n !== raw) throw new Error('PATH_UNICODE_ALIAS');
  if (n.includes('\\') || n.startsWith('/') || n.startsWith('//') || /^[A-Za-z]:/.test(n)) throw new Error('PATH_ABSOLUTE_OR_SEPARATOR_ALIAS');
  const parts = n.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw new Error('PATH_TRAVERSAL');
  for (const p of parts) {
    if (NTFS_83_RE.test(p)) throw new Error('PATH_NTFS_83_ALIAS');
    if (/[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || WIN_RESERVED_RE.test(p)) throw new Error('PATH_WINDOWS_ALIAS');
  }
  return parts.join('/').toLocaleLowerCase('en-US');
}
function within(path, root) {
  const p = pathKey(path), r = pathKey(root);
  return p === r || p.startsWith(`${r}/`);
}
function pathAllowed(cap, req, reasons) {
  if (req.path === undefined) return;
  let requested, resolved;
  try {
    requested = pathKey(req.path);
    if (req.path_resolution?.has_symlink === true) {
      if (req.path_resolution.trusted !== true || typeof req.path_resolution.resolved_repo_relative !== 'string') {
        reasons.push('PATH_RESOLUTION_REQUIRED'); return;
      }
      resolved = pathKey(req.path_resolution.resolved_repo_relative);
    } else {
      resolved = requested;
    }
  } catch (e) { reasons.push(String(e.message)); return; }
  const forbidden = Array.isArray(cap.forbidden_paths) ? cap.forbidden_paths : [];
  const read = Array.isArray(cap.read_paths) ? cap.read_paths : [];
  const owned = Array.isArray(cap.owned_paths) ? cap.owned_paths : [];
  for (const f of forbidden) {
    try { if (within(req.path, f) || (resolved && within(req.path_resolution?.resolved_repo_relative ?? req.path, f))) { reasons.push('PATH_FORBIDDEN'); return; } }
    catch (e) { reasons.push(String(e.message)); return; }
  }
  const roots = req.effect_class === 'READ_ONLY' ? [...owned, ...read] : owned;
  let ok = false;
  for (const root of roots) {
    try {
      const rr = pathKey(root);
      if ((requested === rr || requested.startsWith(`${rr}/`)) && (resolved === rr || resolved.startsWith(`${rr}/`))) { ok = true; break; }
    } catch (e) { reasons.push(String(e.message)); return; }
  }
  if (!ok) reasons.push('PATH_SCOPE_DENY');
}
function identityChecks(identity, capability, reasons) {
  if (!identity || !capability) { reasons.push('IDENTITY_OR_CAPABILITY_REQUIRED'); return; }
  for (const k of ['project_id','run_id','task_id','attempt_id']) {
    try { reqId(identity[k], `INVALID_${k.toUpperCase()}`); } catch (e) { reasons.push(e.message); continue; }
    if (capability[k] !== identity[k]) reasons.push(`STALE_${k.toUpperCase()}`);
  }
  if (!Number.isSafeInteger(identity.attempt_epoch) || identity.attempt_epoch < 1) reasons.push('INVALID_ATTEMPT_EPOCH');
  else if (capability.attempt_epoch !== identity.attempt_epoch) reasons.push('STALE_ATTEMPT_EPOCH');
  if (capability.schema !== 'v48.cell-capability.v1') reasons.push('CAPABILITY_SCHEMA_MISMATCH');
}
function resourceChecks(cap, req, reasons) {
  const use = req.resource_usage ?? {};
  const lim = cap.resource_limits ?? {};
  for (const k of ['cpu_millis','memory_mib','pids','disk_mib','provider_calls']) {
    if (use[k] === undefined) continue;
    if (!Number.isSafeInteger(use[k]) || use[k] < 0 || !Number.isSafeInteger(lim[k]) || use[k] > lim[k]) reasons.push(`RESOURCE_WIDEN_${k.toUpperCase()}`);
  }
  const rank = x => x === 'DENY' ? 0 : x === 'LIMITED' ? 1 : -1;
  if (use.network_mode !== undefined && (rank(use.network_mode) < 0 || rank(lim.network_mode) < 0 || rank(use.network_mode) > rank(lim.network_mode))) reasons.push('RESOURCE_WIDEN_NETWORK_MODE');
}
function dataModelChecks(identity, cap, req, profile, nowMs, reasons) {
  const data = req.data_class;
  if (data !== undefined && (!Array.isArray(cap.data_class) || !cap.data_class.includes(data))) reasons.push('DATA_CLASS_WIDEN');
  if (req.paid_fallback_allowed !== false || (req.incremental_usd ?? 0) !== 0) reasons.push('PAID_FALLBACK_FORBIDDEN');
  if (req.model_profile_id !== undefined && req.model_profile_id !== cap.model_profile_id) reasons.push('MODEL_PROFILE_ID_MISMATCH');
  if (req.model_profile_revision !== undefined && req.model_profile_revision !== cap.model_profile_revision) reasons.push('MODEL_PROFILE_REVISION_MISMATCH');
  const modelProfileRequired = typeof cap.model_profile_id === 'string' && cap.model_profile_id !== '' && !cap.model_profile_id.startsWith('NONE_');
  if (modelProfileRequired && !profile) reasons.push('MODEL_PROFILE_REQUIRED');
  if (profile) {
    if (profile.project_id !== identity.project_id) reasons.push('MODEL_PROFILE_WRONG_PROJECT');
    if (profile.profile_id !== cap.model_profile_id || profile.revision !== cap.model_profile_revision) reasons.push('MODEL_PROFILE_BINDING_MISMATCH');
    if (profile.paid_fallback_allowed !== false || profile.incremental_usd !== 0) reasons.push('MODEL_PROFILE_COST_POLICY');
    if (data !== undefined && (!Array.isArray(profile.data_classes) || !profile.data_classes.includes(data))) reasons.push('MODEL_PROFILE_DATA_CLASS');
    if (profile.entitlement !== 'PASS_CURRENT_REAL_INFERENCE') reasons.push('MODEL_PROFILE_ENTITLEMENT_UNKNOWN');
    const exp = Date.parse(profile.expires_at ?? '');
    if (!Number.isFinite(exp) || nowMs >= exp) reasons.push('MODEL_PROFILE_EXPIRED');
  }
}
function credentialChecks(identity, req, profile, reasons) {
  const env = req.ambient_env ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env)) reasons.push('AMBIENT_ENV_INVALID');
  else for (const [k,v] of Object.entries(env)) {
    if (DANGEROUS_GIT_ENV_RE.test(k)) reasons.push('GIT_ENV_INJECTION');
    if (SECRET_KEY_RE.test(k) && v !== '' && v !== null && v !== undefined) reasons.push('AMBIENT_SECRET_INHERITANCE');
  }
  if (req.secret_values || req.raw_secrets || req.api_key || req.provider_write_credential) reasons.push('RAW_SECRET_OR_PROVIDER_WRITE_CREDENTIAL_FORBIDDEN');
  const refs = req.secret_refs ?? [];
  if (!Array.isArray(refs)) { reasons.push('SECRET_REFS_INVALID'); return; }
  if (refs.length === 0) return;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) { reasons.push('CREDENTIAL_PROFILE_REQUIRED'); return; }
  if (profile.project_id !== identity.project_id) reasons.push('CREDENTIAL_PROFILE_WRONG_PROJECT');
  if (profile.raw_secret_values_present === true) reasons.push('CREDENTIAL_PROFILE_RAW_SECRET_FORBIDDEN');
  const allowed = new Set(Array.isArray(profile.allowed_secret_refs) ? profile.allowed_secret_refs : []);
  for (const ref of refs) if (typeof ref !== 'string' || !allowed.has(ref)) reasons.push('SECRET_REF_NOT_ALLOWED');
}
function gitChecks(req, reasons) {
  const argv = req.git_argv ?? [];
  if (!Array.isArray(argv)) { reasons.push('GIT_ARGV_INVALID'); return; }
  for (const arg of argv.map(String)) {
    if (arg === '-c' || arg === '--config' || arg.startsWith('--config=') || arg.startsWith('--config-env') || /(?:core\.hookspath|credential\.helper|include\.path|protocol\.file\.allow|safe\.directory|git_config)/i.test(arg)) reasons.push('GIT_CONFIG_OR_HOOK_INJECTION');
  }
}
function permitChecks(req, reasons) {
  if (!EFFECT_CLASSES.includes(req.effect_class)) { reasons.push('INVALID_EFFECT_CLASS'); return; }
  if (req.permission_decision === 'DENY') reasons.push('POLICY_EXPLICIT_DENY');
  if (req.permission_decision === 'ASK' && req.interactive !== true) reasons.push('NONINTERACTIVE_ASK_DENY');
  if (req.effect_class === 'PROVIDER_EFFECT') {
    if (req.effect_boundary !== 'PROVIDERGUARD') reasons.push('PROVIDERGUARD_REQUIRED');
    if (req.provider_permit_granted !== true) reasons.push('PROVIDER_PERMIT_REQUIRED');
  }
}

export function evaluatePolicyRequest({ identity, capability, request, credential_profile = null, model_profile = null, authorization_envelope = null, current_mission = null, human_reservation_permit = null, now = new Date().toISOString() } = {}) {
  const reasons = [];
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return deny('INVALID_NOW');
  if (!request || typeof request !== 'object' || Array.isArray(request)) return deny('REQUEST_REQUIRED');
  identityChecks(identity, capability, reasons);
  pathAllowed(capability ?? {}, request, reasons);
  resourceChecks(capability ?? {}, request, reasons);
  dataModelChecks(identity ?? {}, capability ?? {}, request, model_profile, nowMs, reasons);
  credentialChecks(identity ?? {}, request, credential_profile, reasons);
  gitChecks(request, reasons);
  permitChecks(request, reasons);
  const authorization = evaluateAuthorization({ envelope: authorization_envelope, current_mission, identity, request, human_reservation_permit });
  if (!authorization.authorized) reasons.push(...authorization.reason_codes);
  if (reasons.length) {
    return {
      ...deny(...reasons),
      middleware_version:POLICY_MIDDLEWARE_VERSION,
      authorization_id:authorization.authorization_id ?? null,
      authorization_decision_digest:authorization.authorization_decision_digest ?? null,
      human_authorization_required:authorization.human_reservation_required === true,
      tool_confirmation_required:reasons.includes('NONINTERACTIVE_ASK_DENY'),
    };
  }
  const dispatchAllowed = capability.execution_authorized === true && request.dispatch_requested === true;
  const out = {
    middleware_version:POLICY_MIDDLEWARE_VERSION,
    allow:true,
    decision:'ALLOW',
    dispatch_allowed:dispatchAllowed,
    shadow_only:capability.execution_authorized !== true,
    identity:{ project_id:identity.project_id, run_id:identity.run_id, task_id:identity.task_id, attempt_id:identity.attempt_id, attempt_epoch:identity.attempt_epoch },
    effect_class:request.effect_class,
    authorization_id:authorization.authorization_id ?? null,
    authorization_decision_digest:authorization.authorization_decision_digest ?? null,
    human_authorization_required:false,
    tool_confirmation_required:false,
    paid_fallback_allowed:false,
    incremental_usd:0,
  };
  out.decision_digest = digest(out);
  return out;
}
