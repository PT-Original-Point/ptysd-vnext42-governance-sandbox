import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Supervisor } from '../src/core.ts';
import {
  createFactoryStatusPublicationReadRoute,
  createImmutableEvidenceReader,
  createImmutableEvidenceWriter,
  createProviderSessionReadRoute,
  createRecoveryEvidenceComposition,
  createSupervisorHeartbeatReadRoute,
} from '../src/recovery-evidence.ts';
import { publishLocalOwnerLivenessEvidence, publishProviderSessionEvidence } from '../src/recovery-evidence-producer.ts';
import { publishSupervisorHeartbeatEvidence } from '../src/supervisor-heartbeat.ts';

const project = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const expectedProducerHead = 'f45ef980a0194c54db6f2e3d5585577154ac5754';
const expectedProducerBase = 'd39486601d851e31256852a24e9c1393b9046fe5';
const expectedProducerTree = '99da8c94276db2f1cbb1b7adf593e74caa82621a';
const expectedProducerBlobs = [
  ['tools/csg/factory-mcp/src/shared-context.mjs', 'ae61d6c57b64ef003384406ddfa2ffc6865352a5'],
  ['tools/csg/factory-mcp/broker/host-powershell-exec.ps1', '68c259c12eb303157adebbbc5b855959931b7ec9'],
  ['tools/csg/factory-mcp/broker/hostguard-broker.ps1', 'cadc0472cfc0901809d82c43abcde00117b3dece'],
  ['tools/csg/factory-mcp/broker/owner-liveness-publisher.ps1', '992d66622f4745e7d448d998cc3b5f30944a8064'],
  ['tools/csg/factory-mcp/package.json', '992cb1b86b4e810232f6f9b4835f731776827040'],
  ['tools/csg/factory-mcp/src/index.mjs', '3f5726d5055843810aaa33c57b5e51f04c445061'],
  ['tools/csg/factory-mcp/src/invoke-hostguard.ps1', '59c8ada6dfd9120b75f7130096f83493c1b9bb7d'],
  ['tools/csg/factory-mcp/src/readonly-diagnostics.mjs', '463ca0119738a28477a18061750e87dd7fd56186'],
  ['tools/csg/factory-mcp/src/readonly-diagnostics.ps1', '1c16dd9321683c6ee4ae16ab0a0e48220f887567'],
  ['tools/csg/factory-mcp/windows/install-broker.ps1', 'be286f182214270fbb254d852be26a6ff844ec78'],
];
const expectedProducerBodyBindings = [
  ['tools/csg/factory-mcp/src/shared-context.mjs', '4209c2743f4fa85f5d9ac195a1f756ce45ea6e59cb8f3032f7950d9555860f37', 'ae61d6c57b64ef003384406ddfa2ffc6865352a5'],
  ['tools/csg/factory-mcp/src/shared-context-transport.mjs', 'd8b1381785f636605ca8459f18f93ad24bf86dfb97d5b521cd6e329bd34c1ea7', 'eff1825d6decfbaaa10efd414b67402c1c774a79'],
  ['tools/csg/factory-mcp/tests/shared-context-transport.test.mjs', '172385e76f7df8d466be22559115b98b5f22c32311bcff99f094424c07f7c821', '4e81f0ab1b96daad6e44839af3f00591cae2e4a0'],
  ['tools/csg/factory-mcp/windows/install-broker.ps1', '16817392772a87bf26f581af80b731730fdce9395a67b62b9eca64b0bbfb8eb0', 'be286f182214270fbb254d852be26a6ff844ec78'],
  ['tools/csg/factory-mcp/windows/repair-manifest.json', '7c661f97592f37b46e3df4d316830c9ff094b9fe987ab579b8dc37d63850f701', 'ba30e969f64a9154f3111276466bf0db8fe6c941'],
  ['tools/csg/factory-mcp/tests/shared-context-packaging.test.mjs', 'e9f594c2c70a2eb0b9cece2ce91a2f544d2036a797e0233f0051c21a1e7accac', 'bace1b230f0bb75afe3eb3862953261a12413625'],
  ['tools/csg/factory-mcp/tests/cold-session-consumer.test.mjs', '8d7521b7a4d0198a8216a38ea296fb4e0f29f0e8f62685dbc4b7e893baf3592e', '1b498f28385e9c28ddb4485e58249c30aec44b4c'],
];
const ownerPrincipal = 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125';
const task = 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION';
const openSupervisors = new Set();
const candidateRoot = path.resolve(process.env.PTYSD_R2_03_WORKTREE || '');
assert.ok(process.env.PTYSD_R2_03_WORKTREE, 'set PTYSD_R2_03_WORKTREE to the exact PR #385 source-only worktree');
assert.equal(execFileSync('git', ['-C', candidateRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expectedProducerHead);
assert.equal(execFileSync('git', ['-C', candidateRoot, 'rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim(), expectedProducerBase);
assert.equal(execFileSync('git', ['-C', candidateRoot, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), expectedProducerTree);
for (const [relative, expectedBlob] of expectedProducerBlobs) {
  const treeEntry = execFileSync('git', ['-C', candidateRoot, '-c', 'core.quotepath=false', 'ls-tree', '-r', expectedProducerTree, '--', relative], { encoding: 'utf8' }).trim();
  const [entryHeader, entryPath] = treeEntry.split('\t');
  const [mode, type, blob] = entryHeader.split(' ');
  assert.deepEqual([mode, type, blob, entryPath], ['100644', 'blob', expectedBlob, relative], 'producer tree blob mismatch: ' + relative);
}
for (const [relative, expectedRawSha256, expectedBlob] of expectedProducerBodyBindings) {
  const producerPath = path.join(candidateRoot, ...relative.split('/'));
  const producerBytes = fs.readFileSync(producerPath);
  assert.equal(createHash('sha256').update(producerBytes).digest('hex'), expectedRawSha256, 'producer source bytes mismatch: ' + relative);
  assert.equal(execFileSync('git', ['-C', candidateRoot, 'hash-object', '--no-filters', '--', producerPath], { encoding: 'utf8' }).trim(), expectedBlob, 'producer source blob mismatch: ' + relative);
}
const publisherPath = path.join(candidateRoot, 'tools', 'csg', 'factory-mcp', 'broker', 'owner-liveness-publisher.ps1');
const factoryDir = path.join(candidateRoot, 'tools', 'csg', 'factory-mcp');

function openSupervisor(...args) {
  const supervisor = new Supervisor(...args);
  openSupervisors.add(supervisor);
  return supervisor;
}

function closeSupervisor(supervisor) {
  if (openSupervisors.delete(supervisor)) supervisor.close();
}

function invokeFixedPublisher(stateDirectory) {
  const command = String.raw`$payloadBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())
$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($payloadBytes)); . $payload.script_path
$state=$payload.state_directory
function Get-OwnerLivenessPublisherIdentitySid { return 'S-1-5-18' }
function Test-OwnerLivenessStateDirectoryBoundary { return $true }
function Test-OwnerLivenessStateDirectoryAcl { param($Acl) return $true }
function Test-OwnerLivenessProtectedReadDirectory { param([string]$Path) return $true }
function Test-OwnerLivenessProtectedReadFile { param([string]$Path) return $true }
function Set-OwnerLivenessPublishedFileAcl { param([string]$Path) }
function Get-OwnerLivenessProcessCandidates {
  return [ordered]@{state='UNKNOWN';observed_at=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');identity_link_status='UNRESOLVED';records=@()}
}
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) return @() }
function Invoke-CimMethod { param($InputObject,[string]$MethodName,[string]$ErrorAction) return [pscustomobject]@{ReturnValue=0;Domain='TEST';User='Executor'} }
function Get-ScheduledTask { param([string]$TaskName,[string]$ErrorAction) return [pscustomobject]@{State='Disabled';Settings=[pscustomobject]@{Enabled=$false};Principal=[pscustomobject]@{UserId='x'}} }
$null=Publish-OwnerLivenessSnapshot
$published=[IO.File]::ReadAllText((Join-Path $state 'owner-liveness.json')) | ConvertFrom-Json
[Console]::Out.Write([string]$published.publisher_status + '|' + [string]$published.reason)`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    input: Buffer.from(JSON.stringify({ script_path: publisherPath, state_directory: stateDirectory }), 'utf8').toString('base64'),
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim().split('|')[0], 'PUBLISHED', JSON.stringify({ stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(fs.readFileSync(path.join(stateDirectory, 'owner-liveness.json'), 'utf8'));
}

async function readFactoryStatus(publicationPath) {
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: factoryDir,
    env: { ...process.env, NODE_ENV: 'test', PTYSD_FACTORY_MCP_TEST_MODE: '1', PTYSD_FACTORY_MCP_TEST_OWNER_LIVENESS_PATH: publicationPath },
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
    const finish = pending.get(message.id);
    pending.delete(message.id);
    finish(message);
  });
  let requestId = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP_TIMEOUT:${method}\n${stderr.join('')}`)); }, 10000);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const initialized = await send('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'r2-positive-cross-candidate', version: '1.0.0' },
    });
    assert.equal(initialized.result?.serverInfo?.name, 'ptysd-factory-mcp');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await send('tools/list', {});
    assert.deepEqual(listed.result?.tools?.map(tool => tool.name).sort(), [
      'factory_status', 'host_powershell', 'worker_prepare', 'worker_start',
    ]);
    const called = await send('tools/call', { name: 'factory_status', arguments: {} });
    assert.equal(called.result?.isError, undefined);
    return JSON.parse(called.result?.content?.[0]?.text ?? 'null');
  } finally {
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
    lines.close();
  }
}

function makeManifest(configPath, keyPairs) {
  const key = (keyId, role, scope, schema, pair) => ({
    key_id: keyId, issuer_role: role, scope, project_id: project, generation: 1,
    not_before: '1970-01-01T00:00:00.000Z', not_after: '2999-01-01T00:00:00.000Z', revoked_at: null,
    schemas: [schema], public_key_pem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  });
  const manifest = {
    schema: 'PTYSD_RUNTIME_MANIFEST_V1', project_id: project, provider_write_enabled: false, worker_provider_credentials: [],
    recovery_evidence: {
      schema: 'PTYSD_RECOVERY_EVIDENCE_TRUST_V1', project_id: project, trust_root_generation: 1,
      store: { kind: 'APPEND_ONLY_ID_ADDRESSED_WITH_DIGEST', route_id: 'PTYSD_FACTORY_MCP_RECOVERY_EVIDENCE_STORE_V1', max_bytes: 1048576 },
      trust_roots: { keys: [
        key('test-provider', 'PROVIDER_AGENT', 'V51_R2_PROVIDER_AGENT_SESSION', 'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1', keyPairs.provider),
        key('test-local', 'HOST_LOCAL', 'V51_R2_LOCAL_OWNER_LIVENESS', 'PTYSD_LOCAL_LIVENESS_EVIDENCE_V1', keyPairs.local),
        key('test-heartbeat', 'HOST_SUPERVISOR', 'V51_R2_SUPERVISOR_HEARTBEAT', 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1', keyPairs.heartbeat),
      ] },
      publication: { status: 'AVAILABLE', route_id: 'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1', reason_code: null },
      dependencies: {
        provider_session: { status: 'AVAILABLE', route_id: 'PTYSD_PROVIDER_AGENT_SESSION_READBACK_V1' },
        supervisor_heartbeat: { status: 'AVAILABLE', route_id: 'PTYSD_HOST_SUPERVISOR_HEARTBEAT_READBACK_V1' },
      },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(manifest), { flag: 'wx' });
}

function recoveryIdentity(context) {
  return {
    project_id: project, provider: context.provider, task_id: context.task_id,
    attempt_id: context.attempt_id, attempt_epoch: context.attempt_epoch, owner_generation: context.owner_generation,
    fingerprint: context.fingerprint, owner_principal_id: context.owner_principal_id,
    owner_session_id: context.owner_session_id, provider_session_id: context.provider_session_id,
  };
}

function evidencePorts(state, storeRoot, now, keyId, pair, readbackName) {
  const writer = createImmutableEvidenceWriter(storeRoot);
  const readbackPath = path.join(state, readbackName);
  return {
    now,
    signer: { keyId, sign: bytes => sign(null, Buffer.from(bytes), pair.privateKey) },
    writeEvidence(reference, bytes) {
      const match = /^recovery:\/\/(provider|local|supervisor-heartbeat)\/([a-f0-9]{32})$/.exec(reference);
      assert.ok(match);
      fs.mkdirSync(path.join(storeRoot, 'objects', match[1]), { recursive: true });
      return writer(reference, bytes);
    },
    publishReadback(bytes) { fs.writeFileSync(readbackPath, bytes, { flag: 'wx' }); },
    readReadback() { return fs.readFileSync(readbackPath); },
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v51-r2-positive-cross-candidate-'));
try {
  const state = path.join(root, 'state');
  const storeRoot = path.join(state, 'recovery-evidence');
  fs.mkdirSync(path.join(storeRoot, 'objects', 'provider'), { recursive: true });
  fs.mkdirSync(path.join(storeRoot, 'objects', 'local'), { recursive: true });
  fs.mkdirSync(path.join(storeRoot, 'objects', 'supervisor-heartbeat'), { recursive: true });
  const publicationPath = path.join(state, 'owner-liveness.json');
  const nowRef = { value: Date.now() };
  const dbPath = path.join(root, 'runtime.db');
  const gen5Envelope = {
    schema: 'PTYSD_TASK_ENVELOPE_V1', task_id: task, project_id: project, interrupt_epoch: 0,
    owner_generation: 5,
    objective: 'exact generation-5 recovery fixture', provider_write: false, allowed_paths: ['sandbox/**'],
    evidence_required: ['TEST_PASS'], attempt_id: 'V51-R2-02-ATTEMPT-002', attempt_epoch: 2, provider: 'codex',
    owner_principal_id: ownerPrincipal, owner_session_id: ownerPrincipal, provider_session_id: 'provider-session-gen5-test',
  };
  const seed = openSupervisor(dbPath, project, () => nowRef.value);
  seed.ingest(gen5Envelope);
  seed.ingest({ ...gen5Envelope, task_id: 'R2-NEXT-READY-TASK', attempt_id: 'R2-NEXT-READY-TASK:attempt:0' });
  seed.dispatch(task, 'worker-gen5', 100);
  nowRef.value += 101;
  assert.equal(seed.tick()?.generation, 1, 'the local worker lease sequence is independent of canonical owner generation 5');
  const identity = recoveryIdentity(seed.runtime().recovery_context);
  assert.equal(identity.owner_generation, 5);
  assert.equal(identity.fingerprint, 'f9752f706c34d011c8b16a8c7eea41096988b74c5356b608b3d3e8b2c9e2d5a1');
  closeSupervisor(seed);

  const providerObservationId = 'provider-observation-gen5-001';
  const time = new Date(nowRef.value).toISOString();
  const keyPairs = {
    provider: generateKeyPairSync('ed25519'),
    local: generateKeyPairSync('ed25519'),
    heartbeat: generateKeyPairSync('ed25519'),
  };
  const heartbeatContext = { identity, provider_observation_id: providerObservationId, owner_liveness_state: 'EXPIRED' };
  const host = {
    supervisor_id: 'PTYSD-HOST-SUPERVISOR', boot_identity: 'boot:cross-candidate',
    process_identity: 'pid:4242;created:2026-10-01T00:00:00.000Z', service_identity: 'PTYSD-VNext42-Supervisor',
  };
  const heartbeatPorts = evidencePorts(state, storeRoot, nowRef.value, 'test-heartbeat', keyPairs.heartbeat,
    'supervisor-heartbeat-readback.json');
  const heartbeat = publishSupervisorHeartbeatEvidence({ context: heartbeatContext, host, ...heartbeatPorts });

  const unavailableState = path.join(root, 'unavailable-state');
  fs.mkdirSync(unavailableState);
  const missingPublisher = invokeFixedPublisher(unavailableState);
  assert.equal(missingPublisher.recovery_evidence.status, 'UNAVAILABLE');
  const unavailableStatus = await readFactoryStatus(path.join(unavailableState, 'owner-liveness.json'));
  assert.deepEqual(unavailableStatus.owner_liveness.recovery_evidence, {
    schema: 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1', status: 'UNAVAILABLE',
    reason_code: 'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED',
  });
  const keysOnlyConfigPath = path.join(root, 'runtime-manifest-unavailable.json');
  makeManifest(keysOnlyConfigPath, keyPairs);
  const unavailableRoute = createFactoryStatusPublicationReadRoute(() => Buffer.from(JSON.stringify(unavailableStatus)));
  const unavailableComposition = createRecoveryEvidenceComposition(keysOnlyConfigPath, project, () => nowRef.value, {
    ownerLivenessPublication: unavailableRoute,
    immutableEvidence: { read: createImmutableEvidenceReader(storeRoot) },
    providerSession: createProviderSessionReadRoute(state),
    supervisorHeartbeat: createSupervisorHeartbeatReadRoute(state),
  });
  assert.throws(() => unavailableComposition.readCurrentObservation(), /OWNER_LIVENESS_SIGNED_EVIDENCE_UNAVAILABLE/);
  const parkedSupervisor = openSupervisor(dbPath, project, () => nowRef.value, unavailableComposition.trust);
  assert.throws(() => parkedSupervisor.dispatch('R2-NEXT-READY-TASK', 'worker-next', 60000), /RECOVERY_REQUIRED/);
  closeSupervisor(parkedSupervisor);

  const providerPayload = {
    ...identity, observation_id: providerObservationId, status: 'OBSERVED_EMPTY', provider_job_id: null,
    observed_at: time, source: 'authorized-provider-agent-session-readback', state: 'NONE',
  };
  publishProviderSessionEvidence({
    identity, payload: providerPayload,
    ports: evidencePorts(state, storeRoot, nowRef.value, 'test-provider', keyPairs.provider, 'provider-session-readback.json'),
  });
  const heartbeatComponent = heartbeat.component;
  const component = (name, source, stateValue) => ({
    observation_id: `local-${name}-001`, provider_observation_id: providerObservationId, ...identity,
    observed_at: time, source, state: stateValue,
  });
  const localPayload = {
    ...identity, observation_id: 'local-observation-gen5-001', provider_observation_id: providerObservationId,
    observed_at: time, source: 'authorized-cross-source-liveness-readback',
    components: {
      os_process: component('os-process', 'local-os-process-readback', 'ABSENT'),
      provider_agent_session: {
        ...component('provider-session', 'provider-agent-session-readback', 'TERMINAL'),
        provider_session_id: identity.provider_session_id, provider_job_id: null,
      },
      supervisor_heartbeat: { ...heartbeatComponent, state: 'EXPIRED' },
    },
  };
  publishLocalOwnerLivenessEvidence({
    identity, payload: localPayload,
    ports: evidencePorts(state, storeRoot, nowRef.value, 'test-local', keyPairs.local, 'local-liveness-evidence-readback.json'),
  });

  const published = invokeFixedPublisher(state);
  assert.equal(published.recovery_evidence.status, 'AVAILABLE', JSON.stringify(published.recovery_evidence));
  assert.match(published.recovery_evidence.provider.evidence_ref, /^recovery:\/\/provider\/[a-f0-9]{32}$/);
  assert.match(published.recovery_evidence.local.evidence_ref, /^recovery:\/\/local\/[a-f0-9]{32}$/);
  const factoryStatus = await readFactoryStatus(publicationPath);
  assert.equal(factoryStatus.schema, 'v51.factory-mcp.readonly-diagnostics.v1');
  assert.equal(factoryStatus.owner_liveness.read_status, 'AVAILABLE');
  assert.deepEqual(factoryStatus.owner_liveness.recovery_evidence, published.recovery_evidence);
  assert.equal(factoryStatus.owner_liveness.components?.supervisor_heartbeat?.state, 'EXPIRED',
    JSON.stringify({ owner_liveness: factoryStatus.owner_liveness, local_liveness_observation: factoryStatus.local_liveness_observation }));
  assert.equal(factoryStatus.owner_liveness.components?.os_process?.state, 'UNKNOWN');
  assert.equal(factoryStatus.owner_liveness.reconciliation_verdict, 'NOT_PERFORMED');

  const manifestPath = path.join(root, 'runtime-manifest.json');
  makeManifest(manifestPath, keyPairs);
  const factoryRoute = createFactoryStatusPublicationReadRoute(() => Buffer.from(JSON.stringify(factoryStatus)));
  const composition = createRecoveryEvidenceComposition(manifestPath, project, () => nowRef.value, {
    ownerLivenessPublication: factoryRoute,
    immutableEvidence: { read: createImmutableEvidenceReader(storeRoot) },
    providerSession: createProviderSessionReadRoute(state),
    supervisorHeartbeat: createSupervisorHeartbeatReadRoute(state),
  });
  const observation = composition.readCurrentObservation();
  assert.equal(observation.fingerprint, identity.fingerprint);
  assert.equal(observation.owner_generation, 5);
  const resolver = openSupervisor(dbPath, project, () => nowRef.value, composition.trust);
  const receipt = resolver.resolveRecovery(observation);
  assert.equal(receipt.result, 'RESOLVED');
  assert.equal(resolver.runtime().recovery_required, false);
  assert.equal(resolver.recoveryReceipts().length, 1);
  const resolvedAt = resolver.events().findIndex(event => event.kind === 'RECOVERY_RESOLVED');
  resolver.dispatch('R2-NEXT-READY-TASK', 'worker-next', 60000);
  const dispatchedAt = resolver.events().findIndex(event => event.kind === 'WORKER_DISPATCHED' && JSON.parse(event.detail).task_id === 'R2-NEXT-READY-TASK');
  assert.ok(resolvedAt >= 0 && dispatchedAt > resolvedAt);
  closeSupervisor(resolver);
  process.stdout.write('CROSS_CANDIDATE_FACTORY_STATUS_SIGNED_EVIDENCE_RECOVERY_RESOLUTION_PASS\n');
} finally {
  for (const supervisor of openSupervisors) {
    try { supervisor.close(); } finally { openSupervisors.delete(supervisor); }
  }
  const resolved = path.resolve(root), tempRoot = path.resolve(os.tmpdir()), info = fs.lstatSync(resolved);
  assert.equal(info.isDirectory(), true); assert.equal(info.isSymbolicLink(), false); assert.equal(path.dirname(resolved), tempRoot);
  fs.rmSync(resolved, { recursive: true, force: true });
}
