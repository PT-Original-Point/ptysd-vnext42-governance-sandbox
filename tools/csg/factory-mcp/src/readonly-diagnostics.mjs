import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const IDENTIFIER = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const HOST_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID = /^[a-f0-9]{32}$/;
const OWNER_FINGERPRINT = /^[a-f0-9]{64}$/;
const RECOVERY_EVIDENCE_REFERENCE = /^recovery:\/\/(?:provider|local)\/[a-f0-9]{32}$/;
const OWNER_LIVENESS_EVIDENCE_REF = 'factory-mcp://state/owner-liveness.json';
const OWNER_LIVENESS_LOCAL_COLLECTOR = 'system-broker-fixed-owner-liveness-collector';
const OWNER_LIVENESS_MAX_AGE_MS = 30_000;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_BYTES = 512 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, pattern = TOKEN, max = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !pattern.test(value)) return null;
  return value;
}

function boundedPositiveInteger(value, maximum = 2147483647) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : null;
}

function unavailableRecoveryEvidence(reasonCode = 'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED') {
  return { schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1', status: 'UNAVAILABLE', reason_code: reasonCode };
}

function projectRecoveryEvidence(value) {
  if (!isRecord(value) || value.schema !== 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1') {
    return unavailableRecoveryEvidence(value === undefined ? 'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED' : 'RECOVERY_EVIDENCE_REFERENCE_INVALID');
  }
  if (value.status === 'UNAVAILABLE' &&
      Object.keys(value).sort().join(',') === 'reason_code,schema,status' &&
      boundedString(value.reason_code, /^[A-Z0-9_]{1,96}$/)) {
    return unavailableRecoveryEvidence(value.reason_code);
  }
  if (value.status !== 'AVAILABLE' || Object.keys(value).sort().join(',') !== 'local,provider,schema,status' ||
      !isRecord(value.provider) || !isRecord(value.local) ||
      Object.keys(value.provider).sort().join(',') !== 'evidence_digest,evidence_ref' ||
      Object.keys(value.local).sort().join(',') !== 'evidence_digest,evidence_ref' ||
      typeof value.provider.evidence_ref !== 'string' || !value.provider.evidence_ref.startsWith('recovery://provider/') ||
      !RECOVERY_EVIDENCE_REFERENCE.test(value.provider.evidence_ref) ||
      typeof value.local.evidence_ref !== 'string' || !value.local.evidence_ref.startsWith('recovery://local/') ||
      !RECOVERY_EVIDENCE_REFERENCE.test(value.local.evidence_ref) ||
      !SHA256.test(value.provider.evidence_digest) || !SHA256.test(value.local.evidence_digest)) {
    return unavailableRecoveryEvidence('RECOVERY_EVIDENCE_REFERENCE_INVALID');
  }
  return {
    schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',
    status: 'AVAILABLE',
    provider: { evidence_ref: value.provider.evidence_ref, evidence_digest: value.provider.evidence_digest },
    local: { evidence_ref: value.local.evidence_ref, evidence_digest: value.local.evidence_digest },
  };
}

function projectCapability(value, expectedProjectId) {
  if (!isRecord(value)) return { read_status: 'UNAVAILABLE' };
  const status = value.read_status;
  if (!['PRESENT', 'MISSING', 'INVALID', 'UNAVAILABLE'].includes(status)) {
    return { read_status: 'INVALID' };
  }
  if (status !== 'PRESENT') return { read_status: status };
  const sid = boundedString(value.trusted_caller_sid, /^S-1-(?:\d+-?)+$/, 184);
  const result = {
    read_status: 'PRESENT',
    schema: boundedString(value.schema, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    project_id: boundedString(value.project_id, /^[A-Z0-9][A-Z0-9._-]{0,79}$/),
    capability_id: boundedString(value.capability_id, IDENTIFIER),
    capability_generation: boundedPositiveInteger(value.capability_generation),
    max_timeout_seconds: boundedPositiveInteger(value.max_timeout_seconds, 86400),
    production_allowed: typeof value.production_allowed === 'boolean' ? value.production_allowed : null,
    business_project_allowed: typeof value.business_project_allowed === 'boolean' ? value.business_project_allowed : null,
    public_tool_count: Number.isSafeInteger(value.public_tool_count) && value.public_tool_count >= 0 && value.public_tool_count <= 32
      ? value.public_tool_count : null,
    execution_authority_mode: boundedString(value.execution_authority_mode, /^[A-Z0-9][A-Z0-9._-]{0,79}$/),
    trusted_caller_sid: sid,
    trusted_caller_boundary: sid === 'S-1-5-20' ? 'SHARED_ACCOUNT_REQUIRES_RUNTIME_TASK_SID_PROOF' : 'NOT_ESTABLISHED',
  };
  const required = ['schema', 'project_id', 'capability_id', 'capability_generation', 'max_timeout_seconds',
    'production_allowed', 'business_project_allowed', 'public_tool_count', 'execution_authority_mode', 'trusted_caller_sid'];
  return required.every(key => result[key] !== null) &&
    (expectedProjectId === undefined || result.project_id === expectedProjectId)
    ? result : { read_status: 'INVALID' };
}

function projectHostGuard(value, expectedHostId) {
  if (!isRecord(value) || value.read_status !== 'AVAILABLE' || !isRecord(value.payload)) {
    return { read_status: value?.read_status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'INVALID' };
  }
  const payload = value.payload;
  const result = {
    read_status: 'AVAILABLE',
    schema: boundedString(payload.schema, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    host: boundedString(payload.host, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    boot_identity: boundedString(payload.boot_identity, /^[A-Za-z0-9._|:+-]{1,160}$/),
    vm_name: boundedString(payload.vm_name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    vm_id: boundedString(payload.vm_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 36),
    vm_state: boundedString(payload.vm_state, /^[A-Za-z0-9._-]{1,64}$/),
    guest_ip: boundedString(payload.guest_ip, /^[0-9a-f:.]{2,64}$/i),
    ssh22_reachable: typeof payload.ssh22_reachable === 'boolean' ? payload.ssh22_reachable : null,
    run_as: boundedString(payload.run_as, /^[A-Za-z0-9 _\\.-]{1,128}$/),
  };
  const required = ['schema', 'host', 'boot_identity', 'vm_name', 'vm_id', 'vm_state', 'guest_ip', 'ssh22_reachable', 'run_as'];
  return result.schema === 'v45.hostguard.status.v1' && required.every(key => result[key] !== null) && result.host === expectedHostId
    ? result : { read_status: 'INVALID' };
}

function projectOrphanRecord(value, expectedProjectId) {
  if (!isRecord(value) || value.state !== 'ORPHANED') return null;
  const requestId = boundedString(value.request_id, REQUEST_ID, 32);
  const receiptDigest = boundedString(value.receipt_digest, SHA256, 71);
  if (!requestId || !receiptDigest) return null;
  const record = {
    request_id: requestId,
    project_id: boundedString(value.project_id, /^[A-Z0-9][A-Z0-9._-]{0,79}$/),
    capability_id: boundedString(value.capability_id, IDENTIFIER),
    operation_id: boundedString(value.operation_id, IDENTIFIER),
    control_oid: boundedString(value.control_oid, GIT_OID, 64),
    checkpoint_digest: boundedString(value.checkpoint_digest, SHA256, 71),
    authorization_envelope_digest: boundedString(value.authorization_envelope_digest, SHA256, 71),
    capability_generation: boundedPositiveInteger(value.capability_generation),
    run_id: boundedString(value.run_id, IDENTIFIER),
    task_id: boundedString(value.task_id, IDENTIFIER),
    attempt_id: boundedString(value.attempt_id, IDENTIFIER),
    attempt_epoch: boundedPositiveInteger(value.attempt_epoch),
    started_at_utc: boundedString(value.started_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    finished_at_utc: boundedString(value.finished_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    timeout_seconds: boundedPositiveInteger(value.timeout_seconds, 86400),
    state: 'ORPHANED',
    historical_execution_outcome: boundedString(value.historical_execution_outcome, TOKEN) ?? 'UNKNOWN',
    current_target_state: 'NOT_OBSERVED_BY_READONLY_STATUS',
    error_code: boundedString(value.error_code, /^[A-Z0-9][A-Z0-9._-]{0,79}$/),
    receipt_digest: receiptDigest,
  };
  const required = ['project_id', 'capability_id', 'operation_id', 'control_oid', 'checkpoint_digest',
    'authorization_envelope_digest', 'capability_generation', 'run_id', 'task_id', 'attempt_id', 'attempt_epoch'];
  return required.every(key => record[key] !== null) &&
    (expectedProjectId === undefined || record.project_id === expectedProjectId) ? record : null;
}

export function projectOrphanStatusView(value, expectedProjectId) {
  if (!isRecord(value)) return { read_status: 'UNAVAILABLE', total_count: null, records: [], truncated: true };
  const status = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(value.read_status) ? value.read_status : 'UNAVAILABLE';
  const sourceRecords = Array.isArray(value.records) ? value.records : [];
  const records = [];
  let invalidRecord = false;
  for (const candidate of sourceRecords.slice(0, 16)) {
    const record = projectOrphanRecord(candidate, expectedProjectId);
    if (record) records.push(record);
    else invalidRecord = true;
  }
  const sourceComplete = status === 'COMPLETE' && value.truncated !== true && !invalidRecord;
  const totalCount = sourceComplete ? boundedPositiveInteger(value.total_count, 100000) ?? (value.total_count === 0 ? 0 : null) : null;
  const complete = sourceComplete && totalCount !== null && totalCount >= records.length;
  return {
    read_status: complete ? 'COMPLETE' : status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PARTIAL',
    total_count: complete ? totalCount : null,
    records,
    truncated: !complete || totalCount > records.length,
    consistency: 'BEST_EFFORT_NON_ATOMIC_DIRECTORY_READ',
    read_at_utc: boundedString(value.read_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
  };
}

function projectBroker(value, nowMs = Date.now()) {
  if (!isRecord(value)) return { read_status: 'UNAVAILABLE' };
  if (value.read_status !== 'AVAILABLE') return { read_status: ['MISSING', 'UNAVAILABLE', 'INVALID'].includes(value.read_status) ? value.read_status : 'INVALID' };
  const result = {
    read_status: 'AVAILABLE',
    schema: boundedString(value.schema, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    status: boundedString(value.status, /^[A-Z0-9][A-Z0-9._-]{0,63}$/),
    pid: boundedPositiveInteger(value.pid),
    run_as: boundedString(value.run_as, /^[A-Za-z0-9 _\\.-]{1,128}$/),
    recorded_at_utc: boundedString(value.recorded_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    owner_liveness_publisher_status: boundedString(value.owner_liveness_publisher_status,
      /^(?:PUBLISHED|SOURCE_MISSING|SOURCE_INVALID|SOURCE_STALE|PUBLISH_FAILED|UNAVAILABLE)$/),
  };
  const required = ['schema', 'status', 'pid', 'run_as', 'recorded_at_utc'];
  if (!required.every(key => result[key] !== null)) return { read_status: 'INVALID' };
  if (!freshUtc(result.recorded_at_utc, nowMs)) return { read_status: 'STALE' };
  return result;
}

function projectTasks(value) {
  if (!isRecord(value) || !Array.isArray(value.records)) return { read_status: 'UNAVAILABLE', records: [] };
  const records = [];
  let invalidRecord = false;
  for (const item of value.records.slice(0, 16)) {
    if (!isRecord(item) || typeof item.task_name !== 'string' ||
        !/^PTYSD-FactoryMCP-(?:HostGuard-Broker|Tunnel)-V\d+$/.test(item.task_name)) continue;
    const record = {
      task_name: item.task_name,
      state: boundedString(item.state, /^[A-Za-z0-9._-]{1,64}$/),
      enabled: typeof item.enabled === 'boolean' ? item.enabled : null,
      principal: boundedString(item.principal, /^[A-Za-z0-9 _\\.-]{1,128}$/),
      process_token_sid_type: item.process_token_sid_type === 'Unrestricted' ? 'Unrestricted' : null,
      task_sid: boundedString(item.task_sid, /^S-1-5-87(?:-\d+)+$/, 184),
      action_executable: boundedString(item.action_executable, /^[A-Za-z0-9_.-]{1,128}$/),
    };
    const tunnelTask = item.task_name === 'PTYSD-FactoryMCP-Tunnel-V47';
    const securityValid = tunnelTask
      ? record.process_token_sid_type === 'Unrestricted' && record.task_sid !== null
      : record.process_token_sid_type === null && record.task_sid === null;
    if (record.state === null || record.enabled === null || record.principal === null || !securityValid || record.action_executable === null) invalidRecord = true;
    else records.push(record);
  }
  const status = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(value.read_status) ? value.read_status : 'INVALID';
  return { read_status: invalidRecord && status === 'COMPLETE' ? 'PARTIAL' : status, records };
}

function projectServices(value) {
  if (!isRecord(value) || !Array.isArray(value.records)) return { read_status: 'UNAVAILABLE', records: [] };
  const records = [];
  let invalidRecord = false;
  for (const item of value.records.slice(0, 16)) {
    if (!isRecord(item)) { invalidRecord = true; continue; }
    const matchReason = boundedString(item.match_reason, /^(?:FACTORY_SERVICE_NAME|FACTORY_SERVICE_DISPLAY_NAME|FACTORY_INSTALL_PATH)$/);
    if (!matchReason) { invalidRecord = true; continue; }
    const record = {
      service_name: boundedString(item.service_name, /^[A-Za-z0-9_.-]{1,128}$/),
      match_reason: matchReason,
      state: boundedString(item.state, /^[A-Za-z0-9._-]{1,64}$/),
      start_mode: boundedString(item.start_mode, /^[A-Za-z0-9._-]{1,64}$/),
      start_name: boundedString(item.start_name, /^[A-Za-z0-9 _\\.-]{1,128}$/),
    };
    if (Object.values(record).some(field => field === null)) invalidRecord = true;
    else records.push(record);
  }
  const status = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(value.read_status) ? value.read_status : 'INVALID';
  return { read_status: invalidRecord && status === 'COMPLETE' ? 'PARTIAL' : status, records };
}

function projectProcesses(value) {
  if (!isRecord(value) || !Array.isArray(value.records)) return { read_status: 'UNAVAILABLE', records: [] };
  const records = [];
  let invalidRecord = false;
  for (const item of value.records.slice(0, 16)) {
    if (!isRecord(item) || !['MCP_PARENT', 'HOSTGUARD_BROKER'].includes(item.role)) continue;
    const pid = boundedPositiveInteger(item.pid);
    if (!pid) { invalidRecord = true; continue; }
    const record = {
      role: item.role,
      pid,
      owner: boundedString(item.owner, /^[A-Za-z0-9 _\\.-]{1,128}$/),
      image_name: boundedString(item.image_name, /^[A-Za-z0-9_.-]{1,128}$/),
      started_at_utc: boundedString(item.started_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    };
    if (record.owner === null || record.image_name === null || record.started_at_utc === null) invalidRecord = true;
    else records.push(record);
  }
  const status = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(value.read_status) ? value.read_status : 'INVALID';
  return { read_status: invalidRecord && status === 'COMPLETE' ? 'PARTIAL' : status, records };
}

function projectTrustedCaller(value) {
  const sid = boundedString(value?.sid, /^S-1-(?:\d+-?)+$/, 184);
  const taskSid = boundedString(value?.task_sid, /^S-1-5-87(?:-\d+)+$/, 184);
  const sharedNetworkService = sid === 'S-1-5-20';
  const queueAclStatus = ['PASS', 'FAIL_CLOSED', 'NOT_ESTABLISHED'].includes(value?.queue_acl_status)
    ? value.queue_acl_status : 'NOT_ESTABLISHED';
  const taskSidPresent = value?.task_sid_present === true && taskSid !== null;
  const unique = sharedNetworkService && taskSidPresent && queueAclStatus === 'PASS';
  return {
    identity: boundedString(value?.identity, /^[A-Za-z0-9 _\\.-]{1,128}$/),
    sid,
    task_sid: taskSid,
    task_sid_present: taskSidPresent,
    queue_acl_status: queueAclStatus,
    unique_os_enforced: unique ? true : sharedNetworkService ? false : null,
    boundary_status: unique ? 'TASK_SID_ACL_PROTECTED' : sharedNetworkService ? 'SHARED_NETWORK_SERVICE_NOT_UNIQUE' : 'NOT_ESTABLISHED',
  };
}

const OWNER_COMPONENTS = {
  os_process: {
    source: 'local-os-process-readback',
    states: ['ACTIVE', 'ABSENT', 'UNKNOWN', 'UNAVAILABLE'],
  },
  provider_agent_session: {
    source: 'provider-agent-session-readback',
    states: ['ACTIVE', 'TERMINAL', 'UNKNOWN', 'UNAVAILABLE'],
  },
  supervisor_heartbeat: {
    source: 'host-supervisor-heartbeat-readback',
    states: ['ACTIVE', 'EXPIRED', 'UNKNOWN', 'UNAVAILABLE'],
  },
};

function freshUtc(value, nowMs) {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false;
  const observedAt = Date.parse(value);
  const age = nowMs - observedAt;
  return Number.isFinite(observedAt) && age >= 0 && age <= OWNER_LIVENESS_MAX_AGE_MS;
}

function validNotFutureUtc(value, nowMs) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(value)) return false;
  const observedAt = Date.parse(value);
  return Number.isFinite(observedAt) && observedAt <= nowMs;
}

function invalidOwnerLiveness(reason = 'INVALID_SNAPSHOT') {
  return {
    view: {
      read_status: 'INVALID',
      evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
      evidence_digest: null,
      reconciliation_verdict: 'NOT_PERFORMED',
      reason,
    },
    localObservation: null,
  };
}

export function projectOwnerLiveness(value, nowMs = Date.now(), expectedProjectId) {
  if (!isRecord(value)) {
    return {
      view: {
        read_status: 'MISSING',
        evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
        evidence_digest: null,
        reconciliation_verdict: 'NOT_PERFORMED',
      },
      localObservation: null,
    };
  }
  const readStatus = ['MISSING', 'UNAVAILABLE', 'INVALID', 'STALE'].includes(value.read_status)
    ? value.read_status : value.read_status === 'AVAILABLE' ? 'AVAILABLE' : 'INVALID';
  const publisherMetadata = {
    publisher_status: boundedString(value.publisher_status,
      /^(?:PUBLISHED|SOURCE_MISSING|SOURCE_INVALID|SOURCE_STALE|PUBLISH_FAILED|UNAVAILABLE)$/),
    reason: boundedString(value.reason, /^[A-Z0-9_]{1,64}$/),
    publisher_observed_at_utc: boundedString(value.publisher_observed_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    source_observed_at_utc: boundedString(value.source_observed_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    source_digest: boundedString(value.source_digest, SHA256, 71),
  };
  if (value.publisher_status !== undefined && publisherMetadata.publisher_status === null) {
    return invalidOwnerLiveness('PUBLISHER_STATUS_INVALID');
  }
  if (publisherMetadata.publisher_status !== null &&
      !freshUtc(publisherMetadata.publisher_observed_at_utc, nowMs)) {
    return {
      view: {
        read_status: 'STALE',
        evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
        evidence_digest: boundedString(value.evidence_digest, SHA256, 71),
        ...publisherMetadata,
        reason: 'PUBLISHER_OBSERVATION_STALE',
        reconciliation_verdict: 'NOT_PERFORMED',
      },
      localObservation: null,
    };
  }
  if (readStatus !== 'AVAILABLE') {
    return {
      view: {
        read_status: readStatus,
        evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
        evidence_digest: boundedString(value.evidence_digest, SHA256, 71),
        ...publisherMetadata,
        reconciliation_verdict: 'NOT_PERFORMED',
      },
      localObservation: null,
    };
  }
  if (value.acl_status !== 'VERIFIED_READ_ONLY' || !isRecord(value.snapshot) ||
      value.snapshot.schema !== 'v51.factory.owner-liveness.snapshot.v1') {
    return invalidOwnerLiveness('SNAPSHOT_TRUST_BOUNDARY_INVALID');
  }

  const snapshot = value.snapshot;
  const digest = boundedString(value.evidence_digest, SHA256, 71);
  if (!digest) return invalidOwnerLiveness('SNAPSHOT_DIGEST_INVALID');
  const identity = {
    project_id: boundedString(snapshot.project_id, /^[A-Z0-9][A-Z0-9._-]{0,79}$/),
    provider: boundedString(snapshot.provider, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    task_id: boundedString(snapshot.task_id, IDENTIFIER),
    attempt_id: boundedString(snapshot.attempt_id, IDENTIFIER),
    attempt_epoch: boundedPositiveInteger(snapshot.attempt_epoch),
    owner_generation: boundedPositiveInteger(snapshot.owner_generation),
    fingerprint: boundedString(snapshot.fingerprint, OWNER_FINGERPRINT, 64),
  };
  const ownerPrincipal = boundedString(snapshot.owner_principal_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  const ownerScope = boundedString(snapshot.owner_scope, IDENTIFIER);
  const ownerSessionId = snapshot.owner_session_id === null || snapshot.owner_session_id === undefined
    ? null : boundedString(snapshot.owner_session_id);
  const providerSessionId = snapshot.provider_session_id === null || snapshot.provider_session_id === undefined
    ? null : boundedString(snapshot.provider_session_id);
  const recoveryEvidence = projectRecoveryEvidence(value.recovery_evidence);
  const observationId = boundedString(snapshot.observation_id);
  const isLocalCollectorSnapshot = snapshot.source === OWNER_LIVENESS_LOCAL_COLLECTOR;
  const providerObservationId = snapshot.provider_observation_id === null
    ? null : boundedString(snapshot.provider_observation_id);
  const observedAt = boundedString(snapshot.observed_at, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/, 64);
  if (Object.values(identity).some(field => field === null) || !ownerPrincipal || !ownerScope ||
      !observationId || (isLocalCollectorSnapshot ?
        (providerObservationId !== null && (recoveryEvidence.status !== 'AVAILABLE' || !ownerSessionId || !providerSessionId))
        : (!providerObservationId || observationId === providerObservationId)) ||
      (isLocalCollectorSnapshot && recoveryEvidence.status === 'AVAILABLE' &&
        (!providerObservationId || !ownerSessionId || !providerSessionId)) ||
      (!isLocalCollectorSnapshot && snapshot.source !== 'authorized-cross-source-liveness-readback') ||
      !observedAt) {
    return invalidOwnerLiveness('SNAPSHOT_IDENTITY_INVALID');
  }
  // Project is the protected routing boundary. Task, attempt, epoch, generation,
  // and owner identifiers are observation metadata: validate their shape and
  // cross-source consistency below, but do not pin them to a prior Session.
  if (identity.project_id !== expectedProjectId) return invalidOwnerLiveness('TARGET_PROJECT_MISMATCH');
  if (isLocalCollectorSnapshot) {
    const expectedFingerprint = createHash('sha256').update([
      identity.project_id,
      identity.provider,
      identity.task_id,
      identity.attempt_id,
      String(identity.attempt_epoch),
      String(identity.owner_generation),
      ownerPrincipal,
      ownerScope,
    ].join('\n'), 'utf8').digest('hex');
    if (identity.fingerprint !== expectedFingerprint) return invalidOwnerLiveness('IDENTITY_FINGERPRINT_MISMATCH');
  }
  if (!freshUtc(observedAt, nowMs)) {
    return {
      view: {
        read_status: 'STALE',
        evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
        evidence_digest: digest,
        observed_at: observedAt,
        reconciliation_verdict: 'NOT_PERFORMED',
      },
      localObservation: null,
    };
  }
  if (!isRecord(snapshot.components) ||
      Object.keys(snapshot.components).sort().join(',') !== 'os_process,provider_agent_session,supervisor_heartbeat') {
    return invalidOwnerLiveness('COMPONENT_SET_INVALID');
  }

  const observationIds = new Set([observationId]);
  if (providerObservationId !== null) observationIds.add(providerObservationId);
  const components = {};
  let componentsFresh = true;
  let componentsMatchStaleContract = true;
  for (const [name, requirement] of Object.entries(OWNER_COMPONENTS)) {
    const component = snapshot.components[name];
    if (!isRecord(component)) return invalidOwnerLiveness('COMPONENT_INVALID');
    const componentId = boundedString(component.observation_id);
    const componentProviderObservationId = component.provider_observation_id === null
      ? null : boundedString(component.provider_observation_id);
    const componentObservedAt = boundedString(component.observed_at, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/, 64);
    const componentSource = boundedString(component.source);
    const componentState = boundedString(component.state, /^[A-Z][A-Z0-9_]{0,31}$/);
    if (!componentId || observationIds.has(componentId) ||
      componentProviderObservationId !== providerObservationId ||
        componentSource !== requirement.source || !requirement.states.includes(componentState) ||
        !componentObservedAt) {
      return invalidOwnerLiveness('COMPONENT_IDENTITY_INVALID');
    }
    observationIds.add(componentId);
    for (const [key, expected] of Object.entries(identity)) {
      if (component[key] !== expected) return invalidOwnerLiveness('COMPONENT_IDENTITY_MISMATCH');
    }
    if (!freshUtc(componentObservedAt, nowMs)) componentsFresh = false;

    const projected = {
      observation_id: componentId,
      provider_observation_id: providerObservationId,
      ...identity,
      observed_at: componentObservedAt,
      source: componentSource,
      state: componentState,
    };
    if (name === 'os_process') {
      const processId = component.process_id === null
        ? null : boundedPositiveInteger(component.process_id);
      const processStart = component.process_started_at_utc === null
        ? null : boundedString(component.process_started_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/, 64);
      projected.process = {
        process_id: processId,
        image_name: boundedString(component.process_image, /^[A-Za-z0-9_.-]{1,128}$/),
        principal: boundedString(component.process_principal, /^[A-Za-z0-9 _\\.-]{1,128}$/),
        started_at_utc: processStart,
      };
      if (isLocalCollectorSnapshot) {
        const candidates = Array.isArray(component.candidate_processes) ? component.candidate_processes : null;
        projected.identity_link_status = component.identity_link_status === 'UNRESOLVED' ? 'UNRESOLVED' : null;
        projected.candidate_processes = [];
        if (!candidates || candidates.length > 8 || component.state !== 'UNKNOWN' && component.state !== 'UNAVAILABLE' ||
            projected.identity_link_status !== 'UNRESOLVED' || processId !== null || processStart !== null) {
          return invalidOwnerLiveness('OS_PROCESS_IDENTITY_INVALID');
        }
        for (const candidate of candidates) {
          if (!isRecord(candidate)) return invalidOwnerLiveness('OS_PROCESS_IDENTITY_INVALID');
          const candidateProcessId = boundedPositiveInteger(candidate.process_id);
          const candidateImage = boundedString(candidate.process_image, /^(?:Codex|ChatGPT)\.exe$/, 128);
          const candidatePrincipal = boundedString(candidate.process_principal, /^[A-Za-z0-9 _\\.-]{1,128}$/);
          const candidateStarted = boundedString(candidate.process_started_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/, 64);
          if (!candidateProcessId || !candidateImage || !candidatePrincipal || !candidateStarted ||
              !validNotFutureUtc(candidateStarted, nowMs)) return invalidOwnerLiveness('OS_PROCESS_IDENTITY_INVALID');
          projected.candidate_processes.push({
            process_id: candidateProcessId,
            image_name: candidateImage,
            principal: candidatePrincipal,
            started_at_utc: candidateStarted,
          });
        }
      }
      if ((componentState === 'ACTIVE' && (!processId || !processStart ||
          !validNotFutureUtc(processStart, nowMs) ||
          !projected.process.image_name || !projected.process.principal)) ||
          (componentState === 'ABSENT' && (processId !== null || processStart !== null))) {
        return invalidOwnerLiveness('OS_PROCESS_IDENTITY_INVALID');
      }
    } else if (name === 'provider_agent_session') {
      projected.provider_session = {
        session_id: boundedString(component.provider_session_id),
        job_id: component.provider_job_id === null ? null : boundedString(component.provider_job_id),
        unavailability_reason: boundedString(component.unavailability_reason, /^[A-Z0-9_]{1,64}$/),
      };
      if (isLocalCollectorSnapshot) {
        if (recoveryEvidence.status === 'AVAILABLE') {
          if (componentState !== 'TERMINAL' || !providerObservationId ||
              projected.provider_session.session_id !== providerSessionId ||
              projected.provider_session.unavailability_reason !== null) {
            return invalidOwnerLiveness('PROVIDER_SESSION_IDENTITY_INVALID');
          }
        } else if (componentState !== 'UNAVAILABLE' || providerObservationId !== null ||
            projected.provider_session.session_id !== null || projected.provider_session.job_id !== null ||
            projected.provider_session.unavailability_reason !== 'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED') {
          return invalidOwnerLiveness('PROVIDER_SESSION_IDENTITY_INVALID');
        }
      }
      if (componentState !== 'UNAVAILABLE' && !projected.provider_session.session_id) {
        return invalidOwnerLiveness('PROVIDER_SESSION_IDENTITY_INVALID');
      }
    } else {
      const readbackStatus = component.readback_status === undefined && componentState === 'UNAVAILABLE'
        ? 'UNAVAILABLE' : boundedString(component.readback_status, /^(?:UNAVAILABLE|PRESENT)$/);
      projected.supervisor = {
        readback_status: readbackStatus,
        supervisor_id: boundedString(component.supervisor_id, IDENTIFIER),
        heartbeat_id: boundedString(component.heartbeat_id),
        heartbeat_at_utc: component.heartbeat_at_utc === null
          ? null : boundedString(component.heartbeat_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/, 64),
        unavailability_reason: boundedString(component.unavailability_reason, /^[A-Z0-9_]{1,64}$/),
        boot_identity: component.boot_identity === null || component.boot_identity === undefined
          ? null : boundedString(component.boot_identity, /^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$/),
        process_identity: component.process_identity === null || component.process_identity === undefined
          ? null : boundedString(component.process_identity, /^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$/),
        service_identity: component.service_identity === null || component.service_identity === undefined
          ? null : boundedString(component.service_identity, /^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$/),
        task_identity: component.task_identity === null || component.task_identity === undefined
          ? null : boundedString(component.task_identity, IDENTIFIER),
        evidence_ref: component.heartbeat_evidence_ref === null || component.heartbeat_evidence_ref === undefined
          ? null : boundedString(component.heartbeat_evidence_ref, /^recovery:\/\/supervisor-heartbeat\/[a-f0-9]{32}$/),
        evidence_digest: component.heartbeat_evidence_digest === null || component.heartbeat_evidence_digest === undefined
          ? null : boundedString(component.heartbeat_evidence_digest, /^sha256:[a-f0-9]{64}$/),
      };
      if (isLocalCollectorSnapshot) {
        const taskObservation = component.supervisor_task_observation;
        if (!isRecord(taskObservation) || !['PRESENT', 'UNAVAILABLE'].includes(taskObservation.read_status)) {
          return invalidOwnerLiveness('SUPERVISOR_TASK_OBSERVATION_INVALID');
        }
        const taskObservedAt = boundedString(taskObservation.observed_at, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/, 64);
        const taskProjection = {
          read_status: taskObservation.read_status,
          observed_at: taskObservedAt,
          task_name: boundedString(taskObservation.task_name, /^[A-Za-z0-9_.-]{1,128}$/),
          state: boundedString(taskObservation.state, /^[A-Za-z0-9._-]{1,64}$/),
          enabled: typeof taskObservation.enabled === 'boolean' ? taskObservation.enabled : null,
          principal: boundedString(taskObservation.principal, /^[A-Za-z0-9 _\\.-]{1,128}$/),
        };
        if (!taskObservedAt || !validNotFutureUtc(taskObservedAt, nowMs)) {
          return invalidOwnerLiveness('SUPERVISOR_TASK_OBSERVATION_INVALID');
        }
        if (taskObservation.read_status === 'PRESENT' &&
            (taskProjection.task_name !== 'PTYSD-VNext42-Supervisor-Candidate1' ||
             !taskProjection.state || taskProjection.enabled === null || !taskProjection.principal)) {
          return invalidOwnerLiveness('SUPERVISOR_TASK_OBSERVATION_INVALID');
        }
        if (taskObservation.read_status === 'UNAVAILABLE' &&
            [taskProjection.task_name, taskProjection.state, taskProjection.enabled, taskProjection.principal]
              .some(field => field !== null)) {
          return invalidOwnerLiveness('SUPERVISOR_TASK_OBSERVATION_INVALID');
        }
        projected.supervisor.task_observation = taskProjection;
        if (!freshUtc(taskObservedAt, nowMs)) componentsFresh = false;
      }
      if (isLocalCollectorSnapshot) {
        if (projected.supervisor.readback_status === 'UNAVAILABLE') {
          if (componentState !== 'UNAVAILABLE' || !projected.supervisor.unavailability_reason ||
              projected.supervisor.supervisor_id !== null || projected.supervisor.heartbeat_id !== null ||
              projected.supervisor.heartbeat_at_utc !== null || projected.supervisor.boot_identity !== null ||
              projected.supervisor.process_identity !== null || projected.supervisor.service_identity !== null ||
              projected.supervisor.task_identity !== null || projected.supervisor.evidence_ref !== null ||
              projected.supervisor.evidence_digest !== null) {
            return invalidOwnerLiveness('SUPERVISOR_HEARTBEAT_IDENTITY_INVALID');
          }
        } else if (projected.supervisor.readback_status === 'PRESENT') {
          if (!['ACTIVE', 'EXPIRED'].includes(componentState) || projected.supervisor.unavailability_reason !== null ||
              !projected.supervisor.supervisor_id || !projected.supervisor.heartbeat_id ||
              !projected.supervisor.heartbeat_at_utc || !projected.supervisor.boot_identity ||
              !projected.supervisor.process_identity || !projected.supervisor.service_identity ||
              projected.supervisor.task_identity !== identity.task_id || !projected.supervisor.evidence_ref ||
              !projected.supervisor.evidence_digest) {
            return invalidOwnerLiveness('SUPERVISOR_HEARTBEAT_IDENTITY_INVALID');
          }
        } else return invalidOwnerLiveness('SUPERVISOR_HEARTBEAT_IDENTITY_INVALID');
      }
      if (componentState !== 'UNAVAILABLE' && (!projected.supervisor.supervisor_id ||
          !projected.supervisor.heartbeat_id || !projected.supervisor.heartbeat_at_utc ||
          !validNotFutureUtc(projected.supervisor.heartbeat_at_utc, nowMs))) {
        return invalidOwnerLiveness('SUPERVISOR_HEARTBEAT_IDENTITY_INVALID');
      }
    }
    components[name] = projected;
    if (componentState !== ({
      os_process: 'ABSENT',
      provider_agent_session: 'TERMINAL',
      supervisor_heartbeat: 'EXPIRED',
    })[name]) {
      componentsMatchStaleContract = false;
    }
  }

  if (!componentsFresh) {
    return {
      view: {
        read_status: 'STALE',
        evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
        evidence_digest: digest,
        observed_at: observedAt,
        reconciliation_verdict: 'NOT_PERFORMED',
      },
      localObservation: null,
    };
  }

  const view = {
    read_status: 'AVAILABLE',
    project_id: identity.project_id,
    provider: identity.provider,
    task_id: identity.task_id,
    attempt_id: identity.attempt_id,
    attempt_epoch: identity.attempt_epoch,
    owner_generation: identity.owner_generation,
    owner_principal_id: ownerPrincipal,
    owner_scope: ownerScope,
    owner_session_id: ownerSessionId,
    provider_session_id: providerSessionId,
    fingerprint: identity.fingerprint,
    observation_id: observationId,
    provider_observation_id: providerObservationId,
    observed_at: observedAt,
    source: snapshot.source,
    evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
    evidence_digest: digest,
    ...publisherMetadata,
    recovery_evidence: recoveryEvidence,
    components,
    reconciliation_verdict: 'NOT_PERFORMED',
  };
  const localObservation = componentsMatchStaleContract ? {
    observation_id: observationId,
    provider_observation_id: providerObservationId,
    ...identity,
    observed_at: observedAt,
    source: 'authorized-cross-source-liveness-readback',
    evidence_ref: OWNER_LIVENESS_EVIDENCE_REF,
    evidence_digest: digest,
    components: Object.fromEntries(Object.entries(components).map(([name, component]) => [name, {
      observation_id: component.observation_id,
      provider_observation_id: component.provider_observation_id,
      ...identity,
      observed_at: component.observed_at,
      source: component.source,
      state: component.state,
    }])),
  } : null;
  return { view, localObservation };
}

export function projectReadOnlyDiagnostics(value, nowMs = Date.now(), expectedScope) {
  if (!isRecord(value)) throw new Error('READONLY_DIAGNOSTIC_OUTPUT_INVALID');
  const expectedProjectId = boundedString(expectedScope?.project_id, IDENTIFIER);
  const expectedHostId = boundedString(expectedScope?.host_id, HOST_IDENTIFIER);
  if (!expectedProjectId || !expectedHostId) throw new Error('READONLY_EXPECTED_SCOPE_INVALID');
  const ownerLiveness = projectOwnerLiveness(value.owner_liveness, nowMs, expectedProjectId);
  return {
    schema: 'v51.factory-mcp.readonly-diagnostics.v1',
    observed_at_utc: boundedString(value.observed_at_utc, /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/, 64),
    hostguard: projectHostGuard(value.hostguard, expectedHostId),
    capability: projectCapability(value.capability, expectedProjectId),
    broker: projectBroker(value.broker, nowMs),
    orphans: projectOrphanStatusView(value.orphans, expectedProjectId),
    scheduled_tasks: projectTasks(value.scheduled_tasks),
    services: projectServices(value.services),
    processes: projectProcesses(value.processes),
    trusted_caller: projectTrustedCaller(value.trusted_caller),
    owner_liveness: ownerLiveness.view,
    local_liveness_observation: ownerLiveness.localObservation,
  };
}

function digestStream(path, maxBytes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        stream.destroy(new Error('FILE_TOO_LARGE'));
        return;
      }
      hash.update(chunk);
    });
    stream.on('error', rejectPromise);
    stream.on('end', () => resolvePromise({ bytes, sha256: 'sha256:' + hash.digest('hex') }));
  });
}

async function inspectParentChain(path, boundaryRoot) {
  const target = resolve(path);
  const root = resolve(boundaryRoot);
  const rootLower = root.toLowerCase();
  const targetLower = target.toLowerCase();
  if (targetLower !== rootLower && !targetLower.startsWith((root + sep).toLowerCase())) return 'INVALID_PATH';
  let current = dirname(target);
  while (true) {
    let stat;
    try { stat = await lstat(current); }
    catch (error) { return error?.code === 'ENOENT' ? 'MISSING' : 'UNAVAILABLE'; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return 'REPARSE_POINT_OR_NOT_DIRECTORY';
    if (current.toLowerCase() === rootLower) return null;
    const parent = dirname(current);
    if (parent === current || !current.toLowerCase().startsWith((root + sep).toLowerCase())) return 'INVALID_PATH';
    current = parent;
  }
}

async function inspectFile(path, maxBytes, boundaryRoot = null) {
  try {
    if (boundaryRoot) {
      const parentStatus = await inspectParentChain(path, boundaryRoot);
      if (parentStatus) return { status: parentStatus, path };
    }
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return { status: 'REPARSE_POINT_OR_NOT_FILE', path };
    if (stat.size > maxBytes) return { status: 'OVER_LIMIT', path, bytes: stat.size };
    const digest = await digestStream(path, maxBytes);
    const after = await lstat(path);
    if (after.isSymbolicLink() || !after.isFile() || stat.dev !== after.dev || stat.ino !== after.ino ||
        stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) {
      return { status: 'CHANGED_DURING_READ', path };
    }
    return { status: 'READ', path, ...digest };
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'MISSING' : 'UNAVAILABLE', path };
  }
}

async function inspectCapability(path, expectedProjectId) {
  try {
    const packageRoot = resolve(dirname(dirname(path)));
    const parentStatus = await inspectParentChain(path, packageRoot);
    if (parentStatus) {
      const readStatus = parentStatus === 'MISSING' || parentStatus === 'UNAVAILABLE' ? parentStatus : 'INVALID';
      return { file: { status: parentStatus, path }, view: { read_status: readStatus } };
    }
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return { file: { status: 'REPARSE_POINT_OR_NOT_FILE', path }, view: { read_status: 'INVALID' } };
    if (stat.size > 65536) return { file: { status: 'OVER_LIMIT', path, bytes: stat.size }, view: { read_status: 'INVALID' } };
    const bytes = await readFile(path);
    const after = await lstat(path);
    if (after.isSymbolicLink() || !after.isFile() || stat.dev !== after.dev || stat.ino !== after.ino ||
        stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || bytes.length !== stat.size) {
      return { file: { status: 'CHANGED_DURING_READ', path }, view: { read_status: 'INVALID' } };
    }
    const text = bytes.toString('utf8');
    const raw = JSON.parse(text);
    return {
      file: { status: 'READ', path, bytes: bytes.length, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') },
      view: projectCapability({ read_status: 'PRESENT', ...raw }, expectedProjectId),
    };
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 'MISSING' : 'INVALID';
    return { file: { status, path }, view: { read_status: status } };
  }
}

export async function collectInstalledRuntimeEvidence(factoryRoot, nodeExecutablePath, nodeVersion, expectedProjectId) {
  const root = resolve(factoryRoot);
  const files = [
    ['mcp_entry', 'src/index.mjs'],
    ['status_probe', 'src/readonly-diagnostics.ps1'],
    ['hostguard_wrapper', 'src/invoke-hostguard.ps1'],
    ['broker', 'broker/hostguard-broker.ps1'],
    ['owner_liveness_publisher', 'broker/owner-liveness-publisher.ps1'],
    ['owner_liveness_projection', 'src/readonly-diagnostics.mjs'],
    ['package', 'package.json'],
    ['package_lock', 'package-lock.json'],
  ];
  const assets = {};
  for (const [name, relative] of files) {
    const path = resolve(root, ...relative.split('/'));
    if (path !== root && !path.toLowerCase().startsWith((root + sep).toLowerCase())) {
      assets[name] = { status: 'INVALID_PATH' };
      continue;
    }
    assets[name] = await inspectFile(path, MAX_ASSET_BYTES, root);
  }
  const capabilityPath = resolve(root, 'config', 'system-capability.json');
  const capability = await inspectCapability(capabilityPath, expectedProjectId);
  assets.system_capability = capability.file;
  const executable = await inspectFile(resolve(nodeExecutablePath), MAX_RUNTIME_BYTES);
  return {
    factory_root: root,
    node_runtime: {
      path: resolve(nodeExecutablePath),
      version: boundedString(nodeVersion, /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/, 64),
      sha256: executable.status === 'READ' ? executable.sha256 : null,
      read_status: executable.status,
      bytes: executable.bytes ?? null,
    },
    assets,
    capability: capability.view,
  };
}
