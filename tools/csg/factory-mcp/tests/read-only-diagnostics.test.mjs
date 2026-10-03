import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { collectInstalledRuntimeEvidence, projectOrphanStatusView,
  projectReadOnlyDiagnostics as projectReadOnlyDiagnosticsForScope } from '../src/readonly-diagnostics.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = resolve(packageRoot, '../../..');
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const TEST_PROJECT_SCOPE = Object.freeze({ project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', host_id: 'HOST-01' });
const projectReadOnlyDiagnostics = (value, nowMs = Date.now()) =>
  projectReadOnlyDiagnosticsForScope(value, nowMs, TEST_PROJECT_SCOPE);

function orphan(overrides = {}) {
  return {
    request_id: '0123456789abcdef0123456789abcdef',
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    capability_id: 'FACTORY_HOST_READONLY',
    operation_id: 'OP025',
    control_oid: 'a'.repeat(40),
    checkpoint_digest: 'sha256:' + 'b'.repeat(64),
    authorization_envelope_digest: 'sha256:' + 'c'.repeat(64),
    capability_generation: 7,
    run_id: 'V51-R1-001',
    task_id: 'V51-R1-03-FACTORY-READONLY-BOOTSTRAP-SURFACE',
    attempt_id: 'V51-R1-03-ATTEMPT-001',
    attempt_epoch: 1,
    started_at_utc: '2026-09-29T01:00:00.000Z',
    finished_at_utc: '2026-09-29T01:00:02.000Z',
    timeout_seconds: 15,
    state: 'ORPHANED',
    historical_execution_outcome: 'COMPLETED',
    error_code: 'COLLECTOR_TIMEOUT',
    receipt_digest: 'sha256:' + 'd'.repeat(64),
    raw_path: 'C:\\private\\receipt.json',
    raw_stderr: 'sensitive output',
    ...overrides,
  };
}

function diagnostics(overrides = {}) {
  return {
    schema: 'attacker-controlled-schema-is-discarded',
    observed_at_utc: '2026-09-29T01:00:03.000Z',
    hostguard: {
      read_status: 'AVAILABLE',
      payload: {
        schema: 'v45.hostguard.status.v1', host: 'HOST-01',
        boot_identity: 'HOST-01|2026-09-29T00:00:00.000Z',
        vm_name: 'PTYSD-WORKER-01', vm_id: '881f7819-baa9-4a4e-8cca-8f6f18fb89a9',
        vm_state: 'Running', guest_ip: '172.31.253.10', ssh22_reachable: true,
        run_as: 'NT AUTHORITY\\NETWORK SERVICE', secret: 'discard me',
      },
    },
    capability: { read_status: 'PRESENT', project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', capability_id: 'FACTORY_HOST_READONLY',
      capability_generation: 7, max_timeout_seconds: 15, production_allowed: false, business_project_allowed: false,
      public_tool_count: 4, execution_authority_mode: 'FIXED_PURPOSE_READ_ONLY', trusted_caller_sid: 'S-1-5-20', credential: 'discard me' },
    broker: { read_status: 'AVAILABLE', schema: 'v47.broker.health.v1', status: 'RUNNING', pid: 1234,
      run_as: 'NT AUTHORITY\\NETWORK SERVICE', recorded_at_utc: new Date().toISOString(),
      owner_liveness_publisher_status: 'SOURCE_MISSING', path: 'discard me' },
    orphans: { read_status: 'COMPLETE', total_count: 1, truncated: false, read_at_utc: '2026-09-29T01:00:00.000Z', records: [orphan()] },
    scheduled_tasks: { read_status: 'COMPLETE', records: [{ task_name: 'PTYSD-FactoryMCP-HostGuard-Broker-V47', state: 'Ready', enabled: true,
      principal: 'NT AUTHORITY\\SYSTEM', process_token_sid_type: null, task_sid: null,
      action_executable: 'powershell.exe', action_arguments: 'discard me' }] },
    services: { read_status: 'COMPLETE', records: [{ service_name: 'PTYSDFactoryMCPBroker', match_reason: 'FACTORY_SERVICE_NAME', state: 'Running', start_mode: 'Auto',
      start_name: 'NT AUTHORITY\\NETWORK SERVICE', binary_path: 'discard me' }] },
    processes: { read_status: 'COMPLETE', records: [{ role: 'HOSTGUARD_BROKER', pid: 1234, owner: 'NT AUTHORITY\\NETWORK SERVICE',
      image_name: 'powershell.exe', started_at_utc: '2026-09-29T00:59:00.000Z', command_line: 'discard me' }] },
    trusted_caller: { identity: 'NT AUTHORITY\\NETWORK SERVICE', sid: 'S-1-5-20', unique_os_enforced: false,
      boundary_status: 'SHARED_NETWORK_SERVICE_NOT_UNIQUE', token: 'discard me' },
    owner_liveness: { read_status: 'MISSING' },
    raw_stdout: 'discard me',
    ...overrides,
  };
}

function ownerLiveness(overrides = {}) {
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const identity = {
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    provider: 'codex',
    task_id: 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION',
    attempt_id: 'V51-R2-02-ATTEMPT-002',
    attempt_epoch: 2,
    owner_generation: 5,
    fingerprint: 'a'.repeat(64),
  };
  const component = (name, source, state, fields = {}) => ({
    observation_id: name + '-observation',
    provider_observation_id: 'provider-observation',
    ...identity,
    observed_at: observedAt,
    source,
    state,
    ...fields,
  });
  return {
    read_status: 'AVAILABLE',
    acl_status: 'VERIFIED_READ_ONLY',
    evidence_ref: 'untrusted-path-is-discarded',
    evidence_digest: sha256(Buffer.from('owner-liveness-snapshot')),
    snapshot: {
      schema: 'v51.factory.owner-liveness.snapshot.v1',
      ...identity,
      owner_principal_id: 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',
      owner_scope: 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION',
      observation_id: 'local-observation',
      provider_observation_id: 'provider-observation',
      observed_at: observedAt,
      source: 'authorized-cross-source-liveness-readback',
      components: {
        os_process: component('os-process', 'local-os-process-readback', 'ABSENT', {
          process_id: null, process_image: null, process_principal: null, process_started_at_utc: null,
        }),
        provider_agent_session: component('provider-session', 'provider-agent-session-readback', 'TERMINAL', {
          provider_session_id: 'codex-session-01a0ed35', provider_job_id: null,
        }),
        supervisor_heartbeat: component('supervisor-heartbeat', 'host-supervisor-heartbeat-readback', 'EXPIRED', {
          supervisor_id: 'PTYSD_SUPERVISOR', heartbeat_id: 'heartbeat-20260930-01',
          heartbeat_at_utc: observedAt,
        }),
      },
      raw_path: 'discard this path',
      raw_command_line: 'discard this command line',
      ...overrides,
    },
  };
}

function ownerLivenessIdentityFingerprint(snapshot) {
  return createHash('sha256').update([
    snapshot.project_id, snapshot.provider, snapshot.task_id, snapshot.attempt_id,
    String(snapshot.attempt_epoch), String(snapshot.owner_generation),
    snapshot.owner_principal_id, snapshot.owner_scope,
  ].join('\n'), 'utf8').digest('hex');
}

test('projects a strict allowlist and keeps historical receipt outcome separate from current target state', () => {
  const result = projectReadOnlyDiagnostics(diagnostics());
  assert.equal(result.schema, 'v51.factory-mcp.readonly-diagnostics.v1');
  assert.equal(result.services.records[0].service_name, 'PTYSDFactoryMCPBroker');
  assert.equal(result.broker.owner_liveness_publisher_status, 'SOURCE_MISSING');
  assert.equal(result.services.records[0].binary_path, undefined);
  assert.equal(result.scheduled_tasks.records[0].action_arguments, undefined);
  assert.equal(result.processes.records[0].command_line, undefined);
  assert.equal(result.orphans.read_status, 'COMPLETE');
  assert.equal(result.orphans.records[0].historical_execution_outcome, 'COMPLETED');
  assert.equal(result.orphans.records[0].current_target_state, 'NOT_OBSERVED_BY_READONLY_STATUS');
  assert.equal(result.owner_liveness.read_status, 'MISSING');
  const serialized = JSON.stringify(result);
  for (const secret of ['sensitive output', 'discard me', 'C:\\\\private']) assert.equal(serialized.includes(secret), false);
});

test('read-only projection rejects another Project capability and a different Host target', () => {
  const otherProject = projectReadOnlyDiagnosticsForScope(
    diagnostics({ owner_liveness: ownerLiveness() }), Date.now(),
    { project_id: 'PROJECT_B', host_id: 'HOST-01' },
  );
  assert.equal(otherProject.capability.read_status, 'INVALID');
  assert.equal(otherProject.orphans.read_status, 'PARTIAL');
  assert.equal(otherProject.orphans.records.length, 0);
  assert.equal(otherProject.owner_liveness.read_status, 'INVALID');

  const wrongHost = projectReadOnlyDiagnosticsForScope(
    diagnostics(), Date.now(),
    { project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', host_id: 'HOST-02' },
  );
  assert.equal(wrongHost.hostguard.read_status, 'INVALID');
});

test('projects a fresh ACL-qualified owner snapshot with exact cross-source identity and a separate R2-02 readback', () => {
  const result = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: ownerLiveness() }));
  assert.equal(result.owner_liveness.read_status, 'AVAILABLE');
  assert.equal(result.owner_liveness.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.equal(result.owner_liveness.task_id, 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION');
  assert.equal(result.owner_liveness.owner_generation, 5);
  assert.equal(result.owner_liveness.owner_principal_id, 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125');
  assert.equal(result.owner_liveness.evidence_ref, 'factory-mcp://state/owner-liveness.json');
  assert.equal(result.owner_liveness.components.os_process.process.process_id, null);
  assert.equal(result.owner_liveness.components.provider_agent_session.provider_session.session_id, 'codex-session-01a0ed35');
  assert.equal(result.owner_liveness.components.supervisor_heartbeat.supervisor.heartbeat_id, 'heartbeat-20260930-01');
  assert.equal(result.local_liveness_observation.observation_id, 'local-observation');
  assert.equal(result.local_liveness_observation.components.os_process.state, 'ABSENT');
  const serialized = JSON.stringify(result);
  for (const secret of ['untrusted-path-is-discarded', 'discard this path', 'discard this command line']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('projects only bounded signed recovery references and the bound provider session identities', () => {
  const source = ownerLiveness();
  source.snapshot.owner_session_id = 'owner-session-01';
  source.snapshot.provider_session_id = 'provider-session-01';
  source.recovery_evidence = {
    schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',
    status: 'AVAILABLE',
    provider: { evidence_ref: 'recovery://provider/' + 'a'.repeat(32), evidence_digest: 'sha256:' + 'b'.repeat(64) },
    local: { evidence_ref: 'recovery://local/' + 'c'.repeat(32), evidence_digest: 'sha256:' + 'd'.repeat(64) },
  };
  const projected = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: source }));
  assert.equal(projected.owner_liveness.owner_session_id, 'owner-session-01');
  assert.equal(projected.owner_liveness.provider_session_id, 'provider-session-01');
  assert.deepEqual(projected.owner_liveness.recovery_evidence, source.recovery_evidence);

  source.recovery_evidence.provider.evidence_ref = 'recovery://local/' + 'e'.repeat(32);
  const rejected = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: source }));
  assert.deepEqual(rejected.owner_liveness.recovery_evidence, {
    schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',
    status: 'UNAVAILABLE',
    reason_code: 'RECOVERY_EVIDENCE_REFERENCE_INVALID',
  });
});

test('projects broker-collected local candidates without inventing provider or Supervisor liveness', () => {
  const source = ownerLiveness();
  const snapshot = source.snapshot;
  snapshot.source = 'system-broker-fixed-owner-liveness-collector';
  snapshot.observation_id = 'broker-observation-01';
  snapshot.provider_observation_id = null;
  snapshot.fingerprint = ownerLivenessIdentityFingerprint(snapshot);
  const components = snapshot.components;
  for (const [index, component] of Object.values(components).entries()) {
    component.observation_id = `broker-component-${index + 1}`;
    component.provider_observation_id = null;
    component.fingerprint = snapshot.fingerprint;
  }
  Object.assign(components.os_process, {
    state: 'UNKNOWN',
    identity_link_status: 'UNRESOLVED',
    process_id: null,
    process_image: null,
    process_principal: null,
    process_started_at_utc: null,
    candidate_processes: [{
      process_id: 1234,
      process_image: 'Codex.exe',
      process_principal: 'TEST\\Executor',
      process_started_at_utc: new Date(Date.now() - 60000).toISOString(),
    }],
  });
  Object.assign(components.provider_agent_session, {
    state: 'UNAVAILABLE', provider_session_id: null, provider_job_id: null,
    unavailability_reason: 'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED',
  });
  Object.assign(components.supervisor_heartbeat, {
    state: 'UNAVAILABLE', supervisor_id: null, heartbeat_id: null, heartbeat_at_utc: null,
    unavailability_reason: 'SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED',
    supervisor_task_observation: {
      read_status: 'PRESENT',
      observed_at: new Date().toISOString(),
      task_name: 'PTYSD-VNext42-Supervisor-Candidate1',
      state: 'Disabled',
      enabled: false,
      principal: 'x',
    },
  });

  const result = projectReadOnlyDiagnostics(diagnostics({
    owner_liveness: {
      ...source,
      acl_status: 'VERIFIED_READ_ONLY',
      evidence_digest: sha256(Buffer.from('broker-local-owner-observation')),
      snapshot,
    },
  }));
  assert.equal(result.owner_liveness.read_status, 'AVAILABLE');
  assert.equal(result.owner_liveness.provider_observation_id, null);
  assert.equal(result.owner_liveness.source, 'system-broker-fixed-owner-liveness-collector');
  assert.equal(result.owner_liveness.components.os_process.state, 'UNKNOWN');
  assert.equal(result.owner_liveness.components.os_process.identity_link_status, 'UNRESOLVED');
  assert.equal(result.owner_liveness.components.os_process.candidate_processes[0].process_id, 1234);
  assert.equal(result.owner_liveness.components.provider_agent_session.state, 'UNAVAILABLE');
  assert.equal(result.owner_liveness.components.provider_agent_session.provider_session.session_id, null);
  assert.equal(result.owner_liveness.components.provider_agent_session.provider_session.unavailability_reason,
    'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED');
  assert.equal(result.owner_liveness.components.supervisor_heartbeat.state, 'UNAVAILABLE');
  assert.equal(result.owner_liveness.components.supervisor_heartbeat.supervisor.task_observation.read_status, 'PRESENT');
  assert.equal(result.owner_liveness.components.supervisor_heartbeat.supervisor.task_observation.state, 'Disabled');
  assert.equal(result.owner_liveness.components.supervisor_heartbeat.supervisor.task_observation.enabled, false);
  assert.equal(result.local_liveness_observation, null);
  assert.equal(result.owner_liveness.reconciliation_verdict, 'NOT_PERFORMED');

  const wrongFingerprint = structuredClone(snapshot);
  wrongFingerprint.fingerprint = 'f'.repeat(64);
  for (const component of Object.values(wrongFingerprint.components)) component.fingerprint = wrongFingerprint.fingerprint;
  const rejectedFingerprint = projectReadOnlyDiagnostics(diagnostics({
    owner_liveness: { ...source, acl_status: 'VERIFIED_READ_ONLY', snapshot: wrongFingerprint },
  }));
  assert.equal(rejectedFingerprint.owner_liveness.read_status, 'INVALID');
  assert.equal(rejectedFingerprint.owner_liveness.reason, 'IDENTITY_FINGERPRINT_MISMATCH');
});

test('surfaces publisher source gaps without converting them into an owner-liveness verdict', () => {
  const owner_liveness = {
    read_status: 'UNAVAILABLE',
    publisher_status: 'SOURCE_MISSING',
    reason: 'SOURCE_NOT_PRESENT',
    publisher_observed_at_utc: new Date().toISOString(),
    source_digest: null,
    evidence_digest: sha256(Buffer.from('published-unavailable-envelope')),
  };
  const result = projectReadOnlyDiagnostics(diagnostics({ owner_liveness }));
  assert.equal(result.owner_liveness.read_status, 'UNAVAILABLE');
  assert.equal(result.owner_liveness.publisher_status, 'SOURCE_MISSING');
  assert.equal(result.owner_liveness.reason, 'SOURCE_NOT_PRESENT');
  assert.equal(result.owner_liveness.reconciliation_verdict, 'NOT_PERFORMED');
});

test('stale and future broker health timestamps are not projected as live', () => {
  const nowMs = Date.now();
  const health = { read_status: 'AVAILABLE', schema: 'v47.factory-mcp.broker.health.v1', status: 'READY',
    pid: 1234, run_as: 'NT AUTHORITY\\SYSTEM', owner_liveness_publisher_status: 'PUBLISHED' };
  for (const recorded_at_utc of [new Date(nowMs - 60000).toISOString(), new Date(nowMs + 60000).toISOString()]) {
    const result = projectReadOnlyDiagnostics(diagnostics({ broker: { ...health, recorded_at_utc } }), nowMs);
    assert.equal(result.broker.read_status, 'STALE');
  }
});

test('a stale publisher envelope cannot expose an old snapshot as fresh owner evidence', () => {
  const owner_liveness = {
    read_status: 'AVAILABLE',
    publisher_status: 'PUBLISHED',
    publisher_observed_at_utc: new Date(Date.now() - 60000).toISOString(),
    source_observed_at_utc: new Date(Date.now() - 1000).toISOString(),
    source_digest: sha256(Buffer.from('source')),
    evidence_digest: sha256(Buffer.from('publication')),
    acl_status: 'VERIFIED_READ_ONLY',
    snapshot: ownerLiveness().snapshot,
  };
  const result = projectReadOnlyDiagnostics(diagnostics({ owner_liveness }));
  assert.equal(result.owner_liveness.read_status, 'STALE');
  assert.equal(result.owner_liveness.reason, 'PUBLISHER_OBSERVATION_STALE');
  assert.equal(result.local_liveness_observation, null);
});

test('a stale SOURCE_STALE publisher envelope stays stale and cannot pass freshness', () => {
  const owner_liveness = {
    read_status: 'STALE', publisher_status: 'SOURCE_STALE', reason: 'OBSERVATION_STALE',
    publisher_observed_at_utc: new Date(Date.now() - 60000).toISOString(),
    source_observed_at_utc: new Date(Date.now() - 120000).toISOString(),
    source_digest: sha256(Buffer.from('stale-source')),
    evidence_digest: sha256(Buffer.from('stale-publication')),
  };
  const result = projectReadOnlyDiagnostics(diagnostics({ owner_liveness }));
  assert.equal(result.owner_liveness.read_status, 'STALE');
  assert.equal(result.owner_liveness.reason, 'PUBLISHER_OBSERVATION_STALE');
  assert.equal(result.local_liveness_observation, null);
});

test('missing ACL proof, mismatched identities, duplicate observations, and stale snapshots cannot become liveness proof', () => {
  const missingAcl = projectReadOnlyDiagnostics(diagnostics({
    owner_liveness: { ...ownerLiveness(), acl_status: 'UNVERIFIED' },
  }));
  assert.equal(missingAcl.owner_liveness.read_status, 'INVALID');
  assert.equal(missingAcl.local_liveness_observation, null);

  const mismatched = ownerLiveness();
  mismatched.snapshot.components.supervisor_heartbeat.owner_generation = 6;
  const mismatchedResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: mismatched }));
  assert.equal(mismatchedResult.owner_liveness.read_status, 'INVALID');
  assert.equal(mismatchedResult.local_liveness_observation, null);

  for (const change of [
    { task_id: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION' },
    { owner_generation: 6 },
    { owner_principal_id: 'CODEX_THREAD_OTHER' },
    { owner_scope: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION' },
  ]) {
    const wrongTarget = ownerLiveness();
    Object.assign(wrongTarget.snapshot, change);
    const rejected = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: wrongTarget }));
    assert.equal(rejected.owner_liveness.read_status, 'INVALID');
    assert.equal(rejected.owner_liveness.reason, 'TARGET_IDENTITY_MISMATCH');
    assert.equal(rejected.local_liveness_observation, null);
  }

  const duplicated = ownerLiveness();
  duplicated.snapshot.components.os_process.observation_id = 'provider-observation';
  const duplicatedResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: duplicated }));
  assert.equal(duplicatedResult.owner_liveness.read_status, 'INVALID');
  assert.equal(duplicatedResult.local_liveness_observation, null);

  const stale = ownerLiveness();
  stale.snapshot.observed_at = new Date(Date.now() - 31_000).toISOString();
  const staleResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: stale }));
  assert.equal(staleResult.owner_liveness.read_status, 'STALE');
  assert.equal(staleResult.local_liveness_observation, null);
});

test('active or unavailable evidence is observable but never projected as stale-owner proof', () => {
  const active = ownerLiveness();
  active.snapshot.components.provider_agent_session.state = 'ACTIVE';
  const activeResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: active }));
  assert.equal(activeResult.owner_liveness.read_status, 'AVAILABLE');
  assert.equal(activeResult.owner_liveness.components.provider_agent_session.state, 'ACTIVE');
  assert.equal(activeResult.owner_liveness.reconciliation_verdict, 'NOT_PERFORMED');
  assert.equal(activeResult.local_liveness_observation, null);

  const unavailable = ownerLiveness();
  unavailable.snapshot.components.supervisor_heartbeat = {
    observation_id: 'supervisor-unavailable-observation',
    provider_observation_id: 'provider-observation',
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    provider: 'codex',
    task_id: 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION',
    attempt_id: 'V51-R2-02-ATTEMPT-002',
    attempt_epoch: 2,
    owner_generation: 5,
    fingerprint: 'a'.repeat(64),
    observed_at: unavailable.snapshot.observed_at,
    source: 'host-supervisor-heartbeat-readback',
    state: 'UNAVAILABLE',
    supervisor_id: null,
    heartbeat_id: null,
    heartbeat_at_utc: null,
  };
  const unavailableResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: unavailable }));
  assert.equal(unavailableResult.owner_liveness.read_status, 'AVAILABLE');
  assert.equal(unavailableResult.owner_liveness.components.supervisor_heartbeat.state, 'UNAVAILABLE');
  assert.equal(unavailableResult.local_liveness_observation, null);
});

test('future process start and Supervisor heartbeat timestamps are invalid liveness evidence', () => {
  const future = new Date(Date.now() + 60_000).toISOString();

  const processEvidence = ownerLiveness();
  Object.assign(processEvidence.snapshot.components.os_process, {
    state: 'ACTIVE',
    process_id: 23456,
    process_image: 'codex.exe',
    process_principal: 'NT AUTHORITY\\NETWORK SERVICE',
    process_started_at_utc: future,
  });
  const processResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: processEvidence }));
  assert.equal(processResult.owner_liveness.read_status, 'INVALID');
  assert.equal(processResult.owner_liveness.reason, 'OS_PROCESS_IDENTITY_INVALID');
  assert.equal(processResult.local_liveness_observation, null);

  const heartbeatEvidence = ownerLiveness();
  heartbeatEvidence.snapshot.components.supervisor_heartbeat.heartbeat_at_utc = future;
  const heartbeatResult = projectReadOnlyDiagnostics(diagnostics({ owner_liveness: heartbeatEvidence }));
  assert.equal(heartbeatResult.owner_liveness.read_status, 'INVALID');
  assert.equal(heartbeatResult.owner_liveness.reason, 'SUPERVISOR_HEARTBEAT_IDENTITY_INVALID');
  assert.equal(heartbeatResult.local_liveness_observation, null);
});

test('invalid orphan identity or digest degrades the census to PARTIAL without classifying a target', () => {
  const invalid = projectOrphanStatusView({ read_status: 'COMPLETE', total_count: 1, truncated: false, records: [orphan({ request_id: '../bad' })] });
  assert.equal(invalid.read_status, 'PARTIAL');
  assert.equal(invalid.total_count, null);
  assert.deepEqual(invalid.records, []);
  const wrongState = projectOrphanStatusView({ read_status: 'COMPLETE', total_count: 1, truncated: false, records: [orphan({ state: 'RUNNING' })] });
  assert.equal(wrongState.read_status, 'PARTIAL');
});

test('unavailable and inconsistent probes fail closed', () => {
  assert.throws(() => projectReadOnlyDiagnostics(null), /READONLY_DIAGNOSTIC_OUTPUT_INVALID/);
  const partial = projectReadOnlyDiagnostics(diagnostics({ orphans: { read_status: 'PARTIAL', total_count: 1, truncated: true, records: [] } }));
  assert.equal(partial.orphans.read_status, 'PARTIAL');
  assert.equal(partial.orphans.total_count, null);
  const malformed = projectReadOnlyDiagnostics(diagnostics({
    hostguard: { read_status: 'AVAILABLE', payload: { schema: 'v45.hostguard.status.v1', vm_id: 'bad' } },
    capability: { read_status: 'PRESENT', trusted_caller_sid: 'S-1-5-20' },
    trusted_caller: { identity: 'SYSTEM', sid: 'S-1-5-21-1-2-3-4', unique_os_enforced: true, boundary_status: 'UNIQUE' },
  }));
  assert.equal(malformed.hostguard.read_status, 'INVALID');
  assert.equal(malformed.capability.read_status, 'INVALID');
  assert.equal(malformed.trusted_caller.unique_os_enforced, null);
  assert.equal(malformed.trusted_caller.boundary_status, 'NOT_ESTABLISHED');
});

test('trusted caller uniqueness requires a live task SID and verified queue ACL', () => {
  const accepted = projectReadOnlyDiagnostics(diagnostics({
    trusted_caller: {
      identity: 'NT AUTHORITY\\NETWORK SERVICE',
      sid: 'S-1-5-20',
      task_sid: 'S-1-5-87-123456789-123456789-123456789-123456789',
      task_sid_present: true,
      queue_acl_status: 'PASS',
      unique_os_enforced: false,
      boundary_status: 'UNTRUSTED_INPUT',
    },
  }));
  assert.equal(accepted.trusted_caller.unique_os_enforced, true);
  assert.equal(accepted.trusted_caller.boundary_status, 'TASK_SID_ACL_PROTECTED');
  assert.equal(accepted.trusted_caller.queue_acl_status, 'PASS');

  const denied = projectReadOnlyDiagnostics(diagnostics({
    trusted_caller: {
      identity: 'NT AUTHORITY\\NETWORK SERVICE', sid: 'S-1-5-20',
      task_sid: null, task_sid_present: true, queue_acl_status: 'PASS', unique_os_enforced: true,
      boundary_status: 'UNTRUSTED_INPUT',
    },
  }));
  assert.equal(denied.trusted_caller.unique_os_enforced, false);
  assert.equal(denied.trusted_caller.boundary_status, 'SHARED_NETWORK_SERVICE_NOT_UNIQUE');
});

test('installed-runtime collection reports exact bounded hashes and rejects path escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v51-r1-03-'));
  const normalizedRoot = resolve(root);
  assert.ok(normalizedRoot.startsWith(resolve(tmpdir()) + sep), 'temporary test directory must remain under the OS temp directory');
  try {
    const entries = [
      ['src/index.mjs', 'index'], ['src/readonly-diagnostics.ps1', 'probe'],
      ['src/invoke-hostguard.ps1', 'wrapper'], ['broker/hostguard-broker.ps1', 'broker'],
      ['broker/owner-liveness-publisher.ps1', 'publisher'], ['src/readonly-diagnostics.mjs', 'projection'],
      ['package.json', '{}'], ['package-lock.json', '{}'], ['config/system-capability.json', JSON.stringify({
        schema: 'v51.system-capability.v1', project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', capability_id: 'READONLY',
        capability_generation: 1, max_timeout_seconds: 10, production_allowed: false, business_project_allowed: false,
        public_tool_count: 4, execution_authority_mode: 'FIXED_PURPOSE_READ_ONLY', trusted_caller_sid: 'S-1-5-20',
      })],
    ];
    for (const [relative, content] of entries) {
      const path = join(root, relative);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, content, 'utf8');
    }
    const fakeNode = join(root, 'node.exe');
    const nodeBytes = Buffer.from('bounded-runtime-fixture');
    await writeFile(fakeNode, nodeBytes);
    const result = await collectInstalledRuntimeEvidence(root, fakeNode, 'v24.19.0');
    assert.equal(result.node_runtime.sha256, sha256(nodeBytes));
    assert.equal(result.node_runtime.read_status, 'READ');
    assert.equal(result.assets.mcp_entry.sha256, sha256(Buffer.from('index')));
    assert.equal(result.assets.owner_liveness_publisher.sha256, sha256(Buffer.from('publisher')));
    assert.equal(result.assets.owner_liveness_projection.sha256, sha256(Buffer.from('projection')));
    assert.equal(result.capability.public_tool_count, 4);
    assert.equal(result.assets.system_capability.status, 'READ');
  } finally {
    await rm(normalizedRoot, { recursive: true, force: true });
  }
});

test('installed-runtime collection refuses a reparse-point parent before reading package assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'v51-r1-03-link-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'v51-r1-03-link-target-'));
  const tempPrefix = resolve(tmpdir()) + sep;
  assert.ok(resolve(root).startsWith(tempPrefix));
  assert.ok(resolve(outside).startsWith(tempPrefix));
  try {
    try { await symlink(outside, join(root, 'src'), 'junction'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) { t.skip('junction creation is unavailable in this test environment'); return; }
      throw error;
    }
    const result = await collectInstalledRuntimeEvidence(root, join(root, 'node.exe'), 'v24.19.0');
    assert.equal(result.assets.mcp_entry.status, 'REPARSE_POINT_OR_NOT_DIRECTORY');
  } finally {
    await rm(resolve(root), { recursive: true, force: true });
    await rm(resolve(outside), { recursive: true, force: true });
  }
});

test('fixed diagnostics source has no provider-controlled command or state mutator path', async () => {
  const entry = await readFile(join(packageRoot, 'src/index.mjs'), 'utf8');
  const probe = await readFile(join(packageRoot, 'src/readonly-diagnostics.ps1'), 'utf8');
  assert.match(entry, /registerTool\(\s*'factory_status'[\s\S]*?inputSchema:\s*noArguments/);
  assert.match(entry, /registerTool\(\s*'host_powershell'[\s\S]*?inputSchema:\s*hostPowerShellInput/);
  assert.doesNotMatch(entry, /HOST_POWERSHELL_NOT_QUALIFIED|R1_04|R1_05|R1_06/);
  assert.doesNotMatch(entry, /runHostGuard\(['"]status['"]\)/);
  assert.match(probe, /\$unboundArgs\s*=\s*Get-Variable\s+-Name\s+args\s+-Scope\s+0\s+-ValueOnly\s+-ErrorAction\s+SilentlyContinue/);
  assert.match(probe, /@\(\$unboundArgs\)\.Count\s+-ne\s+0/);
  assert.doesNotMatch(probe, /\$args\.Count/);
  assert.match(probe, /ScriptBlock\s*\{\s*Get-PTYSDHostGuardStatus\s*\}/);
  assert.match(probe, /Get-ScheduledTask\s+-TaskName\s+\$taskName\s+-ErrorAction\s+Stop/);
  assert.match(probe, /Get-CimInstance\s+-ClassName\s+Win32_Service\s+-Filter\s+\$filter/);
  assert.doesNotMatch(probe, /Get-CimInstance\s+Win32_Service\s+-ErrorAction\s+Stop/);
  assert.equal([...probe.matchAll(/Invoke-Command/g)].length, 1);
  assert.equal([...probe.matchAll(/New-PSSession/g)].length, 1);
  assert.doesNotMatch(probe, /\b(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Copy-Item|Move-Item|WriteAllText|Register-ScheduledTask|Unregister-ScheduledTask|Start-ScheduledTask|Stop-ScheduledTask|Set-Service|Restart-Service|Start-Process|Stop-Process|Start-VM|Stop-VM)\b/i);
});
