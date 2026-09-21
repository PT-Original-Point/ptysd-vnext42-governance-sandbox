[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$helper = Join-Path (Split-Path $PSScriptRoot -Parent) 'broker\operation-claim.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw 'OPERATION_CLAIM_HELPER_MISSING' }
. $helper

function New-TestRequest {
  param(
    [string]$OperationId = 'P5-EXACTLY-ONCE-TEST-001',
    [int]$AttemptEpoch = 7,
    [int]$AuthorizationGeneration = 3
  )
  return [pscustomobject]@{
    project_id = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE'
    run_id = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-P5'
    task_id = 'GOV-HARDENING-P5'
    attempt_id = 'GOV-HARDENING-P5-ATTEMPT-TEST'
    attempt_epoch = $AttemptEpoch
    authorization_generation = $AuthorizationGeneration
    operation_id = $OperationId
  }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('ptysd-operation-claim-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $req = New-TestRequest
  $first = Acquire-PTYSDOperationDispatchClaim -Request $req -RequestId ('11' * 16) -ClaimsRoot $root
  if (-not (Test-Path -LiteralPath $first.path)) { throw 'FIRST_CLAIM_FILE_MISSING' }
  $saved = Get-Content -LiteralPath $first.path -Raw | ConvertFrom-Json -ErrorAction Stop
  if ([string]$saved.operation_id -ne [string]$req.operation_id) { throw 'FIRST_CLAIM_OPERATION_MISMATCH' }
  if ([int64]$saved.authorization_generation -ne [int64]$req.authorization_generation) { throw 'FIRST_CLAIM_AUTH_GENERATION_MISMATCH' }

  $duplicateDenied = $false
  try {
    [void](Acquire-PTYSDOperationDispatchClaim -Request $req -RequestId ('22' * 16) -ClaimsRoot $root)
  } catch {
    if ([string]$_.Exception.Message -ne 'OPERATION_ALREADY_DISPATCHED') { throw }
    $duplicateDenied = $true
  }
  if (-not $duplicateDenied) { throw 'SEQUENTIAL_DUPLICATE_WAS_NOT_DENIED' }

  $restartJob = Start-Job -ScriptBlock {
    param($Helper,$ClaimsRoot,$Request)
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    . $Helper
    try {
      [void](Acquire-PTYSDOperationDispatchClaim -Request $Request -RequestId ('33' * 16) -ClaimsRoot $ClaimsRoot)
      'CLAIMED'
    } catch {
      [string]$_.Exception.Message
    }
  } -ArgumentList $helper,$root,$req
  Wait-Job -Job $restartJob | Out-Null
  $restartResult = [string](Receive-Job -Job $restartJob)
  Remove-Job -Job $restartJob -Force -ErrorAction SilentlyContinue
  if ($restartResult -ne 'OPERATION_ALREADY_DISPATCHED') { throw ('RESTART_DUPLICATE_NOT_DENIED:' + $restartResult) }

  $differentOperation = New-TestRequest -OperationId 'P5-EXACTLY-ONCE-TEST-002'
  [void](Acquire-PTYSDOperationDispatchClaim -Request $differentOperation -RequestId ('44' * 16) -ClaimsRoot $root)
  $differentEpoch = New-TestRequest -AttemptEpoch 8
  [void](Acquire-PTYSDOperationDispatchClaim -Request $differentEpoch -RequestId ('55' * 16) -ClaimsRoot $root)

  $raceRoot = Join-Path $root 'race'
  New-Item -ItemType Directory -Path $raceRoot -Force | Out-Null
  $raceRequest = New-TestRequest -OperationId 'P5-EXACTLY-ONCE-RACE-001' -AttemptEpoch 9
  $jobs = @(
    Start-Job -ScriptBlock {
      param($Helper,$ClaimsRoot,$Request,$RequestId)
      Set-StrictMode -Version Latest
      $ErrorActionPreference = 'Stop'
      . $Helper
      try {
        [void](Acquire-PTYSDOperationDispatchClaim -Request $Request -RequestId $RequestId -ClaimsRoot $ClaimsRoot)
        'CLAIMED'
      } catch {
        [string]$_.Exception.Message
      }
    } -ArgumentList $helper,$raceRoot,$raceRequest,('66' * 16),
    Start-Job -ScriptBlock {
      param($Helper,$ClaimsRoot,$Request,$RequestId)
      Set-StrictMode -Version Latest
      $ErrorActionPreference = 'Stop'
      . $Helper
      try {
        [void](Acquire-PTYSDOperationDispatchClaim -Request $Request -RequestId $RequestId -ClaimsRoot $ClaimsRoot)
        'CLAIMED'
      } catch {
        [string]$_.Exception.Message
      }
    } -ArgumentList $helper,$raceRoot,$raceRequest,('77' * 16)
  )
  $jobs | Wait-Job | Out-Null
  $raceResults = @($jobs | ForEach-Object { [string](Receive-Job -Job $_) })
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  if (@($raceResults | Where-Object { $_ -eq 'CLAIMED' }).Count -ne 1) { throw ('RACE_CLAIMED_COUNT_INVALID:' + ($raceResults -join ',')) }
  if (@($raceResults | Where-Object { $_ -eq 'OPERATION_ALREADY_DISPATCHED' }).Count -ne 1) { throw ('RACE_DENIED_COUNT_INVALID:' + ($raceResults -join ',')) }

  Write-Output 'OPERATION_CLAIM_WINDOWS_TEST=PASS'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
