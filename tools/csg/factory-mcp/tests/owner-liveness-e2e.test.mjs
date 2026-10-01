import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const factoryDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publisherPath = resolve(factoryDir, 'broker/owner-liveness-publisher.ps1');

function publishFromFixedCollector(stateDirectory) {
  const command = String.raw`$payloadBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($payloadBytes)); . $payload.script_path
$state=$payload.state_directory
function Get-OwnerLivenessPublisherIdentitySid { return 'S-1-5-18' }
function Test-OwnerLivenessStateDirectoryBoundary { return $true }
function Test-OwnerLivenessProtectedReadFile { param([string]$Path) return $true }
function Test-OwnerLivenessStateDirectoryAcl { param($Acl) return $true }
function Test-OwnerLivenessProtectedReadDirectory { param([string]$Path) return $true }
function Set-OwnerLivenessPublishedFileAcl { param([string]$Path) }
function Get-CimInstance { param([string]$ClassName,[string]$Filter,[string]$ErrorAction) return @(
  [pscustomobject]@{Name='Codex.exe';ProcessId=101;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-5))},
  [pscustomobject]@{Name='ChatGPT.exe';ProcessId=102;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-4))}) }
function Invoke-CimMethod { param($InputObject,[string]$MethodName,[string]$ErrorAction) return [pscustomobject]@{ReturnValue=0;Domain='TEST';User='Executor'} }
function Get-ScheduledTask { param([string]$TaskName,[string]$ErrorAction) return [pscustomobject]@{State='Disabled';Settings=[pscustomobject]@{Enabled=$false};Principal=[pscustomobject]@{UserId='x'}} }
$null=Publish-OwnerLivenessSnapshot
$published=[IO.File]::ReadAllText((Join-Path $state 'owner-liveness.json')) | ConvertFrom-Json
[Console]::Out.Write([string]$published.publisher_status)`;
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], {
    input: Buffer.from(JSON.stringify({ script_path: publisherPath, state_directory: stateDirectory }), 'utf8').toString('base64'),
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message ?? 'PowerShell spawn failed');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'PUBLISHED');
}

const stable = (value) => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const canonicalJson = (value) => JSON.stringify(stable(value));

async function writeSupervisorHeartbeatReadback(stateDirectory) {
  const now = new Date().toISOString();
  const ownerPrincipalId = 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125';
  const taskId = 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION';
  const identity = {
    project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', provider: 'codex', task_id: taskId,
    attempt_id: 'V51-R2-02-ATTEMPT-002', attempt_epoch: 2, owner_generation: 5,
    fingerprint: createHash('sha256').update([
      'CHATGPT_GLOBAL_SKILL_GOVERNANCE','codex',taskId,'V51-R2-02-ATTEMPT-002','2','5',ownerPrincipalId,taskId,
    ].join('\n')).digest('hex'),
  };
  const keyPair = generateKeyPairSync('ed25519');
  const reference = `recovery://supervisor-heartbeat/${'e'.repeat(32)}`;
  const payload = {
    observation_id: 'HB-e2e-gen5', provider_observation_id: 'provider-observation-e2e', ...identity,
    observed_at: now, source: 'host-supervisor-heartbeat-readback', state: 'ACTIVE',
    owner_principal_id: ownerPrincipalId, owner_session_id: ownerPrincipalId, provider_session_id: 'provider-session-gen5',
    supervisor_id: 'PTYSD-HOST-SUPERVISOR', heartbeat_id: 'HB-e2e-gen5', heartbeat_at_utc: now,
    boot_identity: 'boot:e2e-host', process_identity: 'pid:4242;created:2026-10-01T00:00:00.000Z',
    service_identity: 'PTYSD-VNext42-Supervisor', task_identity: taskId,
  };
  const signedBody = { schema: 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1', issuer_key_id: 'test-host-heartbeat', payload };
  const signature = sign(null, Buffer.from(canonicalJson(signedBody)), keyPair.privateKey).toString('base64');
  const evidenceBytes = Buffer.from(JSON.stringify({ ...signedBody, signature }));
  const evidenceDigest = `sha256:${createHash('sha256').update(evidenceBytes).digest('hex')}`;
  const evidenceDirectory = join(stateDirectory, 'recovery-evidence', 'objects', 'supervisor-heartbeat');
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, `${'e'.repeat(32)}.json`), evidenceBytes, { flag: 'wx' });
  await writeFile(join(stateDirectory, 'supervisor-heartbeat-readback.json'), JSON.stringify({
    schema: 'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1', ...identity,
    owner_principal_id: ownerPrincipalId, owner_session_id: ownerPrincipalId, provider_session_id: 'provider-session-gen5',
    supervisor_id: payload.supervisor_id, heartbeat_id: payload.heartbeat_id, observed_at: now,
    heartbeat_at_utc: now, boot_identity: payload.boot_identity, process_identity: payload.process_identity,
    service_identity: payload.service_identity, task_identity: taskId, evidence_ref: reference, evidence_digest: evidenceDigest,
  }), { flag: 'wx' });
  return { reference, evidenceDigest };
}

async function readFactoryStatus(publicationPath) {
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: factoryDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PTYSD_FACTORY_MCP_TEST_MODE: '1',
      PTYSD_FACTORY_MCP_TEST_OWNER_LIVENESS_PATH: publicationPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stderr = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.id === undefined || !pending.has(message.id)) return;
    const resolvePending = pending.get(message.id);
    pending.delete(message.id);
    resolvePending(message);
  });
  let requestId = 0;
  const send = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`MCP_TIMEOUT:${method}\n${stderr.join('')}`));
    }, 10000);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) rejectRequest(new Error(JSON.stringify(message.error)));
      else resolveRequest(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const initialized = await send('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'owner-liveness-e2e', version: '1.0.0' },
    });
    assert.equal(initialized.result?.serverInfo?.name, 'ptysd-factory-mcp');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await send('tools/list', {});
    assert.deepEqual(listed.result?.tools?.map(tool => tool.name).sort(), [
      'factory_status', 'host_powershell', 'worker_prepare', 'worker_start',
    ]);
    const call = await send('tools/call', { name: 'factory_status', arguments: {} });
    assert.equal(call.result?.isError, undefined);
    return JSON.parse(call.result?.content?.[0]?.text ?? 'null');
  } finally {
    child.kill();
    lines.close();
  }
}

test('fixed SYSTEM producer publication reaches the real factory_status MCP handler', {
  skip: process.platform !== 'win32',
}, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'ptysd-factory-owner-liveness-'));
  try {
    const publicationPath = join(tempRoot, 'owner-liveness.json');
    publishFromFixedCollector(tempRoot);
    const publication = JSON.parse(await readFile(publicationPath, 'utf8'));
    assert.equal(publication.schema, 'v51.factory.owner-liveness.publication.v1');
    assert.equal(publication.read_status, 'AVAILABLE');
    assert.equal(publication.publisher_status, 'PUBLISHED');
    assert.deepEqual(publication.recovery_evidence, {
      schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',
      status: 'UNAVAILABLE',
      reason_code: 'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED',
    });

    const status = await readFactoryStatus(publicationPath);
    assert.equal(status.schema, 'v51.factory-mcp.readonly-diagnostics.v1');
    assert.equal(status.owner_liveness.read_status, 'AVAILABLE');
    assert.equal(status.owner_liveness.source, 'system-broker-fixed-owner-liveness-collector');
    assert.equal(status.owner_liveness.provider_observation_id, null);
    assert.equal(status.owner_liveness.reconciliation_verdict, 'NOT_PERFORMED');
    assert.equal(status.local_liveness_observation, null);
    assert.equal(status.owner_liveness.components.os_process.identity_link_status, 'UNRESOLVED');
    assert.equal(status.owner_liveness.components.os_process.candidate_processes.length, 2);
    assert.equal(status.owner_liveness.components.provider_agent_session.provider_session.unavailability_reason,
      'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED');
    assert.equal(status.owner_liveness.components.supervisor_heartbeat.supervisor.task_observation.state, 'Disabled');
    assert.equal(status.owner_liveness.components.supervisor_heartbeat.supervisor.task_observation.enabled, false);
    assert.match(status.owner_liveness.evidence_digest, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(status), new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    const resolvedTemp = resolve(tempRoot);
    const tempRootStat = await lstat(resolvedTemp);
    assert.equal(tempRootStat.isDirectory(), true);
    assert.equal(tempRootStat.isSymbolicLink(), false);
    assert.equal(resolve(dirname(resolvedTemp)), resolve(tmpdir()));
    assert.match(basename(resolvedTemp), /^ptysd-factory-owner-liveness-/);
    await rm(resolvedTemp, { recursive: true, force: true });
  }
});

test('Host heartbeat readback flows through the fixed SYSTEM publisher and factory_status without resolving unavailable provider evidence', {
  skip: process.platform !== 'win32',
}, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'ptysd-factory-host-heartbeat-'));
  try {
    const { reference, evidenceDigest } = await writeSupervisorHeartbeatReadback(tempRoot);
    const publicationPath = join(tempRoot, 'owner-liveness.json');
    publishFromFixedCollector(tempRoot);
    const publication = JSON.parse(await readFile(publicationPath, 'utf8'));
    const heartbeat = publication.snapshot.components.supervisor_heartbeat;
    assert.equal(heartbeat.readback_status, 'PRESENT');
    assert.equal(heartbeat.state, 'ACTIVE');
    assert.equal(heartbeat.heartbeat_evidence_ref, reference);
    assert.equal(heartbeat.heartbeat_evidence_digest, evidenceDigest);
    assert.deepEqual(publication.recovery_evidence, {
      schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1', status: 'UNAVAILABLE',
      reason_code: 'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED',
    });

    const status = await readFactoryStatus(publicationPath);
    assert.equal(status.owner_liveness.read_status, 'AVAILABLE');
    assert.equal(status.owner_liveness.components.supervisor_heartbeat.supervisor.readback_status, 'PRESENT');
    assert.equal(status.owner_liveness.components.supervisor_heartbeat.supervisor.heartbeat_id, 'HB-e2e-gen5');
    assert.equal(status.local_liveness_observation, null);
    assert.equal(status.owner_liveness.reconciliation_verdict, 'NOT_PERFORMED');
  } finally {
    const resolvedTemp = resolve(tempRoot);
    const tempRootStat = await lstat(resolvedTemp);
    assert.equal(tempRootStat.isDirectory(), true);
    assert.equal(tempRootStat.isSymbolicLink(), false);
    assert.equal(resolve(dirname(resolvedTemp)), resolve(tmpdir()));
    await rm(resolvedTemp, { recursive: true, force: true });
  }
});
