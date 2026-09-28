import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectOrphanStatusView } from '../src/orphan-status.mjs';

const broker = fs.readFileSync(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
const wrapper = fs.readFileSync(new URL('../src/invoke-hostguard.ps1', import.meta.url), 'utf8');
const operationIdentity = fs.readFileSync(new URL('../src/stable-operation-identity.mjs', import.meta.url), 'utf8');
const callerIdentity = fs.readFileSync(new URL('../broker/system-capability-identity.ps1', import.meta.url), 'utf8');
const capability = JSON.parse(fs.readFileSync(new URL('../config/system-capability.json', import.meta.url), 'utf8'));
const serverFence = fs.readFileSync(new URL('../src/current-execution-fence.mjs', import.meta.url), 'utf8');
const brokerFence = fs.readFileSync(new URL('../broker/current-execution-fence.ps1', import.meta.url), 'utf8');

test('host PowerShell has bounded multi-run lanes instead of one global lane', () => {
  for (const token of [
    '$script:activePowerShellJobs = @{}',
    '$maxConcurrentPowerShell = 4',
    '$maxPerRunPowerShell = 1',
    'Get-ActivePowerShellEntries',
    'POWERSHELL_CAPACITY_EXHAUSTED',
    'POWERSHELL_RUN_BUSY',
    'Complete-ActivePowerShellJobs',
    'active_count',
    'stale_count',
    'max_per_run',
  ]) assert.ok(broker.includes(token), `missing multi-project token: ${token}`);
  assert.equal(broker.includes('$script:activePowerShellJob = $null'), false);
  assert.equal(broker.includes("throw 'POWERSHELL_BUSY'"), false);
});

test('stale host jobs terminalize, orphan receipts reconcile, and capacity excludes orphans', () => {
  for (const token of [
    '$staleGraceSeconds = 5',
    'BROKER_WATCHDOG_TIMEOUT',
    "side_effect_state='UNKNOWN_AFTER_TIMEOUT'",
    "state = 'ORPHANED'",
    'Reconcile-OrphanedStartedReceipts',
    '$lastReceiptReconcile = [DateTime]::MinValue',
    'TotalSeconds -ge 5',
    'effective_active_count',
    'live_job_count',
    'orphan_count',
    'broker_records',
    'pending_receipt_count',
    'IDLE_WITH_ORPHANS',
    '$script:receiptSummary',
    'Stop-Job -Job $job',
  ]) assert.ok(broker.includes(token), `missing timeout/orphan token: ${token}`);
  assert.ok(broker.includes('age_seconds'));
  assert.ok(broker.includes('stale = [bool]$stale'));
  assert.equal(broker.includes('Stop-Process'), false);
  assert.equal(broker.includes('taskkill.exe'), false);
  assert.equal(broker.includes('New-Service'), false);
  assert.equal(broker.includes('Register-ScheduledTask'), false);
});

test('public Factory MCP surface stays exactly four tools', () => {
  const names = [...index.matchAll(/server\.registerTool\(\s*\n\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ['factory_status','host_powershell','worker_prepare','worker_start']);
  assert.equal(index.includes("'host_exec_status'"), false);
});

test('factory status returns a bounded allowlisted orphan identity view without mutating input', () => {
  const lane = {
    orphan_count: 3,
    orphan_records_total_count: 3,
    orphan_records_read_status: 'COMPLETE',
    orphan_records_read_at_utc: '2026-09-27T06:22:00.000Z',
    orphan_records_truncated: false,
    orphan_records: [
      {
        request_id: '0123456789abcdef0123456789abcdef',
        project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
        capability_id: 'CAP-GOV-SYSTEM-V1',
        operation_id: 'OP025',
        operation_key: 'd'.repeat(64),
        trusted_caller_sid: 'S-1-5-20',
        control_oid: '209e0ad9040a08965a49109e18f783cfd9c7c7f4',
        checkpoint_digest: `sha256:${'a'.repeat(64)}`,
        authorization_envelope_digest: `sha256:${'b'.repeat(64)}`,
        capability_generation: 4,
        run_id: 'V50-R3-001',
        task_id: 'R3-P0-03-READBACK',
        attempt_id: 'ATTEMPT-001',
        attempt_epoch: 1,
        started_at_utc: '2026-09-27T06:00:00.000Z',
        finished_at_utc: '2026-09-27T06:01:00.000Z',
        timeout_seconds: 60,
        state: 'ORPHANED',
        side_effect_state: 'UNKNOWN_AFTER_BROKER_RESTART',
        error_code: 'BROKER_RECEIPT_ORPHANED',
        receipt_digest: `sha256:${'c'.repeat(64)}`,
        stdout: 'must never be returned',
        stderr: 'must never be returned',
        script: 'must never be returned',
        receipt_path: 'C:\\ProgramData\\secret.json',
      },
      { state: 'ORPHANED', request_id: 'not-a-request-id', secret: 'drop' },
      { state: 'ORPHANED', request_id: 'fedcba9876543210fedcba9876543210', run_id: 'V50-R3-002' },
    ],
  };
  const before = structuredClone(lane);
  const projected = projectOrphanStatusView(lane, 2);
  assert.deepEqual(lane, before);
  assert.equal(projected.orphan_records_schema, 'v49.factory-mcp.orphan-records.v1');
  assert.equal(projected.orphan_records_read_status, 'COMPLETE');
  assert.equal(projected.orphan_records_total_count, 3);
  assert.equal(projected.orphan_records_truncated, true);
  assert.equal(projected.orphan_records.length, 2);
  assert.deepEqual(Object.keys(projected.orphan_records[0]).sort(), [
    'attempt_epoch','attempt_id','authorization_envelope_digest','capability_generation','capability_id',
    'checkpoint_digest','control_oid','error_code','finished_at_utc','operation_id','operation_key','project_id','receipt_digest',
    'request_id','run_id','side_effect_state','started_at_utc','state','task_id','timeout_seconds','trusted_caller_sid',
  ].sort());
  assert.equal(projected.orphan_records[0].state, 'ORPHANED');
  assert.equal(projected.orphan_records[0].stdout, undefined);
  assert.equal(projected.orphan_records[0].stderr, undefined);
  assert.equal(projected.orphan_records[0].script, undefined);
  assert.equal(projected.orphan_records[0].receipt_path, undefined);
  assert.equal(projected.orphan_records[1].request_id, null);
});

test('explicit unknown orphan totals remain null while legacy absence falls back', () => {
  const unavailable = projectOrphanStatusView({
    orphan_records_read_status: 'UNAVAILABLE',
    orphan_records_total_count: null,
    orphan_count: 0,
    orphan_records: [],
  });
  assert.equal(unavailable.orphan_records_total_count, null);
  assert.equal(unavailable.orphan_records_truncated, true);

  const partial = projectOrphanStatusView({
    orphan_records_read_status: 'PARTIAL',
    orphan_records_total_count: null,
    orphan_count: 7,
    orphan_records: [],
  });
  assert.equal(partial.orphan_records_total_count, null);
  assert.equal(partial.orphan_records_truncated, true);

  const legacy = projectOrphanStatusView({
    orphan_records_read_status: 'COMPLETE',
    orphan_count: 7,
    orphan_records: [],
  });
  assert.equal(legacy.orphan_records_total_count, 7);
});
test('PowerShell orphan receipt status projects a bounded reconciliation snapshot', () => {
  const start = broker.indexOf('function Get-ReceiptFileSha256 {');
  const end = broker.indexOf('\nfunction Reconcile-OrphanedStartedReceipts {', start);
  assert.ok(start >= 0 && end > start, 'missing bounded orphan view and digest functions');
  const reader = broker.slice(start, end);
  for (const token of [
    '[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete','ComputeHash($bytes)','ConvertFrom-Json','function Read-ReceiptSnapshot {','function ConvertTo-OrphanReceiptStatusRecord {','function Get-OrphanReceiptStatusView {','ORPHANED','$maxOrphanStatusRecords','$maxOrphanStatusBytes',
    'request_id','project_id','run_id','task_id','attempt_id','attempt_epoch','control_oid','operation_key','trusted_caller_sid',
    'checkpoint_digest','authorization_envelope_digest','capability_generation','started_at_utc',
    'finished_at_utc','timeout_seconds','side_effect_state','error_code','receipt_digest','truncated',
  ]) assert.ok(reader.includes(token), `missing orphan readback token: ${token}`);
  for (const token of [
    'Write-AtomicJson','Move-Item','Remove-Item','New-Item','Set-Content','Stop-Job','Stop-Process',
    'Get-Content','Get-ReceiptFileSha256 -Path','stdout','stderr','receipt_path','run_as','response_path',
  ]) assert.equal(reader.includes(token), false, `orphan status view must not mutate or expose ${token}`);
  assert.doesNotMatch(reader, /(?:\.|\[)script\b\s*(?:=|:)/i);
  assert.match(broker, /function Get-HostExecLaneStatus \{\r?\n  \$orphanView = Get-OrphanReceiptStatusView/);
  assert.match(broker, /\$maxOrphanStatusBytes = 524288/);
  const orphanStart = broker.indexOf('function Get-OrphanReceiptStatusView {');
  const orphanEnd = broker.indexOf('\nfunction Reconcile-OrphanedStartedReceipts {', orphanStart);
  const orphanReader = broker.slice(orphanStart, orphanEnd);
  assert.ok(orphanReader.includes('$summary.orphan_status_records'));
  for (const token of ['Get-ChildItem','Read-ReceiptSnapshot','Get-Content','ConvertFrom-Json','[IO.File]::Open']) {
    assert.equal(orphanReader.includes(token), false, `factory status must not access receipt files: ${token}`);
  }
  const reconcileStart = broker.indexOf('function Reconcile-OrphanedStartedReceipts {');
  const reconcileEnd = broker.indexOf('\nfunction Get-HostExecLaneStatus {', reconcileStart);
  const reconcile = broker.slice(reconcileStart, reconcileEnd);
  assert.ok(reconcile.includes('Read-ReceiptSnapshot -Path $file.FullName'));
  assert.ok(reconcile.includes('$orphanMetadataAttempts -lt $maxOrphanStatusRecords'));
  assert.ok(reconcile.includes('$summary.orphan_status_records = @($orphanMetadataRecords.ToArray())'));
  assert.ok(index.includes('projectOrphanStatusView(status.host_exec_lane)'));
});

test('PowerShell orphan receipt view returns five identities without mutating receipt bytes', { skip: process.platform !== 'win32' }, () => {
  const scriptPath = fileURLToPath(new URL('./orphan-status-view.test.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', [
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
  assert.match(result.stdout, /"result":"PASS"/);
  assert.match(result.stdout, /"receipt_bytes_unchanged":true/);
});


test('SYSTEM host capability is project scoped at server and broker without growing public MCP surface', () => {
  assert.equal(capability.schema, 'v49.factory-mcp.system-capability.v1');
  assert.equal(capability.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.equal(capability.capability_id, 'CAP-GOV-SYSTEM-V1');
  assert.equal(capability.production_allowed, false);
  assert.equal(capability.business_project_allowed, false);
  assert.equal(capability.public_tool_count, 4);
  assert.equal(capability.trusted_caller_sid, 'S-1-5-20');
  for (const token of [
    'SYSTEM_CAPABILITY_PATH','assertSystemCapabilityArgs',
    "'-ProjectId', SYSTEM_CAPABILITY.project_id","'-CapabilityId', SYSTEM_CAPABILITY.capability_id",
    "'-OperationId', args.operationId",'SYSTEM_OPERATION_ID_REQUIRED','getStableSystemOperationKey',
  ]) assert.ok(index.includes(token), `missing server capability token: ${token}`);
  for (const token of [
    'Assert-SystemCapabilityRequest','SYSTEM_CAPABILITY_PROJECT_DENY','SYSTEM_CAPABILITY_ID_DENY',
    'SYSTEM_CAPABILITY_CALLER_DENY','SYSTEM_OPERATION_REPLAY_DENY','Initialize-OperationReplayIndex',
    'system_capability_project_id','system_capability_id','system_capability_trusted_caller_sid',
  ]) assert.ok(broker.includes(token), `missing broker capability token: ${token}`);
  assert.ok(wrapper.includes("project_id = if ($Operation -eq 'powershell')"));
  assert.ok(wrapper.includes("capability_id = if ($Operation -eq 'powershell')"));
  assert.ok(wrapper.includes("operation_id = if ($Operation -eq 'powershell') { $OperationId }"));
  assert.ok(operationIdentity.includes("createHash('sha256')"));
  assert.ok(callerIdentity.includes('GetOwner([Security.Principal.SecurityIdentifier])'));
  const names = [...index.matchAll(/server\.registerTool\(\s*\n\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ['factory_status','host_powershell','worker_prepare','worker_start']);
});


test('broker error mapping returns safeMessage instead of dereferencing switch string', () => {
  for (const token of [
    "'^POWERSHELL_' { $safeMessage; break }",
    "'^SYSTEM_CAPABILITY_' { $safeMessage; break }",
    "'^REQUEST_' { $safeMessage; break }",
  ]) assert.ok(broker.includes(token), `missing safe broker error mapping: ${token}`);
  assert.equal(broker.includes("'^SYSTEM_CAPABILITY_' { $_.Exception.Message; break }"), false);
});


test('SYSTEM host transport removes mutable-Mission locks but requires stable caller and operation identity', () => {
  assert.equal(index.includes('authorizeSystemExecution'), false);
  const hostTransportSource = index.slice(index.indexOf('async function runHostGuard'), index.indexOf('function textResult'));
  assert.equal(hostTransportSource.includes('args.executionFence'), false);
  assert.equal(index.includes("SYSTEM_CAPABILITY.mission_revision !== '20260919T010100+0800'"), false);
  assert.equal(index.includes("SYSTEM_CAPABILITY.capability_generation !== 4"), false);
  assert.equal(wrapper.includes('SYSTEM_EXECUTION_FENCE_REQUIRED'), false);
  assert.equal(broker.includes('. $systemFenceHelperPath'), false);
  assert.equal(broker.includes('Assert-PTYSDCurrentSystemExecutionFence -Request $Request -SystemCapability $systemCapability'), false);
  assert.equal(broker.includes("$systemCapability.mission_revision -ne '20260919T010100+0800'"), false);
  assert.equal(broker.includes('[int64]$systemCapability.capability_generation -ne 4'), false);
  assert.ok(index.includes('SYSTEM_CAPABILITY_TIMEOUT_DENY'));
  assert.ok(index.includes("SYSTEM_CAPABILITY.trusted_caller_sid !== 'S-1-5-20'"));
  assert.ok(broker.includes('Assert-PTYSDTrustedRequestOwner'));
  assert.ok(broker.includes('Get-PTYSDSystemOperationKey'));
  assert.ok(broker.includes('operation_key=$OperationKey'));
  assert.ok(broker.includes('trusted_caller_sid=$TrustedCallerSid'));
  assert.ok(broker.includes('$script:consumedOperationKeys[$OperationKey] = $receiptPath'));
  assert.ok(broker.includes('POWERSHELL_CAPACITY_EXHAUSTED'));
  assert.ok(broker.includes('POWERSHELL_RUN_BUSY'));
  assert.ok(broker.includes("side_effect_state='UNKNOWN_AFTER_TIMEOUT'"));
  assert.ok(broker.includes("host_powershell_authority_mode = 'PERSISTENT_HUMAN_AUTHORIZED_PREPRODUCTION'"));
  assert.ok(broker.includes('mission_execution_fence_required = $false'));
  assert.equal(index.includes("attemptEpoch: z.number().int().min(1).max(2147483647)"), true);
  const start = broker.slice(broker.indexOf('function Start-BrokerPowerShell'), broker.indexOf('function Complete-OnePowerShellJob'));
  assert.ok(start.indexOf('POWERSHELL_CAPACITY_EXHAUSTED') < start.indexOf('Write-AtomicJson -Path $receiptPath'));
  assert.ok(start.indexOf('Write-AtomicJson -Path $receiptPath') < start.indexOf('Start-Job'));
});

test('mutable run/task labels are audit-only while fixed project/capability and trusted caller remain enforced', () => {
  assert.equal(capability.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.equal(capability.capability_id, 'CAP-GOV-SYSTEM-V1');
  assert.equal(capability.allowed_run_id_patterns, undefined);
  assert.equal(capability.allowed_task_id_patterns, undefined);
  assert.equal(capability.mission_revision, undefined);
  assert.equal(capability.mission_hash, undefined);
  assert.ok(broker.includes("[string]$Request.project_id -cne [string]$systemCapability.project_id"));
  assert.ok(broker.includes("[string]$Request.capability_id -cne [string]$systemCapability.capability_id"));
  assert.ok(broker.includes("$CallerSid -cne [string]$systemCapability.trusted_caller_sid"));
});
