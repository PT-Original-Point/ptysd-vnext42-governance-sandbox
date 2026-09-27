import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectOrphanStatusView } from '../src/orphan-status.mjs';

const broker = fs.readFileSync(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
const wrapper = fs.readFileSync(new URL('../src/invoke-hostguard.ps1', import.meta.url), 'utf8');
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
    'checkpoint_digest','control_oid','error_code','finished_at_utc','operation_id','project_id','receipt_digest',
    'request_id','run_id','side_effect_state','started_at_utc','state','task_id','timeout_seconds',
  ].sort());
  assert.equal(projected.orphan_records[0].state, 'ORPHANED');
  assert.equal(projected.orphan_records[0].stdout, undefined);
  assert.equal(projected.orphan_records[0].stderr, undefined);
  assert.equal(projected.orphan_records[0].script, undefined);
  assert.equal(projected.orphan_records[0].receipt_path, undefined);
  assert.equal(projected.orphan_records[1].request_id, null);
});

test('PowerShell orphan receipt status projects a bounded reconciliation snapshot', () => {
  const start = broker.indexOf('function Get-ReceiptFileSha256 {');
  const end = broker.indexOf('\nfunction Reconcile-OrphanedStartedReceipts {', start);
  assert.ok(start >= 0 && end > start, 'missing bounded orphan view and digest functions');
  const reader = broker.slice(start, end);
  for (const token of [
    '[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete','ComputeHash($bytes)','ConvertFrom-Json','function Read-ReceiptSnapshot {','function ConvertTo-OrphanReceiptStatusRecord {','function Get-OrphanReceiptStatusView {','ORPHANED','$maxOrphanStatusRecords','$maxOrphanStatusBytes',
    'request_id','project_id','run_id','task_id','attempt_id','attempt_epoch','control_oid',
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
  for (const token of [
    'SYSTEM_CAPABILITY_PATH','assertSystemCapabilityArgs',
    "'-ProjectId', SYSTEM_CAPABILITY.project_id","'-CapabilityId', SYSTEM_CAPABILITY.capability_id",
    'SYSTEM_CAPABILITY_RUN_DENY','SYSTEM_CAPABILITY_TASK_DENY',
  ]) assert.ok(index.includes(token), `missing server capability token: ${token}`);
  for (const token of [
    'Assert-SystemCapabilityRequest','SYSTEM_CAPABILITY_PROJECT_DENY','SYSTEM_CAPABILITY_ID_DENY',
    'SYSTEM_CAPABILITY_RUN_DENY','SYSTEM_CAPABILITY_TASK_DENY','system_capability_project_id','system_capability_id',
  ]) assert.ok(broker.includes(token), `missing broker capability token: ${token}`);
  assert.ok(wrapper.includes("project_id = if ($Operation -eq 'powershell')"));
  assert.ok(wrapper.includes("capability_id = if ($Operation -eq 'powershell')"));
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


test('SYSTEM dispatch is fenced to canonical current attempt at server and broker', () => {
  assert.equal(capability.capability_generation, 4);
  assert.equal(capability.mission_revision, '20260919T010100+0800');
  assert.match(capability.mission_hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(capability.authorization_envelope_digest, /^sha256:[0-9a-f]{64}$/);
  for (const token of [
    'authorizeSystemExecution',
    "'-OperationId', args.executionFence.execution_fence.operation_id",
    "'-ControlOid', args.executionFence.control_oid",
    "'-CheckpointDigest', args.executionFence.checkpoint_digest",
    "'-AuthorizationEnvelopeDigest', args.executionFence.execution_fence.authorization_envelope_digest",
    "'-CapabilityGeneration', String(args.executionFence.execution_fence.capability_generation)",
  ]) assert.ok(index.includes(token), `missing server fence token: ${token}`);
  for (const token of [
    'git.exe','ls-remote','refs/heads/v45/factory-control',
    'SYSTEM_FENCE_CONTROL_DRIFT','SYSTEM_FENCE_EPOCH_MISMATCH',
    'SYSTEM_FENCE_AUTHORIZATION_MISMATCH','SYSTEM_FENCE_SCRIPT_MISMATCH',
    'capability_generation','execution_fence',
  ]) assert.ok(serverFence.includes(token), `missing server current-fence token: ${token}`);
  for (const token of [
    'Get-PTYSDCurrentSystemExecutionFence','Assert-PTYSDCurrentSystemExecutionFence',
    'SYSTEM_FENCE_CONTROL_DRIFT','SYSTEM_FENCE_EPOCH_MISMATCH',
    'SYSTEM_FENCE_AUTHORIZATION_MISMATCH','SYSTEM_FENCE_SCRIPT_MISMATCH',
    'capability_generation','execution_fence',
  ]) assert.ok(brokerFence.includes(token), `missing broker current-fence token: ${token}`);
  assert.ok(broker.includes('. $systemFenceHelperPath'));
  assert.ok(broker.includes('Assert-PTYSDCurrentSystemExecutionFence -Request $Request -SystemCapability $systemCapability'));
  assert.equal(index.includes("attemptEpoch: z.number().int().min(1).max(2147483647)"), true);
});
