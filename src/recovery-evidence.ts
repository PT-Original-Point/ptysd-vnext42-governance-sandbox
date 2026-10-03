import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import type { LocalLivenessObservation, RecoveryEvidenceKeySet, RecoveryEvidenceTrust, RecoveryObservation } from './core.ts';

const MAX_EVIDENCE_BYTES = 1_048_576;
const PROVIDER_SCHEMA = 'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1';
const LOCAL_SCHEMA = 'PTYSD_LOCAL_LIVENESS_EVIDENCE_V1';
const HEARTBEAT_SCHEMA = 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1';
const PUBLICATION_SCHEMA = 'v51.factory.owner-liveness.publication.v1';
const REFERENCES_SCHEMA = 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1';
const PUBLICATION_ROUTE_ID = 'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1';
const EVIDENCE_STORE_ROUTE_ID = 'PTYSD_FACTORY_MCP_RECOVERY_EVIDENCE_STORE_V1';
const PROVIDER_SESSION_ROUTE_ID = 'PTYSD_PROVIDER_AGENT_SESSION_READBACK_V1';
const SUPERVISOR_HEARTBEAT_ROUTE_ID = 'PTYSD_HOST_SUPERVISOR_HEARTBEAT_READBACK_V1';
const FIXED_FACTORY_STATE_ROOT = 'C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\state';
const OWNER_LIVENESS_FILENAME = 'owner-liveness.json';
const PROVIDER_SESSION_FILENAME = 'provider-session-readback.json';
const SUPERVISOR_HEARTBEAT_FILENAME = 'supervisor-heartbeat-readback.json';
const PROVIDER_SESSION_READBACK_SCHEMA = 'PTYSD_PROVIDER_SESSION_READBACK_V1';
const SUPERVISOR_HEARTBEAT_READBACK_SCHEMA = 'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1';
const EVIDENCE_DIRECTORY = 'recovery-evidence';
const REF_PATTERN = /^recovery:\/\/(provider|local|supervisor-heartbeat)\/([a-f0-9]{32})$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_ROUTE_READBACK_BYTES = 65_536;

type RouteConfiguration =
  | { status: 'UNAVAILABLE'; reason_code: string }
  | { status: 'AVAILABLE'; route_id: string };
type KeyConfiguration = {
  key_id: string;
  issuer_role: 'PROVIDER_AGENT' | 'HOST_LOCAL' | 'HOST_SUPERVISOR';
  scope: 'V51_R2_PROVIDER_AGENT_SESSION' | 'V51_R2_LOCAL_OWNER_LIVENESS' | 'V51_R2_SUPERVISOR_HEARTBEAT';
  project_id: string;
  generation: number;
  not_before: string;
  not_after: string;
  revoked_at: string | null;
  schemas: string[];
  public_key_pem: string;
};
type RecoveryEvidenceConfiguration = {
  schema: 'PTYSD_RECOVERY_EVIDENCE_TRUST_V1';
  project_id: string;
  trust_root_generation: number;
  store: { kind: 'APPEND_ONLY_ID_ADDRESSED_WITH_DIGEST'; route_id: typeof EVIDENCE_STORE_ROUTE_ID; max_bytes: number };
  trust_roots: { keys: KeyConfiguration[] };
  publication: { status: 'UNAVAILABLE' | 'AVAILABLE'; route_id: typeof PUBLICATION_ROUTE_ID; reason_code: string | null };
  dependencies: { provider_session: RouteConfiguration; supervisor_heartbeat: RouteConfiguration };
};

export type RecoveryIdentity = {
  project_id: string;
  provider: string;
  task_id: string;
  attempt_id: string;
  attempt_epoch: number;
  owner_generation: number;
  fingerprint: string;
  owner_principal_id: string;
  owner_session_id: string;
  provider_session_id: string;
};

export type ProviderSessionReadback = RecoveryIdentity & {
  observation_id: string;
  provider_job_id: string | null;
  observed_at: string;
  state: 'ACTIVE' | 'TERMINAL' | 'UNKNOWN' | 'UNAVAILABLE';
  evidence_ref?: string;
  evidence_digest?: string;
};

export type SupervisorHeartbeatReadback = RecoveryIdentity & {
  supervisor_id: string;
  heartbeat_id: string;
  observed_at: string;
  heartbeat_at_utc: string;
  boot_identity: string;
  process_identity: string;
  service_identity: string;
  task_identity: string;
  evidence_ref: string;
  evidence_digest: string;
};

export type ExactRouteResult<T> =
  | { status: 'AVAILABLE'; value: T }
  | { status: 'UNAVAILABLE'; reason_code: string };

export interface ProviderSessionReadRoute {
  readExact(identity: RecoveryIdentity): ExactRouteResult<ProviderSessionReadback>;
}

export interface SupervisorHeartbeatReadRoute {
  readExact(identity: RecoveryIdentity): ExactRouteResult<SupervisorHeartbeatReadback>;
}

export interface OwnerLivenessPublicationReadRoute {
  readCurrent(): Uint8Array | undefined;
}

export interface ImmutableRecoveryEvidenceReadRoute {
  read(reference: string): Uint8Array | undefined;
}

export type RecoveryEvidenceCompositionOverrides = {
  ownerLivenessPublication?: OwnerLivenessPublicationReadRoute;
  immutableEvidence?: ImmutableRecoveryEvidenceReadRoute;
  providerSession?: ProviderSessionReadRoute;
  supervisorHeartbeat?: SupervisorHeartbeatReadRoute;
};

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stable = (value: any): any => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

const canonicalJson = (value: any) => JSON.stringify(stable(value));
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fail = (code: string): never => { throw new Error(code); };

function requireUtc(value: unknown, code: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fail(code);
  return parsed;
}

function lstatNoReparse(filePath: string, kind: 'file' | 'directory') {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(filePath); } catch { return undefined; }
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) return undefined;
  let realPath: string;
  try { realPath = fs.realpathSync.native(filePath); } catch { return undefined; }
  const normalizeBoundary = (value: string) => {
    let normalized = path.normalize(value);
    if (process.platform === 'win32' && normalized.startsWith('\\\\?\\')) {
      normalized = normalized.startsWith('\\\\?\\UNC\\') ? `\\\\${normalized.slice(8)}` : normalized.slice(4);
    }
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  if (normalizeBoundary(realPath) !== normalizeBoundary(path.resolve(filePath))) return undefined;
  return stat;
}

function safeReadFile(filePath: string, maximumBytes: number): Uint8Array | undefined {
  const before = lstatNoReparse(filePath, 'file');
  if (!before || before.size < 1 || before.size > maximumBytes) return undefined;
  let descriptor: number | undefined;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(filePath, flags);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size ||
        opened.size < 1 || opened.size > maximumBytes) return undefined;
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.size !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino || bytes.byteLength !== opened.size) return undefined;
    return bytes;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readFixedStateFile(stateRoot: string, fileName: string, maximumBytes: number): Uint8Array | undefined {
  if (!lstatNoReparse(stateRoot, 'directory')) return undefined;
  return safeReadFile(path.join(stateRoot, fileName), maximumBytes);
}

function boundedText(value: unknown, maximum = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function fixedReadback<T extends Record<string, any>>(
  stateRoot: string | undefined,
  fileName: string,
  schema: string,
  identity: RecoveryIdentity,
  fields: string[],
  validate: (value: Record<string, any>) => value is T,
  reasonPrefix: string,
): ExactRouteResult<T> {
  if (!stateRoot) return { status: 'UNAVAILABLE', reason_code: `${reasonPrefix}_ROUTE_NOT_CONFIGURED` };
  const bytes = readFixedStateFile(stateRoot, fileName, MAX_ROUTE_READBACK_BYTES);
  if (!bytes) return { status: 'UNAVAILABLE', reason_code: `${reasonPrefix}_READBACK_MISSING_OR_INVALID` };
  let record: Record<string, any>;
  try { record = readJsonObject(bytes, `${reasonPrefix}_READBACK_INVALID`); }
  catch { return { status: 'UNAVAILABLE', reason_code: `${reasonPrefix}_READBACK_INVALID` }; }
  const expectedFields = ['schema', ...fields].sort();
  if (Object.keys(record).sort().join(',') !== expectedFields.join(',') || record.schema !== schema) {
    return { status: 'UNAVAILABLE', reason_code: `${reasonPrefix}_READBACK_INVALID` };
  }
  const { schema: _schema, ...value } = record;
  if (Object.entries(identity).some(([key, expected]) => value[key] !== expected)) {
    return { status: 'UNAVAILABLE', reason_code: `${reasonPrefix}_IDENTITY_MISMATCH` };
  }
  if (!validate(value)) return { status: 'UNAVAILABLE', reason_code: `${reasonPrefix}_READBACK_INVALID` };
  return { status: 'AVAILABLE', value: value as T };
}

const identityFields = [
  'project_id', 'provider', 'task_id', 'attempt_id', 'attempt_epoch', 'owner_generation',
  'fingerprint', 'owner_principal_id', 'owner_session_id', 'provider_session_id',
];

export function createProviderSessionReadRoute(stateRoot: string | undefined): ProviderSessionReadRoute {
  const fields = [...identityFields, 'observation_id', 'provider_job_id', 'observed_at', 'state', 'evidence_ref', 'evidence_digest'];
  return {
    readExact(identity) {
      return fixedReadback<ProviderSessionReadback>(stateRoot, PROVIDER_SESSION_FILENAME,
        PROVIDER_SESSION_READBACK_SCHEMA, identity, fields, (value): value is ProviderSessionReadback =>
          boundedText(value.observation_id) && (value.provider_job_id === null || boundedText(value.provider_job_id)) &&
          typeof value.observed_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.observed_at) &&
          Number.isFinite(Date.parse(value.observed_at)) && ['ACTIVE', 'TERMINAL', 'UNKNOWN', 'UNAVAILABLE'].includes(value.state) &&
          typeof value.evidence_ref === 'string' && value.evidence_ref.startsWith('recovery://provider/') && REF_PATTERN.test(value.evidence_ref) &&
          typeof value.evidence_digest === 'string' && DIGEST_PATTERN.test(value.evidence_digest), 'PROVIDER_SESSION');
    },
  };
}

export function createSupervisorHeartbeatReadRoute(stateRoot: string | undefined): SupervisorHeartbeatReadRoute {
  const fields = [...identityFields, 'supervisor_id', 'heartbeat_id', 'observed_at', 'heartbeat_at_utc',
    'boot_identity', 'process_identity', 'service_identity', 'task_identity', 'evidence_ref', 'evidence_digest'];
  return {
    readExact(identity) {
      return fixedReadback<SupervisorHeartbeatReadback>(stateRoot, SUPERVISOR_HEARTBEAT_FILENAME,
        SUPERVISOR_HEARTBEAT_READBACK_SCHEMA, identity, fields, (value): value is SupervisorHeartbeatReadback =>
          boundedText(value.supervisor_id) && boundedText(value.heartbeat_id) &&
          typeof value.observed_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.observed_at) &&
          Number.isFinite(Date.parse(value.observed_at)) &&
          typeof value.heartbeat_at_utc === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.heartbeat_at_utc) &&
          Number.isFinite(Date.parse(value.heartbeat_at_utc)) && boundedText(value.boot_identity) &&
          boundedText(value.process_identity) && boundedText(value.service_identity) && value.task_identity === identity.task_id &&
          typeof value.evidence_ref === 'string' && value.evidence_ref.startsWith('recovery://supervisor-heartbeat/') && REF_PATTERN.test(value.evidence_ref) &&
          typeof value.evidence_digest === 'string' && DIGEST_PATTERN.test(value.evidence_digest), 'SUPERVISOR_HEARTBEAT');
    },
  };
}

export function createImmutableEvidenceReader(storeRoot: string, maximumBytes = MAX_EVIDENCE_BYTES) {
  const root = path.resolve(storeRoot);
  return (reference: string): Uint8Array | undefined => {
    if (typeof reference !== 'string') return undefined;
    const match = REF_PATTERN.exec(reference);
    if (!match) return undefined;
    const [, kind, id] = match;
    const rootStat = lstatNoReparse(root, 'directory');
    const objectsPath = path.join(root, 'objects');
    const objectsStat = lstatNoReparse(objectsPath, 'directory');
    const kindPath = path.join(objectsPath, kind);
    const kindStat = lstatNoReparse(kindPath, 'directory');
    if (!rootStat || !objectsStat || !kindStat) return undefined;
    const objectPath = path.join(kindPath, `${id}.json`);
    return safeReadFile(objectPath, maximumBytes);
  };
}

/** Converts the actual four-tool factory_status response into the bounded publication consumed by the recovery gate. */
export function createFactoryStatusPublicationReadRoute(readFactoryStatus: () => Uint8Array | undefined): OwnerLivenessPublicationReadRoute {
  return {
    readCurrent() {
      let bytes: Uint8Array | undefined;
      try { bytes = readFactoryStatus(); } catch { return undefined; }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_ROUTE_READBACK_BYTES) return undefined;
      let status: Record<string, any>;
      try { status = readJsonObject(bytes, 'FACTORY_STATUS_RESPONSE_INVALID'); } catch { return undefined; }
      if (status.schema !== 'v51.factory-mcp.readonly-diagnostics.v1' || !isRecord(status.owner_liveness)) return undefined;
      const view = status.owner_liveness;
      if (view.read_status !== 'AVAILABLE' || view.publisher_status !== 'PUBLISHED' ||
          !isRecord(view.components) || !isRecord(view.components.provider_agent_session) ||
          !isRecord(view.components.provider_agent_session.provider_session) ||
          !isRecord(view.components.supervisor_heartbeat) || !isRecord(view.components.supervisor_heartbeat.supervisor)) {
        return Buffer.from(JSON.stringify({ schema: PUBLICATION_SCHEMA, read_status: 'UNAVAILABLE', publisher_status: 'UNAVAILABLE' }));
      }
      const provider = view.components.provider_agent_session.provider_session;
      const heartbeat = view.components.supervisor_heartbeat.supervisor;
      const snapshot = {
        schema: 'v51.factory.owner-liveness.snapshot.v1',
        project_id: view.project_id,
        provider: view.provider,
        task_id: view.task_id,
        attempt_id: view.attempt_id,
        attempt_epoch: view.attempt_epoch,
        owner_generation: view.owner_generation,
        fingerprint: view.fingerprint,
        owner_principal_id: view.owner_principal_id,
        owner_session_id: view.owner_session_id,
        provider_session_id: view.provider_session_id,
        owner_scope: view.owner_scope,
        observation_id: view.observation_id,
        provider_observation_id: view.provider_observation_id,
        observed_at: view.observed_at,
        source: view.source,
        components: {
          provider_agent_session: { provider_session_id: provider.session_id, provider_job_id: provider.job_id },
          supervisor_heartbeat: { supervisor_id: heartbeat.supervisor_id, heartbeat_id: heartbeat.heartbeat_id },
        },
      };
      return Buffer.from(JSON.stringify({
        schema: PUBLICATION_SCHEMA,
        read_status: view.read_status,
        publisher_status: view.publisher_status,
        recovery_evidence: view.recovery_evidence,
        snapshot,
      }));
    },
  };
}

export function createImmutableEvidenceWriter(storeRoot: string, maximumBytes = MAX_EVIDENCE_BYTES) {
  const root = path.resolve(storeRoot);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_EVIDENCE_BYTES) {
    fail('RECOVERY_EVIDENCE_STORE_LIMIT_INVALID');
  }
  return (reference: string, input: Uint8Array): string => {
    const match = typeof reference === 'string' ? REF_PATTERN.exec(reference) : null;
    if (!match || !(input instanceof Uint8Array)) fail('RECOVERY_EVIDENCE_REFERENCE_INVALID');
    const [, kind, id] = match;
    const bytes = Buffer.from(input);
    if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) fail('RECOVERY_EVIDENCE_SIZE_INVALID');
    const expectedSchema = kind === 'provider' ? PROVIDER_SCHEMA : kind === 'local' ? LOCAL_SCHEMA : HEARTBEAT_SCHEMA;
    const record = readJsonObject(bytes, 'RECOVERY_EVIDENCE_INVALID');
    if (Object.keys(record).sort().join(',') !== 'issuer_key_id,payload,schema,signature' ||
        record.schema !== expectedSchema || !boundedText(record.issuer_key_id, 128) || !isRecord(record.payload) ||
        (kind !== 'supervisor-heartbeat' && record.payload.evidence_ref !== reference) || typeof record.signature !== 'string') {
      fail('RECOVERY_EVIDENCE_INVALID');
    }
    const signature = Buffer.from(record.signature, 'base64');
    if (signature.byteLength !== 64 || signature.toString('base64') !== record.signature) fail('RECOVERY_EVIDENCE_INVALID');
    if (!lstatNoReparse(root, 'directory')) fail('RECOVERY_EVIDENCE_STORE_UNAVAILABLE');
    const objectsPath = path.join(root, 'objects');
    const kindPath = path.join(objectsPath, kind);
    if (!lstatNoReparse(objectsPath, 'directory') || !lstatNoReparse(kindPath, 'directory')) {
      fail('RECOVERY_EVIDENCE_STORE_UNAVAILABLE');
    }
    const objectPath = path.join(kindPath, `${id}.json`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(objectPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
        if (written < 1) fail('RECOVERY_EVIDENCE_DURABLE_WRITE_FAILED');
        offset += written;
      }
      fs.fsyncSync(descriptor);
      const writtenStat = fs.fstatSync(descriptor);
      if (!writtenStat.isFile() || writtenStat.size !== bytes.byteLength) fail('RECOVERY_EVIDENCE_DURABLE_WRITE_FAILED');
    } catch (error: any) {
      if (error?.code === 'EEXIST') fail('RECOVERY_EVIDENCE_IMMUTABLE_REFERENCE_EXISTS');
      if (error instanceof Error && /^RECOVERY_EVIDENCE_/.test(error.message)) throw error;
      fail('RECOVERY_EVIDENCE_DURABLE_WRITE_FAILED');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    const readback = safeReadFile(objectPath, maximumBytes);
    if (!readback || !Buffer.from(readback).equals(bytes) || sha256(readback) !== sha256(bytes)) {
      fail('RECOVERY_EVIDENCE_SAME_SOURCE_READBACK_FAILED');
    }
    return sha256(readback);
  };
}

function readJsonObject(bytes: Uint8Array, errorCode: string): Record<string, any> {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isRecord(value)) return fail(errorCode);
    return value;
  } catch {
    return fail(errorCode);
  }
}

function checkedEvidenceRecord(bytes: Uint8Array, schema: string, reference: string, digest: string) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES || sha256(bytes) !== digest) {
    return fail('RECOVERY_EVIDENCE_DIGEST_MISMATCH');
  }
  const record = readJsonObject(bytes, 'RECOVERY_EVIDENCE_INVALID');
  if (Object.keys(record).sort().join(',') !== 'issuer_key_id,payload,schema,signature' ||
      record.schema !== schema || typeof record.issuer_key_id !== 'string' || !isRecord(record.payload) ||
      typeof record.signature !== 'string' || record.payload.evidence_ref !== reference) {
    return fail('RECOVERY_EVIDENCE_INVALID');
  }
  return record;
}

function trustKeys(configuration: RecoveryEvidenceConfiguration, projectId: string, now: number) {
  const providerPublicKeys: Record<string, KeyObject> = {};
  const localPublicKeys: Record<string, KeyObject> = {};
  const supervisorHeartbeatPublicKeys: Record<string, KeyObject> = {};
  const seen = new Set<string>();
  const expected = {
    PROVIDER_AGENT: { schema: PROVIDER_SCHEMA, scope: 'V51_R2_PROVIDER_AGENT_SESSION', target: providerPublicKeys },
    HOST_LOCAL: { schema: LOCAL_SCHEMA, scope: 'V51_R2_LOCAL_OWNER_LIVENESS', target: localPublicKeys },
    HOST_SUPERVISOR: { schema: HEARTBEAT_SCHEMA, scope: 'V51_R2_SUPERVISOR_HEARTBEAT', target: supervisorHeartbeatPublicKeys },
  } as const;
  if (!Array.isArray(configuration.trust_roots.keys)) fail('RECOVERY_TRUST_ROOTS_INVALID');
  for (const key of configuration.trust_roots.keys) {
    if (!isRecord(key) || Object.keys(key).sort().join(',') !==
        'generation,issuer_role,key_id,not_after,not_before,project_id,public_key_pem,revoked_at,schemas,scope' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key.key_id) ||
        typeof key.issuer_role !== 'string' || !(key.issuer_role in expected) || key.project_id !== projectId ||
        key.scope !== expected[key.issuer_role as keyof typeof expected].scope ||
        !Number.isSafeInteger(key.generation) || key.generation < 1 || key.generation > configuration.trust_root_generation ||
        typeof key.public_key_pem !== 'string' || key.public_key_pem.length > 16_384 ||
        !key.public_key_pem.startsWith('-----BEGIN PUBLIC KEY-----') || key.public_key_pem.includes('PRIVATE KEY') ||
        !Array.isArray(key.schemas) ||
        key.schemas.length !== 1 || key.schemas[0] !== expected[key.issuer_role as keyof typeof expected].schema ||
        seen.has(key.key_id)) fail('RECOVERY_TRUST_ROOTS_INVALID');
    seen.add(key.key_id);
    const notBefore = requireUtc(key.not_before, 'RECOVERY_TRUST_ROOTS_INVALID');
    const notAfter = requireUtc(key.not_after, 'RECOVERY_TRUST_ROOTS_INVALID');
    const revokedAt = key.revoked_at === null ? null : requireUtc(key.revoked_at, 'RECOVERY_TRUST_ROOTS_INVALID');
    if (notAfter <= notBefore) fail('RECOVERY_TRUST_ROOTS_INVALID');
    if (revokedAt !== null && revokedAt < notBefore) fail('RECOVERY_TRUST_ROOTS_INVALID');
    if (now < notBefore || now >= notAfter || (revokedAt !== null && now >= revokedAt)) continue;
    let publicKey: KeyObject;
    try { publicKey = createPublicKey(key.public_key_pem); } catch { return fail('RECOVERY_TRUST_ROOT_PUBLIC_KEY_INVALID'); }
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') fail('RECOVERY_TRUST_ROOT_PUBLIC_KEY_INVALID');
    expected[key.issuer_role as keyof typeof expected].target[key.key_id] = publicKey;
  }
  return { providerPublicKeys, localPublicKeys, supervisorHeartbeatPublicKeys };
}

function validateConfiguration(value: unknown, projectId: string): RecoveryEvidenceConfiguration {
  if (!isRecord(value) || value.schema !== 'PTYSD_RECOVERY_EVIDENCE_TRUST_V1' || value.project_id !== projectId ||
      !Number.isSafeInteger(value.trust_root_generation) || value.trust_root_generation < 1 ||
      !isRecord(value.store) || value.store.kind !== 'APPEND_ONLY_ID_ADDRESSED_WITH_DIGEST' || value.store.route_id !== EVIDENCE_STORE_ROUTE_ID ||
      !Number.isSafeInteger(value.store.max_bytes) || value.store.max_bytes < 1 || value.store.max_bytes > MAX_EVIDENCE_BYTES ||
      !isRecord(value.trust_roots) || !Array.isArray(value.trust_roots.keys) ||
      !isRecord(value.publication) || !['AVAILABLE', 'UNAVAILABLE'].includes(value.publication.status) ||
      value.publication.route_id !== PUBLICATION_ROUTE_ID ||
      !isRecord(value.dependencies) || !isRecord(value.dependencies.provider_session) || !isRecord(value.dependencies.supervisor_heartbeat)) {
    return fail('RECOVERY_EVIDENCE_CONFIGURATION_INVALID');
  }
  const configuredRoutes: Array<[unknown, string]> = [
    [value.dependencies.provider_session, PROVIDER_SESSION_ROUTE_ID],
    [value.dependencies.supervisor_heartbeat, SUPERVISOR_HEARTBEAT_ROUTE_ID],
  ];
  for (const [routeValue, expectedRouteId] of configuredRoutes) {
    if (!isRecord(routeValue)) return fail('RECOVERY_EVIDENCE_ROUTE_UNSUPPORTED');
    if (routeValue.status === 'UNAVAILABLE') {
      if (Object.keys(routeValue).sort().join(',') !== 'reason_code,status' ||
          typeof routeValue.reason_code !== 'string' || !routeValue.reason_code) return fail('RECOVERY_EVIDENCE_ROUTE_UNSUPPORTED');
    } else if (routeValue.status === 'AVAILABLE') {
      if (Object.keys(routeValue).sort().join(',') !== 'route_id,status' || routeValue.route_id !== expectedRouteId) {
        return fail('RECOVERY_EVIDENCE_ROUTE_UNSUPPORTED');
      }
    } else return fail('RECOVERY_EVIDENCE_ROUTE_UNSUPPORTED');
  }
  if (value.publication.status === 'UNAVAILABLE') {
    if (typeof value.publication.reason_code !== 'string' || !value.publication.reason_code) {
      return fail('RECOVERY_EVIDENCE_PUBLICATION_CONFIG_INVALID');
    }
  } else {
    if (value.publication.reason_code !== null) return fail('RECOVERY_EVIDENCE_PUBLICATION_CONFIG_INVALID');
  }
  return value as RecoveryEvidenceConfiguration;
}

function publicationIdentity(snapshot: Record<string, any>, observation: RecoveryObservation) {
  const exactKeys: Array<keyof RecoveryIdentity> = [
    'project_id', 'provider', 'task_id', 'attempt_id', 'attempt_epoch', 'owner_generation', 'fingerprint',
    'owner_principal_id', 'owner_session_id', 'provider_session_id',
  ];
  return exactKeys.every(key => snapshot[key] === observation[key]);
}

function observationFromPublication(publicationValue: unknown, readEvidence: (reference: string) => Uint8Array | undefined): RecoveryObservation {
  if (!isRecord(publicationValue) || publicationValue.schema !== PUBLICATION_SCHEMA ||
      publicationValue.read_status !== 'AVAILABLE' || publicationValue.publisher_status !== 'PUBLISHED' ||
      !isRecord(publicationValue.snapshot) || publicationValue.snapshot.schema !== 'v51.factory.owner-liveness.snapshot.v1') {
    return fail('OWNER_LIVENESS_PUBLICATION_UNAVAILABLE');
  }
  const publicationEvidence = publicationValue.recovery_evidence;
  if (isRecord(publicationEvidence) && publicationEvidence.schema === REFERENCES_SCHEMA && publicationEvidence.status === 'UNAVAILABLE') {
    return fail(`OWNER_LIVENESS_SIGNED_EVIDENCE_UNAVAILABLE:${String(publicationEvidence.reason_code ?? 'UNSPECIFIED')}`);
  }
  if (!isRecord(publicationEvidence) || publicationEvidence.schema !== REFERENCES_SCHEMA ||
      publicationEvidence.status !== 'AVAILABLE' || !isRecord(publicationEvidence.provider) || !isRecord(publicationEvidence.local)) {
    return fail('OWNER_LIVENESS_SIGNED_EVIDENCE_REFERENCES_UNAVAILABLE');
  }
  const providerRef = publicationEvidence.provider.evidence_ref;
  const providerDigest = publicationEvidence.provider.evidence_digest;
  const localRef = publicationEvidence.local.evidence_ref;
  const localDigest = publicationEvidence.local.evidence_digest;
  if (typeof providerRef !== 'string' || !REF_PATTERN.test(providerRef) || !providerRef.startsWith('recovery://provider/') ||
      typeof localRef !== 'string' || !REF_PATTERN.test(localRef) || !localRef.startsWith('recovery://local/') ||
      typeof providerDigest !== 'string' || !DIGEST_PATTERN.test(providerDigest) ||
      typeof localDigest !== 'string' || !DIGEST_PATTERN.test(localDigest)) return fail('OWNER_LIVENESS_EVIDENCE_REFERENCE_INVALID');
  const providerBytes = readEvidence(providerRef);
  const localBytes = readEvidence(localRef);
  if (!providerBytes || !localBytes) return fail('RECOVERY_EVIDENCE_UNAVAILABLE');
  const providerRecord = checkedEvidenceRecord(providerBytes, PROVIDER_SCHEMA, providerRef, providerDigest);
  const localRecord = checkedEvidenceRecord(localBytes, LOCAL_SCHEMA, localRef, localDigest);
  const signedObservation = providerRecord.payload;
  if (!isRecord(localRecord.payload)) return fail('LOCAL_OWNER_LIVENESS_REQUIRED');
  const signedLocal = localRecord.payload as LocalLivenessObservation & Record<string, any>;
  const { evidence_digest: _providerDigest, ...providerPayload } = signedObservation;
  const { evidence_digest: _localDigest, ...localPayload } = signedLocal;
  if (signedObservation.evidence_ref !== providerRef || signedLocal.evidence_ref !== localRef ||
      (localRecord.payload as any).evidence_digest !== undefined || canonicalJson(localPayload) !== canonicalJson(localRecord.payload)) {
    return fail('OWNER_LIVENESS_EVIDENCE_REFERENCE_MISMATCH');
  }
  const observation = {
    ...providerPayload,
    evidence_ref: providerRef,
    evidence_digest: providerDigest,
    local_liveness_observation: { ...localPayload, evidence_ref: localRef, evidence_digest: localDigest },
  } as RecoveryObservation;
  if (!publicationIdentity(publicationValue.snapshot, observation)) return fail('OWNER_LIVENESS_PUBLICATION_IDENTITY_MISMATCH');
  const providerComponent = publicationValue.snapshot.components?.provider_agent_session;
  const heartbeatComponent = publicationValue.snapshot.components?.supervisor_heartbeat;
  const localProvider = observation.local_liveness_observation?.components?.provider_agent_session;
  const localHeartbeat = observation.local_liveness_observation?.components?.supervisor_heartbeat;
  if (!isRecord(providerComponent) || !isRecord(heartbeatComponent) || !localProvider || !localHeartbeat ||
      providerComponent.provider_session_id !== localProvider.provider_session_id ||
      providerComponent.provider_job_id !== localProvider.provider_job_id ||
      heartbeatComponent.heartbeat_id !== localHeartbeat.heartbeat_id ||
      heartbeatComponent.supervisor_id !== localHeartbeat.supervisor_id) {
    return fail('OWNER_LIVENESS_PUBLICATION_COMPONENT_MISMATCH');
  }
  return observation;
}

export function createRecoveryEvidenceComposition(
  manifestPath: string,
  projectId: string,
  now: number | (() => number) = Date.now,
  routeOverrides?: RecoveryEvidenceCompositionOverrides,
) {
  const currentTime = typeof now === 'function' ? now : () => now;
  const absoluteManifest = path.resolve(manifestPath);
  const manifestBytes = safeReadFile(absoluteManifest, 256 * 1024);
  if (!manifestBytes) fail('RUNTIME_MANIFEST_UNAVAILABLE');
  const runtimeManifest = readJsonObject(manifestBytes, 'RUNTIME_MANIFEST_INVALID');
  if (runtimeManifest.schema !== 'PTYSD_RUNTIME_MANIFEST_V1' || runtimeManifest.project_id !== projectId) {
    fail('RUNTIME_MANIFEST_IDENTITY_MISMATCH');
  }
  const configuration = validateConfiguration(runtimeManifest.recovery_evidence, projectId);
  const readCurrentConfiguration = (): RecoveryEvidenceConfiguration => {
    const currentBytes = safeReadFile(absoluteManifest, 256 * 1024);
    if (!currentBytes) fail('RUNTIME_MANIFEST_UNAVAILABLE');
    const currentManifest = readJsonObject(currentBytes, 'RUNTIME_MANIFEST_INVALID');
    if (currentManifest.schema !== 'PTYSD_RUNTIME_MANIFEST_V1' || currentManifest.project_id !== projectId) {
      return fail('RUNTIME_MANIFEST_IDENTITY_MISMATCH');
    }
    return validateConfiguration(currentManifest.recovery_evidence, projectId);
  };
  const fixedFactoryStateRoot = process.platform === 'win32' ? path.win32.resolve(FIXED_FACTORY_STATE_ROOT) : undefined;
  const defaultEvidenceRoute: ImmutableRecoveryEvidenceReadRoute = fixedFactoryStateRoot
    ? { read: createImmutableEvidenceReader(path.join(fixedFactoryStateRoot, EVIDENCE_DIRECTORY), configuration.store.max_bytes) }
    : { read: (_reference: string) => undefined };
  const evidenceRoute = routeOverrides?.immutableEvidence ?? defaultEvidenceRoute;
  const readEvidence = (reference: string) => {
    try {
      const currentMaximum = readCurrentConfiguration().store.max_bytes;
      const bytes = evidenceRoute.read(reference);
      return bytes && bytes.byteLength <= currentMaximum ? bytes : undefined;
    } catch { return undefined; }
  };
  const publicationRoute: OwnerLivenessPublicationReadRoute = routeOverrides?.ownerLivenessPublication ?? {
    readCurrent: () => fixedFactoryStateRoot
      ? readFixedStateFile(fixedFactoryStateRoot, OWNER_LIVENESS_FILENAME, 65_536)
      : undefined,
  };
  trustKeys(configuration, projectId, currentTime());
  const readCurrentTrustRoots = (): RecoveryEvidenceKeySet =>
    trustKeys(readCurrentConfiguration(), projectId, currentTime());
  const trust: RecoveryEvidenceTrust = { readEvidence, readCurrentTrustRoots };
  const unavailableRoute = (reasonCode: string) => ({
    readExact: (_identity: RecoveryIdentity): ExactRouteResult<never> => ({ status: 'UNAVAILABLE', reason_code: reasonCode }),
  });
  const fixedProviderRoute = createProviderSessionReadRoute(fixedFactoryStateRoot);
  const fixedHeartbeatRoute = createSupervisorHeartbeatReadRoute(fixedFactoryStateRoot);
  const providerSessionRoute: ProviderSessionReadRoute = routeOverrides?.providerSession ??
    { readExact: identity => {
      const currentRoute = readCurrentConfiguration().dependencies.provider_session;
      if (currentRoute.status !== 'AVAILABLE') return unavailableRoute(currentRoute.reason_code).readExact(identity);
      return fixedProviderRoute.readExact(identity);
    } };
  const supervisorHeartbeatRoute: SupervisorHeartbeatReadRoute = routeOverrides?.supervisorHeartbeat ??
    { readExact: identity => {
      const currentRoute = readCurrentConfiguration().dependencies.supervisor_heartbeat;
      if (currentRoute.status !== 'AVAILABLE') return unavailableRoute(currentRoute.reason_code).readExact(identity);
      return fixedHeartbeatRoute.readExact(identity);
    } };
  const routeStatus = (configurationValue: RouteConfiguration, override: unknown) => {
    if (override) return { status: 'AVAILABLE' as const, reason_code: null };
    if (configurationValue.status === 'UNAVAILABLE') return { ...configurationValue };
    if (!fixedFactoryStateRoot) return { status: 'UNAVAILABLE' as const, reason_code: 'HOST_FIXED_STATE_ROOT_UNAVAILABLE' };
    return { status: 'AVAILABLE' as const, reason_code: null, route_id: configurationValue.route_id };
  };
  const dependencyStatus = () => {
    const currentConfiguration = readCurrentConfiguration();
    const currentKeys = trustKeys(currentConfiguration, projectId, currentTime());
    return {
      publication: { ...currentConfiguration.publication },
      provider_session: routeStatus(currentConfiguration.dependencies.provider_session, routeOverrides?.providerSession),
      supervisor_heartbeat: routeStatus(currentConfiguration.dependencies.supervisor_heartbeat, routeOverrides?.supervisorHeartbeat),
      active_provider_trust_keys: Object.keys(currentKeys.providerPublicKeys).length,
      active_local_trust_keys: Object.keys(currentKeys.localPublicKeys).length,
      active_supervisor_heartbeat_trust_keys: Object.keys(currentKeys.supervisorHeartbeatPublicKeys).length,
      trust_root_generation: currentConfiguration.trust_root_generation,
    };
  };
  const readCurrentObservation = (): RecoveryObservation => {
    const observedNow = currentTime();
    const currentConfiguration = readCurrentConfiguration();
    if (currentConfiguration.publication.status !== 'AVAILABLE') {
      return fail(`OWNER_LIVENESS_PUBLICATION_UNAVAILABLE:${currentConfiguration.publication.reason_code}`);
    }
    let publicationBytes: Uint8Array | undefined;
    try { publicationBytes = publicationRoute.readCurrent(); } catch { publicationBytes = undefined; }
    if (!publicationBytes) return fail('OWNER_LIVENESS_PUBLICATION_UNAVAILABLE');
    const publication = readJsonObject(publicationBytes, 'OWNER_LIVENESS_PUBLICATION_INVALID');
    const observation = observationFromPublication(publication, readEvidence);
    if (!routeOverrides?.providerSession && currentConfiguration.dependencies.provider_session.status !== 'AVAILABLE') {
      return fail(`PROVIDER_SESSION_ROUTE_UNAVAILABLE:${currentConfiguration.dependencies.provider_session.reason_code}`);
    }
    if (!routeOverrides?.supervisorHeartbeat && currentConfiguration.dependencies.supervisor_heartbeat.status !== 'AVAILABLE') {
      return fail(`SUPERVISOR_HEARTBEAT_ROUTE_UNAVAILABLE:${currentConfiguration.dependencies.supervisor_heartbeat.reason_code}`);
    }
    const identity: RecoveryIdentity = {
      project_id: observation.project_id,
      provider: observation.provider,
      task_id: observation.task_id,
      attempt_id: observation.attempt_id,
      attempt_epoch: observation.attempt_epoch,
      owner_generation: observation.owner_generation,
      fingerprint: observation.fingerprint,
      owner_principal_id: observation.owner_principal_id,
      owner_session_id: observation.owner_session_id,
      provider_session_id: observation.provider_session_id,
    };
    const providerReadback = providerSessionRoute.readExact(identity);
    if (providerReadback.status !== 'AVAILABLE') return fail(`PROVIDER_SESSION_ROUTE_UNAVAILABLE:${providerReadback.reason_code}`);
    const provider = providerReadback.value;
    const providerMatches = Object.entries(identity).every(([key, value]) => (provider as any)[key] === value) &&
      provider.observation_id === observation.observation_id && provider.provider_job_id === observation.provider_job_id &&
      provider.state === 'TERMINAL' && provider.observed_at === observation.observed_at &&
      provider.evidence_ref === observation.evidence_ref && provider.evidence_digest === observation.evidence_digest;
    if (!providerMatches) return fail('PROVIDER_SESSION_ROUTE_IDENTITY_MISMATCH');
    const heartbeat = observation.local_liveness_observation!.components.supervisor_heartbeat;
    const heartbeatReadback = supervisorHeartbeatRoute.readExact(identity);
    if (heartbeatReadback.status !== 'AVAILABLE') return fail(`SUPERVISOR_HEARTBEAT_ROUTE_UNAVAILABLE:${heartbeatReadback.reason_code}`);
    const liveHeartbeat = heartbeatReadback.value;
    const heartbeatMatches = Object.entries(identity).every(([key, value]) => (liveHeartbeat as any)[key] === value) &&
      liveHeartbeat.supervisor_id === heartbeat.supervisor_id && liveHeartbeat.heartbeat_id === heartbeat.heartbeat_id &&
      liveHeartbeat.observed_at === heartbeat.observed_at && liveHeartbeat.heartbeat_at_utc === heartbeat.heartbeat_at_utc &&
      liveHeartbeat.boot_identity === heartbeat.boot_identity && liveHeartbeat.process_identity === heartbeat.process_identity &&
      liveHeartbeat.service_identity === heartbeat.service_identity && liveHeartbeat.task_identity === heartbeat.task_identity &&
      liveHeartbeat.evidence_ref === heartbeat.heartbeat_evidence_ref && liveHeartbeat.evidence_digest === heartbeat.heartbeat_evidence_digest;
    if (!heartbeatMatches) return fail('SUPERVISOR_HEARTBEAT_ROUTE_IDENTITY_MISMATCH');
    const providerObservedAt = requireUtc(provider.observed_at, 'PROVIDER_SESSION_ROUTE_OBSERVATION_INVALID');
    const heartbeatObservedAt = requireUtc(liveHeartbeat.observed_at, 'SUPERVISOR_HEARTBEAT_ROUTE_OBSERVATION_INVALID');
    if (observedNow - providerObservedAt < 0 || observedNow - providerObservedAt > 30_000) return fail('PROVIDER_SESSION_ROUTE_OBSERVATION_STALE');
    if (observedNow - heartbeatObservedAt < 0 || observedNow - heartbeatObservedAt > 30_000) return fail('SUPERVISOR_HEARTBEAT_ROUTE_OBSERVATION_STALE');
    return observation;
  };
  return { trust, providerSessionRoute, supervisorHeartbeatRoute, dependencyStatus, readCurrentObservation };
}
