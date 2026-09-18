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
$execTemp = Join-Path $state 'exec-temp'
$execReceipts = Join-Path $state 'exec-receipts'
$modulePath = 'C:\Program Files\WindowsPowerShell\Modules\PTYSD.HostGuard\PTYSD.HostGuard.psd1'
$idPattern = '^[A-Z0-9][A-Z0-9._-]{0,79}$'
$maxRequestBytes = 65536
$maxOutputBytes = 131072

foreach ($path in @($inbox,$processing,$outbox,$state)) {
  if (-not (Test-Path -LiteralPath $path)) { throw ('BROKER_PATH_MISSING:' + $path) }
}
foreach ($path in @($execTemp,$execReceipts)) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}
if (-not (Test-Path -LiteralPath $modulePath)) { throw 'HOSTGUARD_MODULE_MISSING' }
if (-not (Test-Path -LiteralPath $hostExecHelperPath)) { throw 'HOST_EXEC_HELPER_MISSING' }
Import-Module $modulePath -Force -ErrorAction Stop
. $hostExecHelperPath

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, 'Global\PTYSDFactoryMCPHostGuardBrokerV47', [ref]$createdNew)
if (-not $createdNew) { throw 'BROKER_ALREADY_RUNNING' }

function Write-AtomicJson {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$Value)
  $tmp = $Path + '.tmp.' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp, ($Value | ConvertTo-Json -Depth 12 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Write-Health {
  $payload = [ordered]@{
    schema = 'v48.factory-mcp.broker.health.v2'
    status = 'READY'
    pid = $PID
    host = $env:COMPUTERNAME
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    powershell_exec = $true
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  Write-AtomicJson -Path $health -Value $payload
}

function Test-Id([object]$Value) {
  return ($null -ne $Value -and [string]$Value -match $idPattern)
}

function Invoke-BrokerPowerShell {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)][string]$RequestId
  )

  if (-not (Test-Id $Request.run_id) -or -not (Test-Id $Request.task_id) -or -not (Test-Id $Request.attempt_id)) {
    throw 'ID_INVALID'
  }
  $timeout = [int]$Request.timeout_seconds
  if ($timeout -lt 1 -or $timeout -gt 300) { throw 'POWERSHELL_TIMEOUT_INVALID' }
  $scriptB64 = [string]$Request.script_b64
  if (-not $scriptB64 -or $scriptB64.Length -gt 50000 -or $scriptB64 -notmatch '^[A-Za-z0-9+/=]+$') {
    throw 'POWERSHELL_SCRIPT_B64_INVALID'
  }

  try {
    [byte[]]$scriptBytes = [Convert]::FromBase64String($scriptB64)
  } catch {
    throw 'POWERSHELL_SCRIPT_B64_INVALID'
  }
  if ($scriptBytes.Length -lt 1 -or $scriptBytes.Length -gt 32768) {
    throw 'POWERSHELL_SCRIPT_SIZE_INVALID'
  }

  $raw = Invoke-PTYSDHostPowerShellExec -ScriptBytes $scriptBytes -TimeoutSeconds $timeout -ExecTemp $execTemp -RequestId $RequestId -MaxOutputBytes $maxOutputBytes

  $receipt = [ordered]@{
    schema='v48.factory-mcp.host-exec.receipt.v2'
    request_id=$RequestId
    operation='powershell'
    run_id=[string]$Request.run_id
    task_id=[string]$Request.task_id
    attempt_id=[string]$Request.attempt_id
    attempt_epoch=[int]$Request.attempt_epoch
    run_as=[string]$raw.run_as
    executable=[string]$raw.executable
    script_sha256=[string]$raw.script_sha256
    timeout_seconds=[int]$raw.timeout_seconds
    exit_code=[int]$raw.exit_code
    timed_out=[bool]$raw.timed_out
    stdout_bytes=[int64]$raw.stdout_bytes
    stderr_bytes=[int64]$raw.stderr_bytes
    stdout_sha256=[string]$raw.stdout_sha256
    stderr_sha256=[string]$raw.stderr_sha256
    started_at_utc=[string]$raw.started_at_utc
    finished_at_utc=[string]$raw.finished_at_utc
  }
  $receiptPath = Join-Path $execReceipts ($RequestId + '.json')
  Write-AtomicJson -Path $receiptPath -Value $receipt

  return [ordered]@{
    schema='v48.factory-mcp.host-exec.result.v2'
    operation='powershell'
    result=if([bool]$raw.timed_out){'TIMED_OUT'}else{'COMPLETED'}
    request_id=$RequestId
    run_id=[string]$Request.run_id
    task_id=[string]$Request.task_id
    attempt_id=[string]$Request.attempt_id
    attempt_epoch=[int]$Request.attempt_epoch
    run_as=[string]$raw.run_as
    executable=[string]$raw.executable
    exit_code=[int]$raw.exit_code
    timed_out=[bool]$raw.timed_out
    stdout=[string]$raw.stdout
    stderr=[string]$raw.stderr
    stdout_bytes=[int64]$raw.stdout_bytes
    stderr_bytes=[int64]$raw.stderr_bytes
    stdout_truncated=[bool]$raw.stdout_truncated
    stderr_truncated=[bool]$raw.stderr_truncated
    script_sha256=[string]$raw.script_sha256
    receipt_path=$receiptPath
  }
}

function Process-Request {
  param([Parameter(Mandatory)][IO.FileInfo]$File)
  $requestId = $File.BaseName
  $responsePath = Join-Path $outbox ($requestId + '.json')
  $response = [ordered]@{
    schema = 'v48.factory-mcp.hostguard.response.v2'
    request_id = $requestId
    ok = $false
    error_code = 'INVALID_REQUEST'
    result = $null
    brokered_at_utc = [DateTime]::UtcNow.ToString('o')
  }

  try {
    if ($requestId -notmatch '^[0-9a-f]{32}$') { throw 'REQUEST_ID_INVALID' }
    if ($File.Length -gt $maxRequestBytes) { throw 'REQUEST_TOO_LARGE' }
    $req = Get-Content -LiteralPath $File.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($req.schema -ne 'v48.factory-mcp.hostguard.request.v2') { throw 'REQUEST_SCHEMA_INVALID' }
    if ($req.request_id -ne $requestId) { throw 'REQUEST_ID_MISMATCH' }
    if ($req.operation -notin @('status','prepare','start','powershell')) { throw 'OPERATION_INVALID' }
    if ([int64]$req.attempt_epoch -lt 0 -or [int64]$req.attempt_epoch -gt 2147483647) { throw 'ATTEMPT_EPOCH_INVALID' }
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
      'powershell' {
        $result = Invoke-BrokerPowerShell -Request $req -RequestId $requestId
      }
    }

    $response.ok = $true
    $response.error_code = $null
    $response.result = $result
  } catch {
    $response.ok = $false
    $response.result = $null
    $safeMessage = [string]$_.Exception.Message
    if ($safeMessage.Length -gt 512) { $safeMessage = $safeMessage.Substring(0,512) }
    $response.error_code = switch -Regex ($safeMessage) {
      '^HOST_ID_MISMATCH' { 'HOST_ID_MISMATCH'; break }
      '^VM_ID_MISMATCH' { 'VM_ID_MISMATCH'; break }
      '^VM_STATE_NOT_STARTABLE' { 'VM_STATE_NOT_STARTABLE'; break }
      '^VM_START_READBACK_FAILED' { 'VM_START_READBACK_FAILED'; break }
      '^RECEIPT_ID_INVALID' { 'RECEIPT_ID_INVALID'; break }
      '^ATTEMPT_EPOCH_INVALID' { 'ATTEMPT_EPOCH_INVALID'; break }
      '^POWERSHELL_' { $_.Exception.Message; break }
      '^REQUEST_' { $_.Exception.Message; break }
      '^OPERATION_INVALID' { 'OPERATION_INVALID'; break }
      '^ID_INVALID' { 'ID_INVALID'; break }
      default { 'REQUEST_REJECTED' }
    }
    $diagnostic = [ordered]@{
      schema='v48.factory-mcp.broker.error.v1'
      request_id=$requestId
      operation=if($req -and $req.operation){[string]$req.operation}else{'UNKNOWN'}
      error_code=[string]$response.error_code
      exception_type=$_.Exception.GetType().FullName
      message=$safeMessage
      run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name
      recorded_at_utc=[DateTime]::UtcNow.ToString('o')
    }
    try { Write-AtomicJson -Path $lastError -Value $diagnostic } catch {}
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
