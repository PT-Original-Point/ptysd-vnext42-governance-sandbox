[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('status','prepare','start','powershell')]
  [string]$Operation,

  [ValidatePattern('^[a-z0-9_-]{1,64}$')]
  [string]$Probe = 'factory',

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$RunId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$TaskId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$AttemptId,

  [ValidateRange(1,2147483647)]
  [int]$AttemptEpoch = 1,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,127}$')]
  [string]$ProjectId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,127}$')]
  [string]$CapabilityId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,127}$')]
  [string]$OperationId,

  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ControlOid,

  [ValidatePattern('^sha256:[0-9a-f]{64}$')]
  [string]$CheckpointDigest,

  [ValidatePattern('^sha256:[0-9a-f]{64}$')]
  [string]$AuthorizationEnvelopeDigest,

  [ValidateRange(1,2147483647)]
  [int]$AuthorizationGeneration = 1,

  [ValidatePattern('^sha256:[0-9a-f]{64}$')]
  [string]$AuthorizationStateDigest,

  [ValidateRange(1,2147483647)]
  [int]$CapabilityGeneration = 1,

  [ValidatePattern('^[0-9a-f]{32}$')]
  [string]$RequestId,

  [ValidatePattern('^[A-Za-z0-9+/=]+$')]
  [string]$CallerAttestationBase64,

  [ValidatePattern('^[0-9a-f]{64}$')]
  [string]$CallerAttestationMac,

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

if (-not (Test-Path -LiteralPath $inbox)) { throw 'BROKER_INBOX_MISSING' }
if (-not (Test-Path -LiteralPath $outbox)) { throw 'BROKER_OUTBOX_MISSING' }

$mutation = ($Operation -ne 'status')
if ($mutation -and (-not $RunId -or -not $TaskId -or -not $AttemptId)) { throw 'REQUIRED_ID_MISSING' }
if ($mutation -and (-not $ProjectId -or -not $CapabilityId -or -not $OperationId -or -not $ControlOid -or -not $CheckpointDigest -or -not $AuthorizationEnvelopeDigest -or -not $AuthorizationStateDigest)) {
  throw 'SYSTEM_EXECUTION_FENCE_REQUIRED'
}
if ($mutation -and (-not $RequestId -or -not $CallerAttestationBase64 -or -not $CallerAttestationMac)) {
  throw 'TRUSTED_CALLER_ATTESTATION_REQUIRED'
}
if ($Operation -eq 'powershell' -and -not $ScriptBase64) { throw 'POWERSHELL_SCRIPT_REQUIRED' }

if (-not $RequestId) { $RequestId = [Guid]::NewGuid().ToString('N') }
$request = [ordered]@{
  schema = 'v49.factory-mcp.hostguard.request.v3'
  request_id = $RequestId
  operation = $Operation
  probe = if ($Operation -eq 'status') { $Probe } else { $null }
  run_id = if ($mutation) { $RunId } else { $null }
  task_id = if ($mutation) { $TaskId } else { $null }
  attempt_id = if ($mutation) { $AttemptId } else { $null }
  attempt_epoch = if ($mutation) { $AttemptEpoch } else { 1 }
  project_id = if ($mutation) { $ProjectId } else { $null }
  capability_id = if ($mutation) { $CapabilityId } else { $null }
  operation_id = if ($mutation) { $OperationId } else { $null }
  control_oid = if ($mutation) { $ControlOid } else { $null }
  checkpoint_digest = if ($mutation) { $CheckpointDigest } else { $null }
  authorization_envelope_digest = if ($mutation) { $AuthorizationEnvelopeDigest } else { $null }
  authorization_generation = if ($mutation) { $AuthorizationGeneration } else { $null }
  authorization_state_digest = if ($mutation) { $AuthorizationStateDigest } else { $null }
  capability_generation = if ($mutation) { $CapabilityGeneration } else { $null }
  caller_attestation_b64 = if ($mutation) { $CallerAttestationBase64 } else { $null }
  caller_attestation_mac = if ($mutation) { $CallerAttestationMac } else { $null }
  script_b64 = if ($Operation -eq 'powershell') { $ScriptBase64 } else { $null }
  timeout_seconds = if ($mutation) { $TimeoutSeconds } else { $null }
  requested_at_utc = [DateTime]::UtcNow.ToString('o')
}

$finalRequest = Join-Path $inbox ($RequestId + '.json')
$tempRequest = $finalRequest + '.tmp'
$responsePath = Join-Path $outbox ($RequestId + '.json')
[IO.File]::WriteAllText($tempRequest, ($request | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $tempRequest -Destination $finalRequest -Force

$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(45, $TimeoutSeconds + 20))
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
if ($response.schema -ne 'v49.factory-mcp.hostguard.response.v3') { throw 'BROKER_RESPONSE_SCHEMA_INVALID' }
if ($response.request_id -ne $RequestId) { throw 'BROKER_RESPONSE_ID_MISMATCH' }
if (-not $response.ok) { throw ('BROKER_' + [string]$response.error_code) }
$response.result | ConvertTo-Json -Depth 12 -Compress
