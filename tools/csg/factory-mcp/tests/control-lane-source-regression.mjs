import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
