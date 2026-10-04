import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { LocalLivenessComponent } from './core.ts';
import {
  createImmutableEvidenceWriter,
  createSupervisorHeartbeatReadRoute,
  type RecoveryIdentity,
  type SupervisorHeartbeatReadback,
} from './recovery-evidence.ts';

const HEARTBEAT_SCHEMA = 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1';
const READBACK_SCHEMA = 'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1';
const EVIDENCE_DIRECTORY = 'recovery-evidence';
const READBACK_FILENAME = 'supervisor-heartbeat-readback.json';
const FIXED_STATE_ROOT = 'C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\state';
const MAX_READBACK_BYTES = 65_536;
const MAX_EVIDENCE_BYTES = 1_048_576;
const REFERENCE_PATTERN = /^recovery:\/\/supervisor-heartbeat\/([a-f0-9]{32})$/;

export type SupervisorHeartbeatContext = {
  identity: RecoveryIdentity;
  provider_observation_id: string;
  /** Current owner-generation liveness classification reported by the Host observer. */
  owner_liveness_state?: 'ACTIVE' | 'EXPIRED';
};

export type HostSupervisorIdentity = {
  supervisor_id: string;
  boot_identity: string;
  process_identity: string;
  service_identity: string;
};

export type SupervisorHeartbeatSigner = {
  keyId: string;
  // The private key stays inside the Host-owned signer. Only the signature crosses this boundary.
  sign: (canonicalPayload: Uint8Array) => Uint8Array;
};

export type SupervisorHeartbeatPublisherPorts = {
  context: SupervisorHeartbeatContext;
  host: HostSupervisorIdentity;
  signer: SupervisorHeartbeatSigner;
  now: number;
  writeEvidence: (reference: string, bytes: Uint8Array) => string;
  publishReadback: (bytes: Uint8Array) => void;
  readReadback: () => Uint8Array | undefined;
};

const isText = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

const stable = (value: any): any => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

const canonicalJson = (value: any) => JSON.stringify(stable(value));
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fail = (code: string): never => { throw new Error(code); };

function validateContext(context: SupervisorHeartbeatContext) {
  const identity = context?.identity;
  if (!identity || !isText(identity.project_id, 80) || !isText(identity.provider, 64) ||
      !isText(identity.task_id, 128) || !isText(identity.attempt_id, 128) ||
      !Number.isSafeInteger(identity.attempt_epoch) || identity.attempt_epoch < 0 ||
      !Number.isSafeInteger(identity.owner_generation) || identity.owner_generation < 1 ||
      !isText(identity.fingerprint, 160) || !isText(identity.owner_principal_id, 128) ||
      !isText(identity.owner_session_id, 128) || !isText(identity.provider_session_id, 128) ||
      !isText(context.provider_observation_id, 128) ||
      (context.owner_liveness_state !== undefined && !['ACTIVE','EXPIRED'].includes(context.owner_liveness_state))) {
    fail('SUPERVISOR_HEARTBEAT_IDENTITY_UNAVAILABLE');
  }
  return identity;
}

function validateHostIdentity(host: HostSupervisorIdentity) {
  if (!isText(host?.supervisor_id, 80) || !isText(host?.boot_identity, 256) ||
      !isText(host?.process_identity, 256) || !isText(host?.service_identity, 256)) {
    fail('SUPERVISOR_HEARTBEAT_HOST_IDENTITY_UNAVAILABLE');
  }
}

/**
 * Creates and publishes one Host Supervisor heartbeat through injected Host-owned
 * storage and signing ports. The production factory below binds those ports to
 * the fixed ProgramData state root and append-only evidence writer.
 */
export function publishSupervisorHeartbeatEvidence(ports: SupervisorHeartbeatPublisherPorts) {
  const identity = validateContext(ports.context);
  validateHostIdentity(ports.host);
  if (!Number.isSafeInteger(ports.now) || ports.now < 0) fail('SUPERVISOR_HEARTBEAT_CLOCK_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(ports.signer?.keyId ?? '') || typeof ports.signer.sign !== 'function') {
    fail('SUPERVISOR_HEARTBEAT_SIGNER_UNAVAILABLE');
  }

  const observedAt = new Date(ports.now).toISOString();
  const ownerLivenessState = ports.context.owner_liveness_state ?? 'ACTIVE';
  const heartbeatId = `HB-${randomBytes(16).toString('hex')}`;
  const reference = `recovery://supervisor-heartbeat/${randomBytes(16).toString('hex')}`;
  const component: LocalLivenessComponent = {
    observation_id: heartbeatId,
    provider_observation_id: ports.context.provider_observation_id,
    ...identity,
    observed_at: observedAt,
    source: 'host-supervisor-heartbeat-readback',
    state: ownerLivenessState,
    supervisor_id: ports.host.supervisor_id,
    heartbeat_id: heartbeatId,
    heartbeat_at_utc: observedAt,
    boot_identity: ports.host.boot_identity,
    process_identity: ports.host.process_identity,
    service_identity: ports.host.service_identity,
    task_identity: identity.task_id,
  };
  const signedBody = { schema: HEARTBEAT_SCHEMA, issuer_key_id: ports.signer.keyId, payload: stable(component) };
  let signature: Uint8Array;
  try { signature = ports.signer.sign(Buffer.from(canonicalJson(signedBody))); }
  catch { return fail('SUPERVISOR_HEARTBEAT_SIGNING_FAILED'); }
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) fail('SUPERVISOR_HEARTBEAT_SIGNATURE_INVALID');
  const envelopeBytes = Buffer.from(JSON.stringify({ ...signedBody, signature: Buffer.from(signature).toString('base64') }));
  if (envelopeBytes.byteLength > MAX_EVIDENCE_BYTES) fail('SUPERVISOR_HEARTBEAT_EVIDENCE_TOO_LARGE');
  const evidenceDigest = digest(envelopeBytes);
  const expectedReference = `recovery://supervisor-heartbeat/${REFERENCE_PATTERN.exec(reference)?.[1]}`;
  if (reference !== expectedReference) fail('SUPERVISOR_HEARTBEAT_REFERENCE_INVALID');

  const storedDigest = ports.writeEvidence(reference, envelopeBytes);
  if (storedDigest !== evidenceDigest) fail('SUPERVISOR_HEARTBEAT_EVIDENCE_READBACK_MISMATCH');
  const readback: SupervisorHeartbeatReadback = {
    project_id: identity.project_id,
    provider: identity.provider,
    task_id: identity.task_id,
    attempt_id: identity.attempt_id,
    attempt_epoch: identity.attempt_epoch,
    owner_generation: identity.owner_generation,
    fingerprint: identity.fingerprint,
    owner_principal_id: identity.owner_principal_id,
    owner_session_id: identity.owner_session_id,
    provider_session_id: identity.provider_session_id,
    supervisor_id: ports.host.supervisor_id,
    heartbeat_id: heartbeatId,
    observed_at: observedAt,
    heartbeat_at_utc: observedAt,
    boot_identity: ports.host.boot_identity,
    process_identity: ports.host.process_identity,
    service_identity: ports.host.service_identity,
    task_identity: identity.task_id,
    evidence_ref: reference,
    evidence_digest: evidenceDigest,
  };
  const readbackBytes = Buffer.from(JSON.stringify({ schema: READBACK_SCHEMA, ...readback }));
  if (readbackBytes.byteLength > MAX_READBACK_BYTES) fail('SUPERVISOR_HEARTBEAT_READBACK_TOO_LARGE');
  ports.publishReadback(readbackBytes);
  const sameSourceReadback = ports.readReadback();
  if (!sameSourceReadback || !Buffer.from(sameSourceReadback).equals(readbackBytes)) {
    fail('SUPERVISOR_HEARTBEAT_READBACK_MISMATCH');
  }
  component.heartbeat_evidence_ref = reference;
  component.heartbeat_evidence_digest = evidenceDigest;
  return { component, readback, reference, evidenceDigest, envelopeBytes };
}

function lstatNoReparse(filePath: string, directory: boolean) {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(filePath); } catch { return undefined; }
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) return undefined;
  try {
    let realPath = fs.realpathSync.native(filePath);
    if (realPath.startsWith('\\\\?\\UNC\\')) realPath = `\\\\${realPath.slice(8)}`;
    else if (realPath.startsWith('\\\\?\\')) realPath = realPath.slice(4);
    const actual = path.win32.normalize(realPath).toLowerCase();
    const expected = path.win32.normalize(path.win32.resolve(filePath)).toLowerCase();
    if (actual !== expected) return undefined;
  } catch { return undefined; }
  return stat;
}

function ensureDirectory(directory: string) {
  if (lstatNoReparse(directory, true)) return;
  const parent = path.win32.dirname(directory);
  if (!lstatNoReparse(parent, true)) fail('SUPERVISOR_HEARTBEAT_STATE_ROOT_UNAVAILABLE');
  try { fs.mkdirSync(directory); } catch (error: any) { if (error?.code !== 'EEXIST') fail('SUPERVISOR_HEARTBEAT_STATE_WRITE_FAILED'); }
  if (!lstatNoReparse(directory, true)) fail('SUPERVISOR_HEARTBEAT_STATE_DIRECTORY_INVALID');
}

function safeReadFile(filePath: string, maxBytes: number): Uint8Array | undefined {
  const before = lstatNoReparse(filePath, false);
  if (!before || before.size < 1 || before.size > maxBytes) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return undefined;
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.size !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino || bytes.byteLength !== opened.size) return undefined;
    return bytes;
  } catch { return undefined; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writeFixedReadback(stateRoot: string, bytes: Uint8Array) {
  if (!lstatNoReparse(stateRoot, true) || bytes.byteLength < 1 || bytes.byteLength > MAX_READBACK_BYTES) {
    fail('SUPERVISOR_HEARTBEAT_STATE_ROOT_UNAVAILABLE');
  }
  const target = path.win32.join(stateRoot, READBACK_FILENAME);
  if (fs.existsSync(target) && !lstatNoReparse(target, false)) fail('SUPERVISOR_HEARTBEAT_READBACK_TARGET_INVALID');
  const temporary = `${target}.tmp.${randomBytes(12).toString('hex')}`;
  let descriptor: number | undefined;
  try {
    try {
      descriptor = fs.openSync(temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
        if (written < 1) fail('SUPERVISOR_HEARTBEAT_DURABLE_WRITE_FAILED');
        offset += written;
      }
      fs.fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) {
        fs.closeSync(descriptor);
        descriptor = undefined;
      }
    }
    const staged = safeReadFile(temporary, MAX_READBACK_BYTES);
    if (!staged || !Buffer.from(staged).equals(Buffer.from(bytes))) fail('SUPERVISOR_HEARTBEAT_STAGED_READBACK_FAILED');
    if (fs.existsSync(target) && !lstatNoReparse(target, false)) fail('SUPERVISOR_HEARTBEAT_READBACK_TARGET_INVALID');
    fs.renameSync(temporary, target);
    const committed = safeReadFile(target, MAX_READBACK_BYTES);
    if (!committed || !Buffer.from(committed).equals(Buffer.from(bytes))) fail('SUPERVISOR_HEARTBEAT_SAME_SOURCE_READBACK_FAILED');
  } catch (error: any) {
    if (error instanceof Error && /^SUPERVISOR_HEARTBEAT_/.test(error.message)) throw error;
    fail('SUPERVISOR_HEARTBEAT_READBACK_PUBLISH_FAILED');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { }
  }
}

/** Binds the producer to the Host's fixed protected state root; no caller path is accepted. */
export function createFixedHostSupervisorHeartbeatPublisher(sources: {
  readContext: () => SupervisorHeartbeatContext | undefined;
  readHostIdentity: () => HostSupervisorIdentity | undefined;
  signer: SupervisorHeartbeatSigner;
  now?: () => number;
}) {
  return () => {
    if (process.platform !== 'win32') fail('HOST_FIXED_STATE_ROOT_UNAVAILABLE');
    const stateRoot = path.win32.resolve(FIXED_STATE_ROOT);
    if (!lstatNoReparse(stateRoot, true)) fail('SUPERVISOR_HEARTBEAT_STATE_ROOT_UNAVAILABLE');
    const evidenceRoot = path.win32.join(stateRoot, EVIDENCE_DIRECTORY);
    ensureDirectory(evidenceRoot);
    const objectsRoot = path.win32.join(evidenceRoot, 'objects');
    ensureDirectory(objectsRoot);
    const heartbeatObjects = path.win32.join(objectsRoot, 'supervisor-heartbeat');
    ensureDirectory(heartbeatObjects);
    const storeWriter = createImmutableEvidenceWriter(evidenceRoot, MAX_EVIDENCE_BYTES);
    const context = sources.readContext();
    const host = sources.readHostIdentity();
    if (!context) fail('SUPERVISOR_HEARTBEAT_IDENTITY_UNAVAILABLE');
    if (!host) fail('SUPERVISOR_HEARTBEAT_HOST_IDENTITY_UNAVAILABLE');
    const route = createSupervisorHeartbeatReadRoute(stateRoot);
    const ports: SupervisorHeartbeatPublisherPorts = {
      context,
      host,
      signer: sources.signer,
      now: (sources.now ?? Date.now)(),
      writeEvidence: storeWriter,
      publishReadback: bytes => writeFixedReadback(stateRoot, bytes),
      readReadback: () => safeReadFile(path.win32.join(stateRoot, READBACK_FILENAME), MAX_READBACK_BYTES),
    };
    const published = publishSupervisorHeartbeatEvidence(ports);
    const readback = route.readExact(context.identity);
    if (readback.status !== 'AVAILABLE' || readback.value.evidence_ref !== published.reference ||
        readback.value.evidence_digest !== published.evidenceDigest) {
      fail('SUPERVISOR_HEARTBEAT_ROUTE_READBACK_FAILED');
    }
    return published;
  };
}
