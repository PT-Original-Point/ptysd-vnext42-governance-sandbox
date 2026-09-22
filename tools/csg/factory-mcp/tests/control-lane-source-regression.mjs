import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const broker = fs.readFileSync(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
const wrapper = fs.readFileSync(new URL('../src/invoke-hostguard.ps1', import.meta.url), 'utf8');
const capability = JSON.parse(fs.readFileSync(new URL('../config/system-capability.json', import.meta.url), 'utf8'));
const serverFence = fs.readFileSync(new URL('../src/current-execution-fence.mjs', import.meta.url), 'utf8');
const brokerFence = fs.readFileSync(new URL('../broker/current-execution-fence.ps1', import.meta.url), 'utf8');
const operationClaim = fs.readFileSync(new URL('../broker/operation-claim.ps1', import.meta.url), 'utf8');
const brokerTrustedCaller = fs.readFileSync(new URL('../broker/trusted-caller.ps1', import.meta.url), 'utf8');

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
  assert.ok(wrapper.includes("project_id = if ($mutation)"));
  assert.ok(wrapper.includes("capability_id = if ($mutation)"));
  assert.ok(wrapper.includes("schema = 'v49.factory-mcp.hostguard.request.v3'"));
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
    'runAuthorizedMutation',
    "'-OperationId', fence.operation_id",
    "'-ControlOid', args.executionFence.control_oid",
    "'-CheckpointDigest', args.executionFence.checkpoint_digest",
    "'-AuthorizationEnvelopeDigest', fence.authorization_envelope_digest",
    "'-AuthorizationGeneration', String(fence.authorization_generation)",
    "'-AuthorizationStateDigest', fence.authorization_state_digest",
    "'-RequestId', args.requestId",
    "'-CapabilityGeneration', String(fence.capability_generation)",
  ]) assert.ok(index.includes(token), `missing server fence token: ${token}`);
  for (const token of [
    'git.exe','ls-remote','refs/heads/v45/factory-control',
    'SYSTEM_FENCE_CONTROL_DRIFT','SYSTEM_FENCE_EPOCH_MISMATCH',
    'SYSTEM_FENCE_AUTHORIZATION_MISMATCH','SYSTEM_FENCE_SCRIPT_MISMATCH','SYSTEM_FENCE_PAYLOAD_MISMATCH',
    'authorization_generation','authorization_state_digest','capability_generation','execution_fence',
  ]) assert.ok(serverFence.includes(token), `missing server current-fence token: ${token}`);
  for (const token of [
    'Get-PTYSDCurrentSystemExecutionFence','Assert-PTYSDCurrentSystemExecutionFence',
    'SYSTEM_FENCE_CONTROL_DRIFT','SYSTEM_FENCE_EPOCH_MISMATCH',
    'SYSTEM_FENCE_AUTHORIZATION_MISMATCH','SYSTEM_FENCE_SCRIPT_MISMATCH','SYSTEM_FENCE_PAYLOAD_MISMATCH',
    'authorization_generation','authorization_state_digest','capability_generation','execution_fence',
  ]) assert.ok(brokerFence.includes(token), `missing broker current-fence token: ${token}`);
  assert.ok(broker.includes('. $systemFenceHelperPath'));
  assert.ok(broker.includes('Assert-PTYSDCurrentSystemExecutionFence -Request $Request -SystemCapability $systemCapability'));
  assert.equal(index.includes("attemptEpoch: z.number().int().min(1).max(2147483647)"), true);
});


test('every mutating Factory route requires trusted caller and current execution fence', () => {
  for (const call of [
    "runAuthorizedMutation('prepare'",
    "runAuthorizedMutation('start'",
    "runAuthorizedMutation('powershell'",
  ]) assert.ok(index.includes(call), `missing gated mutation route: ${call}`);
  for (const token of [
    'TRUSTED_CALLER_REQUIRED',
    'TRUSTED_CALLER_PROJECT_DENY',
    'TRUSTED_CALLER_DEDICATED_PROJECT_BINDING_REQUIRED',
    'TRUSTED_CALLER_TRANSPORT_REQUIRED',
    "transportKind !== 'https-mtls'",
  ]) assert.ok(index.includes(token), `missing trusted-caller gate: ${token}`);
  assert.ok(broker.includes("if ($req.operation -ne 'status')"));
  assert.ok(broker.includes('Assert-SystemCapabilityRequest -Request $req'));
});

test('broker performs durable one-shot CAS before every mutation', () => {
  for (const token of [
    "$operationClaims = Join-Path $state 'operation-claims'",
    "$operationClaimHelperPath = Join-Path $root 'broker\\operation-claim.ps1'",
    '. $operationClaimHelperPath',
    'Acquire-PTYSDOperationDispatchClaim -Request $req -RequestId $requestId -ClaimsRoot $operationClaims',
    'OPERATION_ALREADY_DISPATCHED',
  ]) assert.ok(broker.includes(token), `missing broker one-shot consume token: ${token}`);
  for (const token of [
    '[IO.FileMode]::CreateNew',
    '[IO.FileShare]::None',
    '$stream.Flush($true)',
    'OPERATION_ALREADY_DISPATCHED',
    'authorization_generation',
    'operation_id',
    'attempt_epoch',
  ]) assert.ok(operationClaim.includes(token), `missing durable claim primitive token: ${token}`);
  const authIndex=broker.indexOf('Assert-SystemCapabilityRequest -Request $req');
  const claimIndex=broker.indexOf('Acquire-PTYSDOperationDispatchClaim -Request $req -RequestId $requestId -ClaimsRoot $operationClaims');
  const switchIndex=broker.indexOf("switch ([string]$req.operation)");
  assert.ok(authIndex >= 0 && claimIndex > authIndex && switchIndex > claimIndex, 'authorization and durable consume must happen before side-effect dispatch');
});

test('trusted caller attestation is request-bound and dedicated-tunnel scoped', () => {
  const trusted = fs.readFileSync(new URL('../src/trusted-caller.mjs', import.meta.url), 'utf8');
  const brokerTrusted = fs.readFileSync(new URL('../broker/trusted-caller.ps1', import.meta.url), 'utf8');
  for (const token of ['request_id','authorization_generation','authorization_state_digest','PROJECT_DEDICATED_TUNNEL','PER_PROJECT_DEDICATED_TUNNEL','tunnel_binding_id']) {
    assert.ok(trusted.includes(token), `missing caller attestation token: ${token}`);
  }
  for (const token of ['TRUSTED_CALLER_REQUEST_ID_MISMATCH','TRUSTED_CALLER_AUTH_GENERATION_MISMATCH','TRUSTED_CALLER_AUTH_STATE_MISMATCH','PROJECT_DEDICATED_TUNNEL','tunnel_binding_id']) {
    assert.ok(brokerTrusted.includes(token), `missing broker trusted-caller token: ${token}`);
  }
});


test('P5 parallel staging can isolate broker paths, mutex, tunnel status and trust secrets while P4 defaults remain unchanged', () => {
  for (const token of [
    "PTYSD_FACTORY_MCP_QUEUE_ROOT",
    "C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\queue",
  ]) assert.ok(wrapper.includes(token), `missing wrapper staging token: ${token}`);
  for (const token of [
    "PTYSD_FACTORY_MCP_ROOT",
    "PTYSD_FACTORY_MCP_TUNNEL_TASK_NAME",
    "PTYSD_FACTORY_MCP_TUNNEL_HEALTH_URL_FILE",
    "PTYSD_FACTORY_MCP_BROKER_MUTEX",
    "C:\\ProgramData\\PTYSD\\MCP",
    "PTYSD-FactoryMCP-Tunnel-V47",
    "Global\\PTYSDFactoryMCPHostGuardBrokerV47",
    "New-Object Threading.Mutex($true, $brokerMutexName",
  ]) assert.ok(broker.includes(token), `missing broker staging token: ${token}`);
  for (const token of [
    "PTYSD_FACTORY_MCP_TRUSTED_CALLERS",
    "PTYSD_FACTORY_MCP_ATTESTATION_KEYRING",
    "C:\\ProgramData\\PTYSD\\MCP\\config\\trusted-callers.json",
    "C:\\ProgramData\\PTYSD\\MCP\\secrets\\broker-caller-attestation-keyring.json",
  ]) assert.ok(brokerTrustedCaller.includes(token), `missing trust-path staging token: ${token}`);
});
