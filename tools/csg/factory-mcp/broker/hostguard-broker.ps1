[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\PTYSD\MCP\FactoryMCP'
$queue = Join-Path $root 'queue'
$inbox = Join-Path $queue 'inbox'
$processing = Join-Path $queue 'processing'
$outbox = Join-Path $queue 'outbox'
$state = Join-Path $root 'state'
$health = Join-Path $state 'broker-health.json'
$modulePath = 'C:\Program Files\WindowsPowerShell\Modules\PTYSD.HostGuard\PTYSD.HostGuard.psd1'
$idPattern = '^[A-Z0-9][A-Z0-9._-]{0,79}$'

foreach ($path in @($inbox,$processing,$outbox,$state)) {
  if (-not (Test-Path -LiteralPath $path)) { throw ('BROKER_PATH_MISSING:' + $path) }
}
if (-not (Test-Path -LiteralPath $modulePath)) { throw 'HOSTGUARD_MODULE_MISSING' }
Import-Module $modulePath -Force -ErrorAction Stop

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, 'Global\PTYSDFactoryMCPHostGuardBrokerV47', [ref]$createdNew)
if (-not $createdNew) { throw 'BROKER_ALREADY_RUNNING' }

function Write-AtomicJson {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$Value)
  $tmp = $Path + '.tmp.' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp, ($Value | ConvertTo-Json -Depth 10 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Write-Health {
  $payload = [ordered]@{
    schema = 'v47.factory-mcp.broker.health.v1'
    status = 'READY'
    pid = $PID
    host = $env:COMPUTERNAME
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  Write-AtomicJson -Path $health -Value $payload
}

function Test-Id([object]$Value) {
  return ($null -ne $Value -and [string]$Value -match $idPattern)
}

function Process-Request {
  param([Parameter(Mandatory)][IO.FileInfo]$File)
  $requestId = $File.BaseName
  $responsePath = Join-Path $outbox ($requestId + '.json')
  $response = [ordered]@{
    schema = 'v47.factory-mcp.hostguard.response.v1'
    request_id = $requestId
    ok = $false
    error_code = 'INVALID_REQUEST'
    result = $null
    brokered_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  try {
    if ($requestId -notmatch '^[0-9a-f]{32}$') { throw 'REQUEST_ID_INVALID' }
    if ($File.Length -gt 16384) { throw 'REQUEST_TOO_LARGE' }
    $req = Get-Content -LiteralPath $File.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($req.schema -ne 'v47.factory-mcp.hostguard.request.v1') { throw 'REQUEST_SCHEMA_INVALID' }
    if ($req.request_id -ne $requestId) { throw 'REQUEST_ID_MISMATCH' }
    if ($req.operation -notin @('status','prepare','start')) { throw 'OPERATION_INVALID' }
    if ([int64]$req.attempt_epoch -lt 1 -or [int64]$req.attempt_epoch -gt 2147483647) { throw 'ATTEMPT_EPOCH_INVALID' }
    if ($req.operation -ne 'status') {
      if (-not (Test-Id $req.run_id) -or -not (Test-Id $req.task_id) -or -not (Test-Id $req.attempt_id)) { throw 'ID_INVALID' }
    }
    switch ([string]$req.operation) {
      'status' {
        $result = Get-PTYSDHostGuardStatus
      }
      'prepare' {
        $result = Invoke-PTYSDHostPrepare -RunId ([string]$req.run_id) -TaskId ([string]$req.task_id) -AttemptId ([string]$req.attempt_id) -AttemptEpoch ([int]$req.attempt_epoch)
      }
      'start' {
        $result = Start-PTYSDWorkerVm -RunId ([string]$req.run_id) -TaskId ([string]$req.task_id) -AttemptId ([string]$req.attempt_id) -AttemptEpoch ([int]$req.attempt_epoch)
      }
    }
    $response.ok = $true
    $response.error_code = $null
    $response.result = $result
  } catch {
    $response.ok = $false
    $response.result = $null
    $response.error_code = switch -Regex ($_.Exception.Message) {
      '^HOST_ID_MISMATCH' { 'HOST_ID_MISMATCH'; break }
      '^VM_ID_MISMATCH' { 'VM_ID_MISMATCH'; break }
      '^VM_STATE_NOT_STARTABLE' { 'VM_STATE_NOT_STARTABLE'; break }
      '^VM_START_READBACK_FAILED' { 'VM_START_READBACK_FAILED'; break }
      '^RECEIPT_ID_INVALID' { 'RECEIPT_ID_INVALID'; break }
      '^ATTEMPT_EPOCH_INVALID' { 'ATTEMPT_EPOCH_INVALID'; break }
      default { 'REQUEST_REJECTED' }
    }
  }
  Write-AtomicJson -Path $responsePath -Value $response
}

try {
  Write-Health
  $lastHealth = [DateTime]::UtcNow
  while ($true) {
    $files = @(Get-ChildItem -LiteralPath $inbox -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object CreationTimeUtc | Select-Object -First 16)
    foreach ($file in $files) {
      $claimed = Join-Path $processing $file.Name
      try {
        Move-Item -LiteralPath $file.FullName -Destination $claimed -ErrorAction Stop
        $claimedFile = Get-Item -LiteralPath $claimed
        Process-Request -File $claimedFile
      } catch {
        # A competing claimant or malformed request is isolated to this file.
      } finally {
        Remove-Item -LiteralPath $claimed -Force -ErrorAction SilentlyContinue
      }
    }
    if (([DateTime]::UtcNow - $lastHealth).TotalSeconds -ge 5) {
      Write-Health
      $lastHealth = [DateTime]::UtcNow
    }
    Start-Sleep -Milliseconds 200
  }
} finally {
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
