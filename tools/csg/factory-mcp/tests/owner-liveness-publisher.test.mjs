import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = resolve(packageRoot, '../../..');
const publisherPath = resolve(packageRoot, 'broker/owner-liveness-publisher.ps1');
const brokerPath = resolve(packageRoot, 'broker/hostguard-broker.ps1');
const installerPath = resolve(packageRoot, 'windows/install-broker.ps1');
const diagnosticsPath = resolve(packageRoot, 'src/readonly-diagnostics.ps1');

function fixture(now = new Date()) {
  const observedAt = now.toISOString();
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
    observation_id: `${name}-observation`,
    provider_observation_id: 'provider-observation',
    ...identity,
    observed_at: observedAt,
    source,
    state,
    ...fields,
  });
  return {
    schema: 'v51.factory.owner-liveness.snapshot.v1',
    ...identity,
    owner_principal_id: 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',
    owner_scope: identity.task_id,
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
  };
}

function invokePowerShell(command, input) {
  const encoded = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  const utf8Stdin = '([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())))';
  const compatibleCommand = command.replaceAll('([Console]::In.ReadToEnd())', utf8Stdin);
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', compatibleCommand], {
    input: encoded,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
}

const stable = (value) => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const canonicalJson = (value) => JSON.stringify(stable(value));

test('publisher is wired only to the fixed state source and no-argument status route', async () => {
  const [publisher, broker, installer, diagnostics, liveStatusSmoke] = await Promise.all([
    readFile(publisherPath, 'utf8'), readFile(brokerPath, 'utf8'), readFile(installerPath, 'utf8'),
    readFile(diagnosticsPath, 'utf8'), readFile(resolve(packageRoot, 'tests/live-status-smoke.mjs'), 'utf8'),
  ]);
  assert.match(publisher, /function Get-OwnerLivenessProcessCandidates/);
  assert.match(publisher, /function New-OwnerLivenessBrokerSourceSnapshot/);
  assert.match(publisher, /Get-CimInstance -ClassName Win32_Process -Filter "Name='Codex\.exe' OR Name='ChatGPT\.exe'"/);
  assert.match(publisher, /SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED/);
  assert.match(publisher, /PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED/);
  assert.doesNotMatch(publisher, /owner-liveness-source\.json/);
  assert.match(publisher, /Join-Path \$state 'owner-liveness\.json'/);
  assert.match(publisher, /Test-OwnerLivenessStateDirectoryBoundary/);
  assert.match(publisher, /Test-OwnerLivenessProtectedReadFile/);
  assert.match(publisher, /Test-OwnerLivenessStateDirectoryAcl/);
  assert.match(publisher, /owner_generation = 5/);
  assert.match(publisher, /provider = 'codex'/);
  assert.match(publisher, /owner_principal_id = 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125'/);
  assert.match(publisher, /function Get-OwnerLivenessIdentityFingerprint/);
  assert.match(publisher, /IDENTITY_FINGERPRINT_MISMATCH/);
  assert.match(publisher, /\[IO\.File\]::Replace\(/);
  assert.ok(publisher.indexOf('OWNER_LIVENESS_EXISTING_TARGET_ACL_INVALID') < publisher.indexOf('[IO.File]::Replace('),
    'the existing destination ACL must be validated before ReplaceFile preserves it');
  assert.ok(publisher.indexOf('OWNER_LIVENESS_TEMPORARY_ACL_INVALID') < publisher.indexOf('[IO.File]::Replace('),
    'the new snapshot ACL must be validated before any replacement');
  assert.match(publisher, /OWNER_LIVENESS_PUBLISHER_SYSTEM_REQUIRED/);
  assert.match(publisher, /\$fileStream\.Flush\(\$true\)/);
  assert.ok(publisher.indexOf('$fileStream.Write(') < publisher.indexOf('$fileStream.Flush($true)'));
  assert.ok(publisher.indexOf('$fileStream.Flush($true)') < publisher.indexOf('Set-OwnerLivenessPublishedFileAcl -Path $temporaryPath'));
  assert.ok(publisher.indexOf('Set-OwnerLivenessPublishedFileAcl -Path $temporaryPath') < publisher.indexOf('[IO.File]::Replace('));
  assert.doesNotMatch(publisher, /\[IO\.File\]::WriteAllText\(\$temporaryPath/);
  assert.match(broker, /Publish-OwnerLivenessSnapshot/);
  assert.match(broker, /Get-OwnerLivenessBrokerHealthStatus -PublisherStatus \$ownerLivenessPublisherStatus/);
  assert.match(installer, /BROKER_OWNER_LIVENESS_PUBLISHER_NOT_READY/);
  assert.match(installer, /LIVE_STATUS_OWNER_LIVENESS_READBACK_INVALID/);
  assert.match(liveStatusSmoke, /assertFreshTimestamp\(broker\?\.recorded_at_utc/);
  assert.match(liveStatusSmoke, /assertFreshTimestamp\(ownerLiveness\?\.publisher_observed_at_utc/);
  assert.match(liveStatusSmoke, /brokerTask\.state, 'Running'/);
  assert.match(liveStatusSmoke, /process\.pid === broker\.pid/);
  assert.match(installer, /Test-FreshUtcTimestamp/);
  assert.match(installer, /Get-VerifiedBrokerTaskState -TaskName \$brokerTask/);
  assert.match(installer, /LIVE_STATUS_BROKER_OR_PUBLISHER_STALE/);
  assert.match(liveStatusSmoke, /expectedReadStatusByPublisherStatus/);
  assert.match(liveStatusSmoke, /assert\.equal\(ownerLiveness\?\.publisher_status, publisherStatus\)/);
  assert.match(liveStatusSmoke, /factory-mcp:\/\/state\/owner-liveness\.json/);
  assert.match(installer, /broker\\owner-liveness-publisher\.ps1/);
  for (const requiredFile of [
    'src\\readonly-diagnostics.mjs',
    'src\\readonly-diagnostics.ps1',
    'tests\\official-inspector-equivalence.mjs',
    'tests\\read-only-diagnostics.test.mjs',
    'tests\\owner-liveness-publisher.test.mjs',
    'tests\\owner-liveness-e2e.test.mjs',
  ]) {
    assert.equal(installer.includes("'" + requiredFile + "'"), true, 'installer must stage ' + requiredFile);
  }
  assert.match(diagnostics, /v51\.factory\.owner-liveness\.publication\.v1/);
  assert.ok(liveStatusSmoke.includes("['factory_status','host_powershell','worker_prepare','worker_start']"));
  assert.match(liveStatusSmoke, /v51\.factory-mcp\.readonly-diagnostics\.v1/);
  assert.match(liveStatusSmoke, /payload\.hostguard\?\.read_status/);
  assert.match(liveStatusSmoke, /payload\.hostguard\.payload/);
  assert.match(liveStatusSmoke, /supervisor_task_read_status/);
  assert.match(installer, /LIVE_STATUS_SUPERVISOR_TASK_OBSERVATION_INVALID/);
  assert.match(installer, /owner-liveness-e2e\.test\.mjs/);
  assert.doesNotMatch(publisher, /param\([^)]*(?:Path|Command|ScriptBlock)/i);
});

test('fixed SYSTEM collector produces a fresh partial snapshot from bounded local process readback', { skip: process.platform !== 'win32' }, () => {
  const command = String.raw`$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); . $payload.script_path
function Get-CimInstance { param([string]$ClassName,[string]$Filter,[string]$ErrorAction) return @(
  [pscustomobject]@{Name='Codex.exe';ProcessId=[uint32]101;CreationDate=(Get-Date).AddMinutes(-5)},
  [pscustomobject]@{Name='ChatGPT.exe';ProcessId=[uint32]102;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-4))}) }
function Invoke-CimMethod { param($InputObject,[string]$MethodName,[string]$ErrorAction) return [pscustomobject]@{ReturnValue=0;Domain='TEST';User='Executor'} }
function Get-ScheduledTask { param([string]$TaskName,[string]$ErrorAction) return [pscustomobject]@{State='Disabled';Settings=[pscustomobject]@{Enabled=$false};Principal=[pscustomobject]@{UserId='x'}} }
$state=$payload.state_directory
Set-OwnerLivenessProjectId -ProjectId $payload.project_id
$snapshot=New-OwnerLivenessBrokerSourceSnapshot -StateDirectory $state
$validation=Get-OwnerLivenessSnapshotValidation -Snapshot $snapshot -NowUtc ([DateTimeOffset]::UtcNow)
$safe=ConvertTo-SafeOwnerLivenessSnapshot -Snapshot $snapshot
$snapshot.fingerprint='f'*64
$fingerprintValidation=Get-OwnerLivenessSnapshotValidation -Snapshot $snapshot -NowUtc ([DateTimeOffset]::UtcNow)
[Console]::Out.Write((ConvertTo-Json -InputObject ([ordered]@{validation=$validation;fingerprint_validation=$fingerprintValidation;snapshot=$safe}) -Depth 12 -Compress))`;
  const result = invokePowerShell(command, { script_path: publisherPath, state_directory: tmpdir(), project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.validation, 'VALID');
  assert.equal(output.fingerprint_validation, 'IDENTITY_FINGERPRINT_MISMATCH');
  assert.equal(output.snapshot.source, 'system-broker-fixed-owner-liveness-collector');
  assert.equal(output.snapshot.provider_observation_id, null);
  assert.equal(output.snapshot.components.os_process.state, 'UNKNOWN');
  assert.equal(output.snapshot.components.os_process.identity_link_status, 'UNRESOLVED');
  assert.equal(output.snapshot.components.os_process.candidate_processes.length, 2);
  assert.deepEqual(output.snapshot.components.os_process.candidate_processes.map((process) => process.process_id), [101, 102]);
  for (const process of output.snapshot.components.os_process.candidate_processes) {
    assert.match(process.process_started_at_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(Number.isNaN(Date.parse(process.process_started_at_utc)), false);
  }
  assert.equal(output.snapshot.components.provider_agent_session.state, 'UNAVAILABLE');
  assert.equal(output.snapshot.components.provider_agent_session.unavailability_reason, 'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED');
  assert.equal(output.snapshot.components.supervisor_heartbeat.state, 'UNAVAILABLE');
  assert.equal(output.snapshot.components.supervisor_heartbeat.heartbeat_id, null);
  assert.equal(output.snapshot.components.supervisor_heartbeat.supervisor_task_observation.read_status, 'PRESENT');
  assert.equal(output.snapshot.components.supervisor_heartbeat.supervisor_task_observation.task_name, 'PTYSD-VNext42-Supervisor-Candidate1');
  assert.equal(output.snapshot.components.supervisor_heartbeat.supervisor_task_observation.state, 'Disabled');
  assert.equal(output.snapshot.components.supervisor_heartbeat.supervisor_task_observation.enabled, false);
  assert.equal(output.snapshot.components.supervisor_heartbeat.supervisor_task_observation.principal, 'x');
});

test('broker health degrades and install qualification rejects an owner publisher failure', { skip: process.platform !== 'win32' }, () => {
  const command = `$null=ConvertFrom-Json ([Console]::In.ReadToEnd()); . '${publisherPath.replaceAll("'", "''")}'; [Console]::Out.Write((Get-OwnerLivenessBrokerHealthStatus 'SOURCE_MISSING')+','+(Get-OwnerLivenessBrokerHealthStatus 'PUBLISH_FAILED')+','+(Get-OwnerLivenessBrokerHealthStatus 'UNKNOWN'))`;
  const result = invokePowerShell(command, {});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'READY,DEGRADED,DEGRADED');
});

test('PowerShell installer qualification rejects stale health and a stopped broker task', { skip: process.platform !== 'win32' }, () => {
  const command = "$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); $tokens=$null; $errors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile($payload.script_path,[ref]$tokens,[ref]$errors); if($errors.Count -gt 0){exit 2}; $fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-FreshUtcTimestamp'},$true); $taskFn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-VerifiedBrokerTaskState'},$true); if(-not $fn -or -not $taskFn){exit 3}; Invoke-Expression $fn.Extent.Text; Invoke-Expression $taskFn.Extent.Text; $now=[DateTimeOffset]::UtcNow; $fresh=$now.UtcDateTime.ToString('o'); $stale=$now.AddSeconds(-60).UtcDateTime.ToString('o'); $future=$now.AddSeconds(60).UtcDateTime.ToString('o'); $script:mockTask=[pscustomobject]@{State='Running';Settings=[pscustomobject]@{Enabled=$true};Principal=[pscustomobject]@{UserId='SYSTEM'}}; function Get-ScheduledTask { param([string]$TaskName) return $script:mockTask }; $live=Get-VerifiedBrokerTaskState -TaskName 'mock'; $script:mockTask.State='Ready'; $stopped=''; try{[void](Get-VerifiedBrokerTaskState -TaskName 'mock')}catch{$stopped=$_.Exception.Message}; [Console]::Out.Write(('{0},{1},{2},{3},{4}' -f (Test-FreshUtcTimestamp $fresh),(Test-FreshUtcTimestamp $stale),(Test-FreshUtcTimestamp $future),$live,$stopped))";
  const result = invokePowerShell(command, { script_path: installerPath });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'True,False,False,Running,BROKER_TASK_NOT_RUNNING');
});

test('PowerShell 5.1 parses the publisher, broker, installer, and diagnostic reader', { skip: process.platform !== 'win32' }, async () => {
  const paths = [publisherPath, brokerPath, installerPath, diagnosticsPath];
  const command = "$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); foreach($path in $payload){$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile([string]$path,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){$errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) };exit 2}};[Console]::Out.Write('PASS')";
  const result = invokePowerShell(command, paths);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'PASS');
});

test('PowerShell publisher validator accepts exact fresh evidence and fails closed on mismatched or stale inputs', { skip: process.platform !== 'win32' }, () => {
  const command = "$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); . $payload.script_path; Set-OwnerLivenessProjectId -ProjectId $payload.snapshot.project_id; $snapshot=$payload.snapshot; [Console]::Out.Write((Get-OwnerLivenessSnapshotValidation -Snapshot $snapshot -NowUtc ([DateTimeOffset]::UtcNow)))";
  const valid = invokePowerShell(command, { script_path: publisherPath, snapshot: fixture() });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.equal(valid.stdout, 'VALID');

  const mismatched = fixture();
  mismatched.components.os_process.owner_generation = 6;
  const mismatch = invokePowerShell(command, { script_path: publisherPath, snapshot: mismatched });
  assert.equal(mismatch.status, 0, mismatch.stderr || mismatch.stdout);
  assert.equal(mismatch.stdout, 'IDENTITY_MISMATCH');

  for (const change of [
    { task_id: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION' },
    { owner_generation: 6 },
    { owner_principal_id: 'CODEX_THREAD_OTHER' },
    { owner_scope: 'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION' },
  ]) {
    const wrongTarget = fixture();
    Object.assign(wrongTarget, change);
    const rejected = invokePowerShell(command, { script_path: publisherPath, snapshot: wrongTarget });
    assert.equal(rejected.status, 0, rejected.stderr || rejected.stdout);
    assert.equal(rejected.stdout, 'TARGET_IDENTITY_MISMATCH');
  }

  const staleDate = new Date(Date.now() - 120000).toISOString();
  const stale = fixture(new Date(staleDate));
  const old = invokePowerShell(command, { script_path: publisherPath, snapshot: stale });
  assert.equal(old.status, 0, old.stderr || old.stdout);
  assert.equal(old.stdout, 'STALE');

  const futureTime = new Date(Date.now() + 60000).toISOString();
  const futureProcessStart = fixture();
  Object.assign(futureProcessStart.components.os_process, {
    state: 'ACTIVE', process_id: 23456, process_image: 'codex.exe',
    process_principal: 'NT AUTHORITY\\NETWORK SERVICE', process_started_at_utc: futureTime,
  });
  const futureProcess = invokePowerShell(command, { script_path: publisherPath, snapshot: futureProcessStart });
  assert.equal(futureProcess.status, 0, futureProcess.stderr || futureProcess.stdout);
  assert.equal(futureProcess.stdout, 'OS_PROCESS_IDENTITY_INVALID');

  const futureHeartbeat = fixture();
  futureHeartbeat.components.supervisor_heartbeat.heartbeat_at_utc = futureTime;
  const futureSupervisor = invokePowerShell(command, { script_path: publisherPath, snapshot: futureHeartbeat });
  assert.equal(futureSupervisor.status, 0, futureSupervisor.stderr || futureSupervisor.stdout);
  assert.equal(futureSupervisor.stdout, 'SUPERVISOR_HEARTBEAT_IDENTITY_INVALID');
});

test('fixed Supervisor heartbeat readback binds the exact owner generation to immutable signed bytes', { skip: process.platform !== 'win32' }, () => {
  const state = mkdtempSync(join(tmpdir(), 'ptysd-host-heartbeat-readback-'));
  try {
    const now = new Date().toISOString();
    const ownerPrincipalId = 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125';
    const ownerScope = 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION';
    const identity = {
      project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', provider: 'codex', task_id: ownerScope,
      attempt_id: 'V51-R2-02-ATTEMPT-002', attempt_epoch: 2, owner_generation: 5,
      fingerprint: createHash('sha256').update([
        'CHATGPT_GLOBAL_SKILL_GOVERNANCE','codex',ownerScope,'V51-R2-02-ATTEMPT-002','2','5',ownerPrincipalId,ownerScope,
      ].join('\n')).digest('hex'),
    };
    const keyPair = generateKeyPairSync('ed25519');
    const reference = `recovery://supervisor-heartbeat/${'d'.repeat(32)}`;
    const payload = {
      observation_id: 'HB-readback-test-1', provider_observation_id: 'provider-observation-gen5', ...identity,
      observed_at: now, source: 'host-supervisor-heartbeat-readback', state: 'ACTIVE',
      owner_principal_id: ownerPrincipalId, owner_session_id: ownerPrincipalId, provider_session_id: 'provider-session-gen5',
      supervisor_id: 'PTYSD-HOST-SUPERVISOR', heartbeat_id: 'HB-readback-test-1', heartbeat_at_utc: now,
      boot_identity: 'boot:host-test', process_identity: 'pid:4242;created:2026-10-01T00:00:00.000Z',
      service_identity: 'PTYSD-VNext42-Supervisor', task_identity: ownerScope,
    };
    const signedBody = { schema: 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1', issuer_key_id: 'test-host-heartbeat', payload };
    const signature = sign(null, Buffer.from(canonicalJson(signedBody)), keyPair.privateKey).toString('base64');
    const evidenceBytes = Buffer.from(JSON.stringify({ ...signedBody, signature }));
    const evidenceDigest = `sha256:${createHash('sha256').update(evidenceBytes).digest('hex')}`;
    const evidenceDirectory = join(state, 'recovery-evidence', 'objects', 'supervisor-heartbeat');
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, `${'d'.repeat(32)}.json`), evidenceBytes, { flag: 'wx' });
    writeFileSync(join(state, 'supervisor-heartbeat-readback.json'), JSON.stringify({
      schema: 'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1', ...identity,
      owner_principal_id: ownerPrincipalId, owner_session_id: ownerPrincipalId, provider_session_id: 'provider-session-gen5',
      supervisor_id: payload.supervisor_id, heartbeat_id: payload.heartbeat_id, observed_at: now,
      heartbeat_at_utc: now, boot_identity: payload.boot_identity, process_identity: payload.process_identity,
      service_identity: payload.service_identity, task_identity: ownerScope, evidence_ref: reference,
      evidence_digest: evidenceDigest,
    }), { flag: 'wx' });

    const command = String.raw`$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); . $payload.script_path
$state=$payload.state_directory
function Test-OwnerLivenessProtectedReadFile { param([string]$Path) return $true }
function Test-OwnerLivenessStateDirectoryAcl { param($Acl) return $true }
function Test-OwnerLivenessProtectedReadDirectory { param([string]$Path) return $true }
$result=Get-OwnerLivenessSupervisorHeartbeatReadback -Identity $payload.identity
[Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress -Depth 5))`;
    const result = invokePowerShell(command, { script_path: publisherPath, state_directory: state, identity });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const readback = JSON.parse(result.stdout);
    assert.equal(readback.readback_status, 'PRESENT', JSON.stringify(readback));
    assert.equal(readback.state, 'ACTIVE');
    assert.equal(readback.heartbeat_evidence_ref, reference);
    assert.equal(readback.heartbeat_evidence_digest, evidenceDigest);

    const altered = Buffer.from(evidenceBytes);
    altered[altered.length - 2] ^= 1;
    writeFileSync(join(evidenceDirectory, `${'d'.repeat(32)}.json`), altered);
    const tampered = invokePowerShell(command, { script_path: publisherPath, state_directory: state, identity });
    assert.equal(tampered.status, 0, tampered.stderr || tampered.stdout);
    assert.equal(JSON.parse(tampered.stdout).readback_status, 'UNAVAILABLE');
    assert.equal(JSON.parse(tampered.stdout).unavailability_reason, 'SUPERVISOR_HEARTBEAT_EVIDENCE_DIGEST_MISMATCH');
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('fixed publisher exposes provider/local references only after exact readbacks and durable digests agree', { skip: process.platform !== 'win32' }, () => {
  const state = mkdtempSync(join(tmpdir(), 'ptysd-recovery-reference-readbacks-'));
  try {
    const now = new Date().toISOString();
    const ownerPrincipalId = 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125';
    const ownerScope = 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION';
    const identity = {
      project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', provider: 'codex', task_id: ownerScope,
      attempt_id: 'V51-R2-02-ATTEMPT-002', attempt_epoch: 2, owner_generation: 5,
      fingerprint: createHash('sha256').update([
        'CHATGPT_GLOBAL_SKILL_GOVERNANCE','codex',ownerScope,'V51-R2-02-ATTEMPT-002','2','5',ownerPrincipalId,ownerScope,
      ].join('\n')).digest('hex'),
    };
    const providerObservationId = 'provider-observation-gen5';
    const providerSessionId = 'provider-session-gen5';
    const ownerSessionId = ownerPrincipalId;
    const providerBytes = Buffer.from(JSON.stringify({ schema: 'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1', test: true }));
    const localBytes = Buffer.from(JSON.stringify({ schema: 'PTYSD_LOCAL_LIVENESS_EVIDENCE_V1', test: true }));
    const providerDigest = `sha256:${createHash('sha256').update(providerBytes).digest('hex')}`;
    const localDigest = `sha256:${createHash('sha256').update(localBytes).digest('hex')}`;
    const providerReference = `recovery://provider/${'a'.repeat(32)}`;
    const localReference = `recovery://local/${'b'.repeat(32)}`;
    const objectRoot = join(state, 'recovery-evidence', 'objects');
    mkdirSync(join(objectRoot, 'provider'), { recursive: true });
    mkdirSync(join(objectRoot, 'local'), { recursive: true });
    writeFileSync(join(objectRoot, 'provider', `${'a'.repeat(32)}.json`), providerBytes, { flag: 'wx' });
    writeFileSync(join(objectRoot, 'local', `${'b'.repeat(32)}.json`), localBytes, { flag: 'wx' });
    writeFileSync(join(state, 'provider-session-readback.json'), JSON.stringify({
      schema: 'PTYSD_PROVIDER_SESSION_READBACK_V1', ...identity,
      owner_principal_id: ownerPrincipalId, owner_session_id: ownerSessionId, provider_session_id: providerSessionId,
      observation_id: providerObservationId, provider_job_id: null, observed_at: now, state: 'TERMINAL',
      evidence_ref: providerReference, evidence_digest: providerDigest,
    }), { flag: 'wx' });
    const localReadbackPath = join(state, 'local-liveness-evidence-readback.json');
    const localReadback = {
      schema: 'PTYSD_LOCAL_LIVENESS_EVIDENCE_READBACK_V1', ...identity,
      owner_principal_id: ownerPrincipalId, owner_session_id: ownerSessionId, provider_session_id: providerSessionId,
      observation_id: 'local-observation-gen5', provider_observation_id: providerObservationId, observed_at: now,
      evidence_ref: localReference, evidence_digest: localDigest,
    };
    writeFileSync(localReadbackPath, JSON.stringify(localReadback), { flag: 'wx' });

    const command = String.raw`$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); . $payload.script_path
$state=$payload.state_directory
function Test-OwnerLivenessProtectedReadFile { param([string]$Path) return $true }
function Test-OwnerLivenessProtectedReadDirectory { param([string]$Path) return $true }
$result=Get-OwnerLivenessRecoveryEvidenceReadbacks -Identity $payload.identity -StateDirectory $state
[Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress -Depth 6))`;
    const result = invokePowerShell(command, { script_path: publisherPath, state_directory: state, identity });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const publication = JSON.parse(result.stdout);
    assert.equal(publication.recovery_evidence.status, 'AVAILABLE', JSON.stringify(publication));
    assert.deepEqual(publication.recovery_evidence.provider, { evidence_ref: providerReference, evidence_digest: providerDigest });
    assert.deepEqual(publication.recovery_evidence.local, { evidence_ref: localReference, evidence_digest: localDigest });
    assert.equal(publication.provider_readback.owner_session_id, ownerSessionId);
    assert.equal(publication.provider_readback.provider_session_id, providerSessionId);

    localReadback.provider_observation_id = 'different-provider-observation';
    writeFileSync(localReadbackPath, JSON.stringify(localReadback));
    const mismatched = invokePowerShell(command, { script_path: publisherPath, state_directory: state, identity });
    assert.equal(mismatched.status, 0, mismatched.stderr || mismatched.stdout);
    assert.equal(JSON.parse(mismatched.stdout).recovery_evidence.status, 'UNAVAILABLE');
    assert.equal(JSON.parse(mismatched.stdout).recovery_evidence.reason_code, 'TRUSTED_SIGNED_EVIDENCE_READBACK_METADATA_INVALID');
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('state-directory ACL validation requires a trusted owner and read-only Network Service access', { skip: process.platform !== 'win32' }, () => {
  const command = String.raw`$null=ConvertFrom-Json ([Console]::In.ReadToEnd()); . '${publisherPath.replaceAll("'", "''")}';
function New-TestDirectoryAcl([string]$ownerSid) {
  $acl=New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($ownerSid)))
  foreach($grant in @(
    @{sid='S-1-5-18';rights=[System.Security.AccessControl.FileSystemRights]::FullControl},
    @{sid='S-1-5-32-544';rights=[System.Security.AccessControl.FileSystemRights]::FullControl},
    @{sid='S-1-5-20';rights=[System.Security.AccessControl.FileSystemRights]::ReadAndExecute}
  )) {
    $rule=New-Object System.Security.AccessControl.FileSystemAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier($grant.sid)),
      $grant.rights,[System.Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  return $acl
}
$trusted=Test-OwnerLivenessStateDirectoryAcl -Acl (New-TestDirectoryAcl 'S-1-5-18')
$untrusted=Test-OwnerLivenessStateDirectoryAcl -Acl (New-TestDirectoryAcl 'S-1-5-20')
[Console]::Out.Write("$trusted,$untrusted")`;
  const result = invokePowerShell(command, {});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'True,False');
});

test('diagnostic reader accepts only the read-only Network Service snapshot identity', { skip: process.platform !== 'win32' }, () => {
  const command = String.raw`$source=Get-Content -LiteralPath '${diagnosticsPath.replaceAll("'", "''")}' -Raw
$match=[regex]::Match($source,'(?s)function Test-OwnerLivenessReadAclRules\s*\{.*?(?=\r?\nfunction Test-OwnerLivenessReadAcl\s*\{)')
if (-not $match.Success) { throw 'OWNER_LIVENESS_READ_ACL_HELPER_MISSING' }
Invoke-Expression $match.Value
function New-TestAcl([System.Security.AccessControl.FileSystemRights]$NetworkRights) {
  $acl=New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))
  foreach($grant in @(
    @{sid='S-1-5-18';rights=[System.Security.AccessControl.FileSystemRights]::FullControl},
    @{sid='S-1-5-32-544';rights=[System.Security.AccessControl.FileSystemRights]::FullControl},
    @{sid='S-1-5-20';rights=$NetworkRights}
  )) {
    $rule=New-Object System.Security.AccessControl.FileSystemAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier($grant.sid)),
      $grant.rights,[System.Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  return $acl
}
$acl=New-TestAcl ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
$networkService=Test-OwnerLivenessReadAclRules -Acl $acl -CallerSid 'S-1-5-20'
$system=Test-OwnerLivenessReadAclRules -Acl $acl -CallerSid 'S-1-5-18'
$administrators=Test-OwnerLivenessReadAclRules -Acl $acl -CallerSid 'S-1-5-32-544'
$writerAcl=New-TestAcl ([System.Security.AccessControl.FileSystemRights]::Modify)
$networkServiceWriter=Test-OwnerLivenessReadAclRules -Acl $writerAcl -CallerSid 'S-1-5-20'
[Console]::Out.Write("$networkService,$system,$administrators,$networkServiceWriter")`;
  const result = invokePowerShell(command, {});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'True,False,False,False');
});
