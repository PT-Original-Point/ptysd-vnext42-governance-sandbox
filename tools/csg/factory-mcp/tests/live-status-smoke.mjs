import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const LIVE_EVIDENCE_MAX_AGE_MS = 30_000;

function parseUtcTimestamp(value, label) {
  assert.equal(typeof value, 'string', label + ' must be a timestamp');
  assert.match(value, /(?:Z|[+-]\d\d:\d\d)$/i, label + ' must include a timezone');
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), label + ' must parse');
  return parsed;
}

function assertFreshTimestamp(value, label, nowMs = Date.now()) {
  const age = nowMs - parseUtcTimestamp(value, label);
  assert.ok(age >= 0 && age <= LIVE_EVIDENCE_MAX_AGE_MS, label + ' must be fresh and not future-dated');
}

const outPath = process.argv[2];
if (!outPath) throw new Error('OUTPUT_PATH_REQUIRED');

const child = spawn(process.execPath, ['src/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
lines.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    p.resolve(msg);
  }
});
let nextId = 1;
function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`TIMEOUT:${method}`)); }, 15000);
    pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
  });
}
function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}
try {
  const init = await send('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'factory-mcp-live-smoke', version: '1.0.0' },
  });
  assert.equal(init.error, undefined);
  notify('notifications/initialized');
  const listed = await send('tools/list', {});
  assert.deepEqual(listed.result.tools.map((t) => t.name).sort(), ['factory_status','host_powershell','worker_prepare','worker_start']);
  const status = await send('tools/call', { name: 'factory_status', arguments: {} });
  assert.equal(status.error, undefined);
  assert.equal(status.result.isError, undefined);
  const payload = JSON.parse(status.result.content[0].text);
  assert.equal(payload.schema, 'v51.factory-mcp.readonly-diagnostics.v1');
  assert.equal(payload.hostguard?.read_status, 'AVAILABLE');
  const hostguard = payload.hostguard.payload;
  assert.equal(hostguard.schema, 'v45.hostguard.status.v1');
  assert.equal(hostguard.host, 'DESKTOP-1B6PD2P');
  assert.equal(hostguard.vm_name, 'PTYSD-WORKER-01');
  assert.equal(hostguard.vm_id, '881f7819-baa9-4a4e-8cca-8f6f18fb89a9');
  const broker = payload.broker;
  assert.equal(broker?.read_status, 'AVAILABLE');
  assert.equal(broker?.status, 'READY');
  assert.equal(broker?.run_as, 'NT AUTHORITY\\SYSTEM');
  assertFreshTimestamp(broker?.recorded_at_utc, 'broker health timestamp');
  assert.equal(payload.scheduled_tasks?.read_status, 'COMPLETE');
  const brokerTask = payload.scheduled_tasks.records.find((task) => task.task_name === 'PTYSD-FactoryMCP-HostGuard-Broker-V47');
  assert.ok(brokerTask, 'broker scheduled task must be observable');
  assert.equal(brokerTask.state, 'Running');
  assert.equal(brokerTask.enabled, true);
  assert.ok(['SYSTEM', 'NT AUTHORITY\\SYSTEM', 'S-1-5-18'].includes(brokerTask.principal));
  const brokerProcess = payload.processes?.records?.find((process) => process.role === 'HOSTGUARD_BROKER' && process.pid === broker.pid);
  assert.ok(brokerProcess, 'fresh health PID must match a running broker process observation');
  assert.equal(brokerProcess.owner, 'NT AUTHORITY\\SYSTEM');
  assert.equal(brokerProcess.image_name.toLowerCase(), 'powershell.exe');
  const processStartedAt = parseUtcTimestamp(brokerProcess.started_at_utc, 'broker process start timestamp');
  assert.ok(processStartedAt <= parseUtcTimestamp(broker.recorded_at_utc, 'broker health timestamp'));
  const publisherStatus = broker.owner_liveness_publisher_status;
  const expectedReadStatusByPublisherStatus = {
    PUBLISHED: 'AVAILABLE',
    SOURCE_MISSING: 'UNAVAILABLE',
    SOURCE_INVALID: 'INVALID',
    SOURCE_STALE: 'STALE',
  };
  assert.ok(Object.hasOwn(expectedReadStatusByPublisherStatus, publisherStatus), 'publisher must have produced a durable status');
  const ownerLiveness = payload.owner_liveness;
  assert.equal(ownerLiveness?.read_status, expectedReadStatusByPublisherStatus[publisherStatus]);
  assert.equal(ownerLiveness?.publisher_status, publisherStatus);
  assertFreshTimestamp(ownerLiveness?.publisher_observed_at_utc, 'owner-liveness publisher timestamp');
  if (publisherStatus === 'SOURCE_STALE') assert.equal(ownerLiveness?.reason, 'OBSERVATION_STALE');
  assert.equal(ownerLiveness?.evidence_ref, 'factory-mcp://state/owner-liveness.json');
  assert.match(ownerLiveness?.evidence_digest ?? '', /^sha256:[0-9a-f]{64}$/);
  let ownerLivenessReadback = {};
  if (publisherStatus === 'PUBLISHED') {
    assert.equal(ownerLiveness.acl_status, 'VERIFIED_READ_ONLY');
    assert.equal(ownerLiveness.reconciliation_verdict, 'NOT_PERFORMED');
    if (ownerLiveness.source === 'system-broker-fixed-owner-liveness-collector') {
      assert.equal(ownerLiveness.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
      assert.equal(ownerLiveness.owner_generation, 5);
      assert.ok(['UNKNOWN', 'UNAVAILABLE'].includes(ownerLiveness.components?.os_process?.state));
      assert.equal(ownerLiveness.components?.os_process?.identity_link_status, 'UNRESOLVED');
      assert.equal(ownerLiveness.components?.provider_agent_session?.state, 'UNAVAILABLE');
      assert.equal(ownerLiveness.components?.provider_agent_session?.provider_session?.session_id, null);
      assert.equal(ownerLiveness.components?.provider_agent_session?.provider_session?.unavailability_reason,
        'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED');
      assert.equal(ownerLiveness.components?.supervisor_heartbeat?.state, 'UNAVAILABLE');
      assert.equal(ownerLiveness.components?.supervisor_heartbeat?.supervisor?.unavailability_reason,
        'SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED');
      const supervisorTask = ownerLiveness.components?.supervisor_heartbeat?.supervisor?.task_observation;
      assert.ok(['PRESENT', 'UNAVAILABLE'].includes(supervisorTask?.read_status));
      assertFreshTimestamp(supervisorTask?.observed_at, 'Supervisor task observation timestamp');
      if (supervisorTask.read_status === 'PRESENT') {
        assert.equal(supervisorTask.task_name, 'PTYSD-VNext42-Supervisor-Candidate1');
        assert.match(supervisorTask.state ?? '', /^[A-Za-z0-9._-]{1,64}$/);
        assert.equal(typeof supervisorTask.enabled, 'boolean');
        assert.match(supervisorTask.principal ?? '', /^[A-Za-z0-9 _\\.-]{1,128}$/);
      } else {
        assert.equal(supervisorTask.task_name, null);
        assert.equal(supervisorTask.state, null);
        assert.equal(supervisorTask.enabled, null);
        assert.equal(supervisorTask.principal, null);
      }
      assert.equal(payload.local_liveness_observation, null);
      ownerLivenessReadback = {
        source: ownerLiveness.source,
        os_process_state: ownerLiveness.components.os_process.state,
        os_process_identity_link_status: ownerLiveness.components.os_process.identity_link_status,
        provider_session_state: ownerLiveness.components.provider_agent_session.state,
        provider_session_unavailability_reason: ownerLiveness.components.provider_agent_session.provider_session.unavailability_reason,
        supervisor_heartbeat_state: ownerLiveness.components.supervisor_heartbeat.state,
        supervisor_unavailability_reason: ownerLiveness.components.supervisor_heartbeat.supervisor.unavailability_reason,
        supervisor_task_read_status: supervisorTask.read_status,
        supervisor_task_observed_at_utc: supervisorTask.observed_at,
        supervisor_task_name: supervisorTask.task_name,
        supervisor_task_state: supervisorTask.state,
        supervisor_task_enabled: supervisorTask.enabled,
        supervisor_task_principal: supervisorTask.principal,
        reconciliation_verdict: ownerLiveness.reconciliation_verdict,
      };
    } else {
      assert.equal(ownerLiveness.source, 'authorized-cross-source-liveness-readback');
      assert.ok(ownerLiveness.provider_observation_id);
      ownerLivenessReadback = {
        source: ownerLiveness.source,
        os_process_state: ownerLiveness.components.os_process.state,
        provider_session_state: ownerLiveness.components.provider_agent_session.state,
        supervisor_heartbeat_state: ownerLiveness.components.supervisor_heartbeat.state,
        reconciliation_verdict: ownerLiveness.reconciliation_verdict,
      };
    }
  }
  await writeFile(outPath, JSON.stringify({ result: 'PASS', host: hostguard.host, vm_name: hostguard.vm_name, vm_id: hostguard.vm_id, vm_state: hostguard.vm_state, broker_pid: broker.pid, broker_process_pid: brokerProcess.pid, broker_task_state: brokerTask.state, broker_recorded_at_utc: broker.recorded_at_utc, owner_liveness_publisher_status: publisherStatus, owner_liveness_read_status: ownerLiveness.read_status, owner_liveness_publisher_observed_at_utc: ownerLiveness.publisher_observed_at_utc, owner_liveness_evidence_ref: ownerLiveness.evidence_ref, owner_liveness_evidence_digest: ownerLiveness.evidence_digest, owner_liveness_readback: ownerLivenessReadback }) + '\n', 'utf8');
} finally {
  child.kill();
}
