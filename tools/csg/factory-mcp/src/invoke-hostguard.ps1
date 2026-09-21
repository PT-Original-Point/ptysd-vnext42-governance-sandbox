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
if ($Operation -ne 'status' -and (-not $RunId -or -not $TaskId -or -not $AttemptId)) {
  throw 'REQUIRED_ID_MISSING'
}
if ($Operation -eq 'powershell' -and -not $ScriptBase64) {
  throw 'POWERSHELL_SCRIPT_REQUIRED'
}

$requestId = [Guid]::NewGuid().ToString('N')
$request = [ordered]@{
  schema = 'v48.factory-mcp.hostguard.request.v2'
  request_id = $requestId
  operation = $Operation
  probe = if ($Operation -eq 'status') { $Probe } else { $null }
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
if ($response.schema -ne 'v48.factory-mcp.hostguard.response.v2') { throw 'BROKER_RESPONSE_SCHEMA_INVALID' }
if ($response.request_id -ne $requestId) { throw 'BROKER_RESPONSE_ID_MISMATCH' }
if (-not $response.ok) { throw ('BROKER_' + [string]$response.error_code) }
$response.result | ConvertTo-Json -Depth 10 -Compress
