import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const brokerPath = resolve(packageRoot, 'broker/hostguard-broker.ps1');
const boundaryPath = resolve(packageRoot, 'broker/trusted-caller-boundary.ps1');
const helperPath = resolve(packageRoot, 'broker/host-powershell-exec.ps1');
const invokePath = resolve(packageRoot, 'src/invoke-hostguard.ps1');

function runPowerShell(runner, payload) {
  const input = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', runner], {
    input, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
}

test('broker suppresses exact request-id replay and retains unknown-effect readback metadata', { skip: process.platform !== 'win32' }, () => {
  const state = mkdtempSync(join(tmpdir(), 'factory-mcp-replay-'));
  try {
    const runner = String.raw`$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($bytes));
$helperPath=[string]$payload.helper_path; . $helperPath;
$boundaryPath=[string]$payload.boundary_path; . $boundaryPath;
$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile([string]$payload.broker_path,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){exit 2};
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FactoryRequestReplayState'},$true);if(-not $fn){exit 3};Invoke-Expression $fn.Extent.Text;
$requestId='0123456789abcdef0123456789abcdef';$receiptRoot=[string]$payload.receipt_root;$responsePath=[string]$payload.response_path;New-Item -ItemType Directory -Path $receiptRoot -Force | Out-Null;New-Item -ItemType Directory -Path (Split-Path $responsePath -Parent) -Force | Out-Null;
$fresh=Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $receiptRoot -ResponsePath $responsePath;
$intentPath=Join-Path $receiptRoot ($requestId+'.intent.json');$intent=[ordered]@{schema='v48.factory-mcp.host-exec.intent.v1';request_id=$requestId;operation='powershell';script_sha256=('a'*64)};[IO.File]::WriteAllText($intentPath,($intent|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)));
$intentState=Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $receiptRoot -ResponsePath $responsePath;Remove-Item -LiteralPath $intentPath -Force;
$receiptPath=Join-Path $receiptRoot ($requestId+'.json');$receipt=[ordered]@{schema='v48.factory-mcp.host-exec.receipt.v2';request_id=$requestId;effect_status='PROCESS_COMPLETED_RECEIPT_DURABLE'};[IO.File]::WriteAllText($receiptPath,($receipt|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)));
$receiptState=Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $receiptRoot -ResponsePath $responsePath;
$receipt.effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED';[IO.File]::WriteAllText($receiptPath,($receipt|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)));
$unknownReceiptState=Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $receiptRoot -ResponsePath $responsePath;
[IO.File]::WriteAllText($responsePath,'{}',(New-Object Text.UTF8Encoding($false)));$responseState=Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $receiptRoot -ResponsePath $responsePath;
$observations=@($fresh,$intentState,$receiptState,$unknownReceiptState,$responseState);[Console]::Out.Write(($observations|ConvertTo-Json -Depth 6 -Compress))`;
    const result = runPowerShell(runner, {
      broker_path: brokerPath,
      boundary_path: boundaryPath,
      helper_path: helperPath,
      receipt_root: join(state, 'receipts'),
      response_path: join(state, 'outbox', '0123456789abcdef0123456789abcdef.json'),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const observations = JSON.parse(result.stdout);
    assert.deepEqual(observations.map(item => item.state), ['NEW', 'INTENT_PRESENT', 'RECEIPT_PRESENT', 'RECEIPT_PRESENT', 'RESPONSE_PRESENT']);
    assert.match(observations[1].artifact_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(observations[2].effect_status, 'PROCESS_COMPLETED_RECEIPT_DURABLE');
    assert.equal(observations[3].effect_status, 'UNKNOWN_EFFECT_READBACK_REQUIRED');
    assert.match(observations[3].artifact_digest, /^sha256:[a-f0-9]{64}$/);
  } finally {
    rmSync(state, { recursive:true, force:true });
  }

  const broker = requireSource(brokerPath);
  const processStart = broker.indexOf('function Process-Request');
  const processEnd = broker.indexOf('\ntry {\n  Write-Health', processStart);
  const processBody = broker.slice(processStart, processEnd);
  const replayGuard = processBody.indexOf('Get-FactoryRequestReplayState -RequestId $requestId');
  const dispatch = processBody.indexOf('switch ([string]$req.operation)');
  assert.ok(replayGuard >= 0 && replayGuard < dispatch, 'replay readback must precede all operation dispatch');
  const invoke = requireSource(invokePath);
  assert.match(invoke, /UNKNOWN_EFFECT_READBACK_REQUIRED/);
  assert.match(invoke, /artifactDigest -cmatch '\^sha256:/);
  assert.match(invoke, /\$requestId = Get-FactoryRequestId/);
});

test('host PowerShell retries bind one stable request id to exact operation identity and script bytes', { skip: process.platform !== 'win32' }, () => {
  const runner = String.raw`$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($bytes));
$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile([string]$payload.invoke_path,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){exit 2};
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FactoryRequestId'},$true);if(-not $fn){exit 3};Invoke-Expression $fn.Extent.Text;
$scriptA=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('Write-Output one'))
$scriptB=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('Write-Output two'))
$common=@{Operation='powershell';ProjectId='CHATGPT_GLOBAL_SKILL_GOVERNANCE';HostId='FACTORY-HOST-01';RunId='RUN-001';TaskId='TASK-001';AttemptId='ATTEMPT-001';AttemptEpoch=1}
$first=Get-FactoryRequestId @common -ScriptBase64 $scriptA
$retry=Get-FactoryRequestId @common -ScriptBase64 $scriptA
$differentScript=Get-FactoryRequestId @common -ScriptBase64 $scriptB
$nextAttemptValues=@{Operation='powershell';ProjectId='CHATGPT_GLOBAL_SKILL_GOVERNANCE';HostId='FACTORY-HOST-01';RunId='RUN-001';TaskId='TASK-001';AttemptId='ATTEMPT-001';AttemptEpoch=2}
$nextAttempt=Get-FactoryRequestId @nextAttemptValues -ScriptBase64 $scriptA
[Console]::Out.Write(($first+','+$retry+','+$differentScript+','+$nextAttempt))`;
  const result = runPowerShell(runner, { invoke_path: invokePath });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [first, retry, differentScript, nextAttempt] = result.stdout.trim().split(',');
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(retry, first);
  assert.match(differentScript, /^[a-f0-9]{32}$/);
  assert.notEqual(differentScript, first);
  assert.match(nextAttempt, /^[a-f0-9]{32}$/);
  assert.notEqual(nextAttempt, first);
});

test('unknown-effect response metadata handles receipt and replay shapes under StrictModeLatest', { skip: process.platform !== 'win32' }, () => {
  const runner = String.raw`$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($bytes));
Set-StrictMode -Version Latest
$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile([string]$payload.invoke_path,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){exit 2};
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FactoryArtifactMetadata'},$true);if(-not $fn){exit 3};Invoke-Expression $fn.Extent.Text;
$id='0123456789abcdef0123456789abcdef';$root='C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts\';$digest='sha256:'+('a'*64)
$receiptShapes=@(
  [pscustomobject]@{result='TIMED_OUT';request_id=$id;receipt_path=($root+$id+'.json');receipt_digest=$digest;effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED'},
  [pscustomobject]@{result='CAPTURE_INCOMPLETE';request_id=$id;receipt_path=($root+$id+'.json');receipt_digest=$digest;effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED'},
  [pscustomobject]@{request_id=$id;artifact_path=($root+$id+'.intent.json');artifact_digest=$digest;effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED'}
)
$observations=@($receiptShapes|ForEach-Object {Get-FactoryArtifactMetadata -Result $_});[Console]::Out.Write(($observations|ConvertTo-Json -Depth 4 -Compress))`;
  const result = runPowerShell(runner, { invoke_path: invokePath });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const observations = JSON.parse(result.stdout);
  assert.deepEqual(observations.map(item => item.path), [
    'C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\state\\exec-receipts\\0123456789abcdef0123456789abcdef.json',
    'C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\state\\exec-receipts\\0123456789abcdef0123456789abcdef.json',
    'C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\state\\exec-receipts\\0123456789abcdef0123456789abcdef.intent.json',
  ]);
  assert.ok(observations.every(item => item.digest === 'sha256:' + 'a'.repeat(64)));
});

function requireSource(path) {
  return Buffer.from(readFileSync(path)).toString('utf8');
}
