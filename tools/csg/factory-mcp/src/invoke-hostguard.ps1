[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('status','prepare','start','powershell')]
  [string]$Operation,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$RunId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$TaskId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$AttemptId,

  [ValidateRange(1,2147483647)]
  [int]$AttemptEpoch = 1,

  [ValidatePattern('^[A-Za-z0-9+/=]+$')]
  [string]$ScriptBase64,

  [ValidateRange(1,300)]
  [int]$TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$queueRoot = 'C:\ProgramData\PTYSD\MCP\FactoryMCP\queue'
$inbox = Join-Path $queueRoot 'inbox'
$outbox = Join-Path $queueRoot 'outbox'
$trustedTunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
. (Join-Path $PSScriptRoot '..\broker\trusted-caller-boundary.ps1')
$tunnelTaskSid = Get-FactoryScheduledTaskSid -TaskName $trustedTunnelTask
Assert-FactoryCurrentTunnelTaskContext -TaskSid $tunnelTaskSid
$projectScope = Read-FactoryProjectScope -TunnelTaskSid $tunnelTaskSid
$projectId = [string]$projectScope.project_id
$hostId = [string]$projectScope.host_id
if ($env:COMPUTERNAME -cne $hostId) { throw 'REQUEST_HOST_NOT_AUTHORIZED' }

if (-not (Test-Path -LiteralPath $inbox)) { throw 'BROKER_INBOX_MISSING' }
if (-not (Test-Path -LiteralPath $outbox)) { throw 'BROKER_OUTBOX_MISSING' }
if ($Operation -ne 'status' -and (-not $RunId -or -not $TaskId -or -not $AttemptId)) {
  throw 'REQUIRED_ID_MISSING'
}
if ($Operation -eq 'powershell' -and -not $ScriptBase64) {
  throw 'POWERSHELL_SCRIPT_REQUIRED'
}

function Get-FactoryRequestId {
  param(
    [Parameter(Mandatory)][ValidateSet('status','prepare','start','powershell')][string]$Operation,
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$HostId,
    [string]$RunId,
    [string]$TaskId,
    [string]$AttemptId,
    [ValidateRange(1,2147483647)][int]$AttemptEpoch = 1,
    [string]$ScriptBase64
  )
  if ($Operation -ne 'powershell') { return [Guid]::NewGuid().ToString('N') }
  if (-not $ScriptBase64 -or $ScriptBase64 -notmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'POWERSHELL_SCRIPT_BASE64_INVALID' }
  try { $scriptBytes = [Convert]::FromBase64String($ScriptBase64) } catch { throw 'POWERSHELL_SCRIPT_BASE64_INVALID' }
  $scriptShaProvider = [Security.Cryptography.SHA256]::Create()
  try { $scriptSha = ([BitConverter]::ToString($scriptShaProvider.ComputeHash($scriptBytes))).Replace('-','').ToLowerInvariant() }
  finally { $scriptShaProvider.Dispose() }
  $identity = @(
    'v48.factory-mcp.host-exec.idempotency.v1',
    $ProjectId,
    $HostId,
    $Operation,
    [string]$RunId,
    [string]$TaskId,
    [string]$AttemptId,
    [Convert]::ToString($AttemptEpoch,[Globalization.CultureInfo]::InvariantCulture),
    $scriptSha
  ) -join "`n"
  $identityBytes = (New-Object Text.UTF8Encoding($false)).GetBytes($identity)
  $identityShaProvider = [Security.Cryptography.SHA256]::Create()
  try { return (([BitConverter]::ToString($identityShaProvider.ComputeHash($identityBytes))).Replace('-','').ToLowerInvariant()).Substring(0,32) }
  finally { $identityShaProvider.Dispose() }
}

function Get-FactoryArtifactMetadata {
  param([Parameter(Mandatory)][object]$Result)
  $artifactPathProperty = $Result.PSObject.Properties['artifact_path']
  $artifactDigestProperty = $Result.PSObject.Properties['artifact_digest']
  $receiptPathProperty = $Result.PSObject.Properties['receipt_path']
  $receiptDigestProperty = $Result.PSObject.Properties['receipt_digest']
  $path = if ($null -ne $artifactPathProperty -and $artifactPathProperty.Value) {
    [string]$artifactPathProperty.Value
  } elseif ($null -ne $receiptPathProperty) {
    [string]$receiptPathProperty.Value
  } else { '' }
  $digest = if ($null -ne $artifactDigestProperty -and $artifactDigestProperty.Value) {
    [string]$artifactDigestProperty.Value
  } elseif ($null -ne $receiptDigestProperty) {
    [string]$receiptDigestProperty.Value
  } else { '' }
  return [pscustomobject]@{ path = $path; digest = $digest }
}

$requestId = Get-FactoryRequestId -Operation $Operation -ProjectId $projectId -HostId $hostId -RunId $RunId -TaskId $TaskId -AttemptId $AttemptId -AttemptEpoch $AttemptEpoch -ScriptBase64 $ScriptBase64
$request = [ordered]@{
  schema = 'v51.factory-mcp.hostguard.request.v3'
  request_id = $requestId
  project_id = $projectId
  host_id = $hostId
  execution_scope = 'PREPRODUCTION_REVERSIBLE'
  production_allowed = $false
  operation = $Operation
  run_id = if ($RunId) { $RunId } else { $null }
  task_id = if ($TaskId) { $TaskId } else { $null }
  attempt_id = if ($AttemptId) { $AttemptId } else { $null }
  attempt_epoch = $AttemptEpoch
  script_b64 = if ($Operation -eq 'powershell') { $ScriptBase64 } else { $null }
  timeout_seconds = if ($Operation -eq 'powershell') { $TimeoutSeconds } else { $null }
  requested_at_utc = [DateTime]::UtcNow.ToString('o')
}

$finalRequest = Join-Path $inbox ($requestId + '.json')
$tempRequest = $finalRequest + '.tmp'
$responsePath = Join-Path $outbox ($requestId + '.json')
[IO.File]::WriteAllText($tempRequest, ($request | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $tempRequest -Destination $finalRequest -Force

$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(45, $TimeoutSeconds + 15))
do {
  if (Test-Path -LiteralPath $responsePath) { break }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

if (-not (Test-Path -LiteralPath $responsePath)) { throw 'BROKER_RESPONSE_TIMEOUT' }
try {
  $response = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json -ErrorAction Stop
} finally {
  Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
}
if ($response.schema -ne 'v48.factory-mcp.hostguard.response.v2') { throw 'BROKER_RESPONSE_SCHEMA_INVALID' }
if ($response.request_id -ne $requestId) { throw 'BROKER_RESPONSE_ID_MISMATCH' }
if (-not $response.ok) {
  $effect = [string]$response.execution_effect
  $result = $response.result
  if ($Operation -eq 'powershell' -and $effect -in @('UNKNOWN_EFFECT_READBACK_REQUIRED','NO_NEW_EFFECT_RECEIPT_PRESENT') -and
      $null -ne $result -and [string]$result.request_id -ceq $requestId) {
    $artifactMetadata = Get-FactoryArtifactMetadata -Result $result
    $artifactPath = [string]$artifactMetadata.path
    $artifactDigest = [string]$artifactMetadata.digest
    $receiptRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $queueRoot -Parent) 'state\exec-receipts'))
    $artifactParent = if ($artifactPath) { [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($artifactPath)) } else { '' }
    $artifactName = if ($artifactPath) { [IO.Path]::GetFileName($artifactPath) } else { '' }
    if ([string]$result.effect_status -in @('PROCESS_COMPLETED_RECEIPT_DURABLE','UNKNOWN_EFFECT_READBACK_REQUIRED') -and
        $artifactDigest -cmatch '^sha256:[a-f0-9]{64}$' -and
        [string]::Equals($artifactParent,$receiptRoot,[StringComparison]::OrdinalIgnoreCase) -and
        $artifactName -cmatch ('^' + [regex]::Escape($requestId) + '(?:\.intent)?\.json$')) {
      $result | ConvertTo-Json -Depth 12 -Compress
      exit 0
    }
  }
  throw ('BROKER_' + [string]$response.error_code)
}
$response.result | ConvertTo-Json -Depth 10 -Compress
