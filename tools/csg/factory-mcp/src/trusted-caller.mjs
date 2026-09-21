import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROJECT_ID_RE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
const CALLER_ID_RE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const HEX_KEY_RE = /^[0-9a-f]{64}$/;
const REQUEST_ID_RE = /^[0-9a-f]{32}$/;
const DEFAULT_TRUSTED_CALLERS_PATH = 'C:\\ProgramData\\PTYSD\\MCP\\config\\trusted-callers.json';
const DEFAULT_ATTESTATION_KEYRING_PATH = 'C:\\ProgramData\\PTYSD\\MCP\\secrets\\broker-caller-attestation-keyring.json';

function fail(code) {
  throw new Error(code);
}

export function certificateSha256(rawCertificate) {
  if (!Buffer.isBuffer(rawCertificate) || rawCertificate.length === 0) fail('TRUSTED_CALLER_CERTIFICATE_REQUIRED');
  return 'sha256:' + createHash('sha256').update(rawCertificate).digest('hex');
}

export function loadTrustedCallers(path = process.env.PTYSD_FACTORY_MCP_TRUSTED_CALLERS || DEFAULT_TRUSTED_CALLERS_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('TRUSTED_CALLER_CONFIG_READ_FAILED');
  }
  if (parsed?.schema !== 'v49.factory-mcp.trusted-callers.v1') fail('TRUSTED_CALLER_CONFIG_SCHEMA_INVALID');
  if (parsed?.binding_mode !== 'PER_PROJECT_DEDICATED_TUNNEL') fail('TRUSTED_CALLER_BINDING_MODE_INVALID');
  if (!Number.isSafeInteger(parsed.identity_generation) || parsed.identity_generation < 1) {
    fail('TRUSTED_CALLER_IDENTITY_GENERATION_INVALID');
  }
  if (!Array.isArray(parsed.callers) || parsed.callers.length === 0) fail('TRUSTED_CALLER_CONFIG_EMPTY');
  const seen = new Set();
  const seenTunnelBindings = new Set();
  for (const caller of parsed.callers) {
    if (!CALLER_ID_RE.test(caller?.caller_id ?? '')) fail('TRUSTED_CALLER_ID_INVALID');
    if (!PROJECT_ID_RE.test(caller?.project_id ?? '')) fail('TRUSTED_CALLER_PROJECT_INVALID');
    if (!DIGEST_RE.test(caller?.certificate_sha256 ?? '')) fail('TRUSTED_CALLER_CERT_DIGEST_INVALID');
    if (caller?.principal_type !== 'PROJECT_DEDICATED_TUNNEL') fail('TRUSTED_CALLER_PRINCIPAL_TYPE_INVALID');
    if (!CALLER_ID_RE.test(caller?.tunnel_binding_id ?? '')) fail('TRUSTED_CALLER_TUNNEL_BINDING_INVALID');
    if (!Number.isSafeInteger(caller?.identity_generation) || caller.identity_generation < 1) {
      fail('TRUSTED_CALLER_ENTRY_GENERATION_INVALID');
    }
    if (caller.identity_generation !== parsed.identity_generation) fail('TRUSTED_CALLER_ENTRY_GENERATION_STALE');
    if (caller.enabled !== true) continue;
    if (seen.has(caller.certificate_sha256)) fail('TRUSTED_CALLER_CERT_DUPLICATE');
    if (seenTunnelBindings.has(caller.tunnel_binding_id)) fail('TRUSTED_CALLER_TUNNEL_BINDING_DUPLICATE');
    seen.add(caller.certificate_sha256);
    seenTunnelBindings.add(caller.tunnel_binding_id);
  }
  return parsed;
}

export function resolveTrustedMtlsCaller(rawCertificate, config = loadTrustedCallers()) {
  const certificate_sha256 = certificateSha256(rawCertificate);
  const matches = config.callers.filter((caller) =>
    caller.enabled === true && caller.certificate_sha256 === certificate_sha256,
  );
  if (matches.length !== 1) fail(matches.length === 0 ? 'TRUSTED_CALLER_CERT_UNKNOWN' : 'TRUSTED_CALLER_CERT_AMBIGUOUS');
  const caller = matches[0];
  return Object.freeze({
    schema: 'v49.factory-mcp.trusted-caller-identity.v1',
    project_id: caller.project_id,
    caller_id: caller.caller_id,
    certificate_sha256,
    principal_type: caller.principal_type,
    tunnel_binding_id: caller.tunnel_binding_id,
    identity_generation: caller.identity_generation,
    caller_identity_digest: 'sha256:' + createHash('sha256')
      .update(JSON.stringify({
        project_id: caller.project_id,
        caller_id: caller.caller_id,
        certificate_sha256,
        principal_type: caller.principal_type,
        tunnel_binding_id: caller.tunnel_binding_id,
        identity_generation: caller.identity_generation,
      }))
      .digest('hex'),
  });
}

function validateKeyEntry(entry, codePrefix) {
  if (!entry || !CALLER_ID_RE.test(entry.key_id ?? '')) fail(`${codePrefix}_KEY_ID_INVALID`);
  if (!HEX_KEY_RE.test(entry.key_hex ?? '')) fail(`${codePrefix}_KEY_INVALID`);
  if (!Number.isSafeInteger(entry.key_generation) || entry.key_generation < 1) fail(`${codePrefix}_KEY_GENERATION_INVALID`);
  return entry;
}

export function loadCallerAttestationKeyring(path = process.env.PTYSD_FACTORY_MCP_ATTESTATION_KEYRING || DEFAULT_ATTESTATION_KEYRING_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('TRUSTED_CALLER_ATTESTATION_KEYRING_READ_FAILED');
  }
  if (parsed?.schema !== 'v49.factory-mcp.caller-attestation-keyring.v1') fail('TRUSTED_CALLER_ATTESTATION_KEYRING_SCHEMA_INVALID');
  if (!Number.isSafeInteger(parsed.keyring_generation) || parsed.keyring_generation < 1) fail('TRUSTED_CALLER_ATTESTATION_KEYRING_GENERATION_INVALID');
  validateKeyEntry(parsed.current, 'TRUSTED_CALLER_ATTESTATION_CURRENT');
  if (parsed.current.key_generation !== parsed.keyring_generation) fail('TRUSTED_CALLER_ATTESTATION_CURRENT_GENERATION_STALE');
  if (!Array.isArray(parsed.previous)) fail('TRUSTED_CALLER_ATTESTATION_PREVIOUS_INVALID');
  const seen = new Set([parsed.current.key_id]);
  for (const entry of parsed.previous) {
    validateKeyEntry(entry, 'TRUSTED_CALLER_ATTESTATION_PREVIOUS');
    if (seen.has(entry.key_id)) fail('TRUSTED_CALLER_ATTESTATION_KEY_ID_DUPLICATE');
    seen.add(entry.key_id);
    const expiry = Date.parse(entry.valid_until ?? '');
    if (!Number.isFinite(expiry)) fail('TRUSTED_CALLER_ATTESTATION_PREVIOUS_EXPIRY_INVALID');
    if (entry.key_generation >= parsed.keyring_generation) fail('TRUSTED_CALLER_ATTESTATION_PREVIOUS_GENERATION_INVALID');
  }
  return parsed;
}

function selectCallerAttestationKey(keyring, keyId, keyGeneration, now = new Date()) {
  if (keyring.current.key_id === keyId && keyring.current.key_generation === keyGeneration) {
    return Buffer.from(keyring.current.key_hex, 'hex');
  }
  const prior = keyring.previous.find((entry) => entry.key_id === keyId && entry.key_generation === keyGeneration);
  if (!prior) fail('TRUSTED_CALLER_ATTESTATION_KEY_UNKNOWN');
  if (now.getTime() >= Date.parse(prior.valid_until)) fail('TRUSTED_CALLER_ATTESTATION_ROLLOVER_EXPIRED');
  return Buffer.from(prior.key_hex, 'hex');
}

export function createBrokerCallerAttestation({
  callerIdentity,
  executionFence,
  args,
  requestId,
  now = new Date(),
  ttlSeconds = 30,
  keyringPath,
} = {}) {
  if (!callerIdentity || callerIdentity.schema !== 'v49.factory-mcp.trusted-caller-identity.v1') {
    fail('TRUSTED_CALLER_IDENTITY_REQUIRED');
  }
  if (!executionFence?.execution_fence) fail('TRUSTED_CALLER_EXECUTION_FENCE_REQUIRED');
  if (!REQUEST_ID_RE.test(requestId ?? '')) fail('TRUSTED_CALLER_REQUEST_ID_INVALID');
  const fence = executionFence.execution_fence;
  if (!Number.isSafeInteger(fence.authorization_generation) || fence.authorization_generation < 1) fail('TRUSTED_CALLER_AUTH_GENERATION_INVALID');
  if (!DIGEST_RE.test(fence.authorization_state_digest ?? '')) fail('TRUSTED_CALLER_AUTH_STATE_DIGEST_INVALID');
  if (callerIdentity.project_id !== fence.project_id) fail('TRUSTED_CALLER_PROJECT_FENCE_MISMATCH');
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 60) fail('TRUSTED_CALLER_ATTESTATION_TTL_INVALID');
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const keyring = loadCallerAttestationKeyring(keyringPath);
  const keyEntry = keyring.current;
  const claims = {
    schema: 'v49.factory-mcp.caller-attestation.v2',
    request_id: requestId,
    attestation_key_id: keyEntry.key_id,
    attestation_key_generation: keyEntry.key_generation,
    project_id: callerIdentity.project_id,
    caller_id: callerIdentity.caller_id,
    certificate_sha256: callerIdentity.certificate_sha256,
    caller_identity_digest: callerIdentity.caller_identity_digest,
    identity_generation: callerIdentity.identity_generation,
    principal_type: callerIdentity.principal_type,
    tunnel_binding_id: callerIdentity.tunnel_binding_id,
    authorization_generation: fence.authorization_generation,
    authorization_state_digest: fence.authorization_state_digest,
    operation_kind: fence.operation_kind,
    mission_revision: fence.mission_revision,
    mission_hash: fence.mission_hash,
    authorization_envelope_digest: fence.authorization_envelope_digest,
    control_oid: executionFence.control_oid,
    checkpoint_digest: executionFence.checkpoint_digest,
    operation_id: fence.operation_id,
    run_id: args.runId,
    task_id: args.taskId,
    attempt_id: args.attemptId,
    attempt_epoch: args.attemptEpoch,
    script_sha256: fence.script_sha256 ?? null,
    payload_sha256: fence.payload_sha256 ?? null,
    timeout_seconds: args.timeoutSeconds ?? 60,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  const payloadBytes = Buffer.from(JSON.stringify(claims), 'utf8');
  const key = Buffer.from(keyEntry.key_hex, 'hex');
  const mac = createHmac('sha256', key).update(payloadBytes).digest('hex');
  return Object.freeze({
    schema: 'v49.factory-mcp.caller-attestation-envelope.v2',
    payload_b64: payloadBytes.toString('base64'),
    mac_sha256: mac,
  });
}

export function verifyBrokerCallerAttestationForTest(envelope, keyring, now = new Date()) {
  if (envelope?.schema !== 'v49.factory-mcp.caller-attestation-envelope.v2') fail('TRUSTED_CALLER_ATTESTATION_SCHEMA_INVALID');
  if (typeof envelope.payload_b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(envelope.payload_b64)) {
    fail('TRUSTED_CALLER_ATTESTATION_PAYLOAD_INVALID');
  }
  if (typeof envelope.mac_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.mac_sha256)) {
    fail('TRUSTED_CALLER_ATTESTATION_MAC_INVALID');
  }
  const payload = Buffer.from(envelope.payload_b64, 'base64');
  let claims;
  try { claims = JSON.parse(payload.toString('utf8')); } catch { fail('TRUSTED_CALLER_ATTESTATION_JSON_INVALID'); }
  if (claims?.schema !== 'v49.factory-mcp.caller-attestation.v2') fail('TRUSTED_CALLER_ATTESTATION_SCHEMA_INVALID');
  if (!keyring || keyring.schema !== 'v49.factory-mcp.caller-attestation-keyring.v1') fail('TRUSTED_CALLER_ATTESTATION_KEYRING_SCHEMA_INVALID');
  const key = selectCallerAttestationKey(keyring, claims.attestation_key_id, claims.attestation_key_generation, now);
  const expected = createHmac('sha256', key).update(payload).digest();
  const claimed = Buffer.from(envelope.mac_sha256, 'hex');
  if (claimed.length !== expected.length || !timingSafeEqual(claimed, expected)) fail('TRUSTED_CALLER_ATTESTATION_MAC_MISMATCH');
  const expires = Date.parse(claims.expires_at ?? '');
  const issued = Date.parse(claims.issued_at ?? '');
  if (!Number.isFinite(expires) || !Number.isFinite(issued) || now.getTime() < issued - 5000 || now.getTime() >= expires || expires-issued > 60000) {
    fail('TRUSTED_CALLER_ATTESTATION_EXPIRED');
  }
  return claims;
}
