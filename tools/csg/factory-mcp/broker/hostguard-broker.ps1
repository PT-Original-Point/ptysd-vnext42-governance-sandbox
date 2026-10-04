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
$hostExecHelperPath = Join-Path $PSScriptRoot 'host-powershell-exec.ps1'
$modulePath = 'C:\Program Files\WindowsPowerShell\Modules\PTYSD.HostGuard\PTYSD.HostGuard.psd1'
$idPattern = '^[A-Z0-9][A-Z0-9._-]{0,79}$'
$maxRequestBytes = 65536
$maxOutputBytes = 131072
$trustedTunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
. (Join-Path $PSScriptRoot 'trusted-caller-boundary.ps1')
$trustedTunnelTaskSid = Get-FactoryScheduledTaskSid -TaskName $trustedTunnelTask
$projectScope = Read-FactoryProjectScope -TunnelTaskSid $trustedTunnelTaskSid
$script:factoryTrustedCallerProjectId = [string]$projectScope.project_id
$script:factoryTrustedCallerHostId = [string]$projectScope.host_id
if ($env:COMPUTERNAME -cne $script:factoryTrustedCallerHostId) { throw 'REQUEST_HOST_NOT_AUTHORIZED' }
. (Join-Path $PSScriptRoot 'owner-liveness-publisher.ps1')
Set-OwnerLivenessProjectId -ProjectId $script:factoryTrustedCallerProjectId
$ownerLivenessTargetContextPath = Join-Path $state 'owner-liveness-target.json'
Set-OwnerLivenessTargetContextPath -Path $ownerLivenessTargetContextPath

Assert-FactoryQueueDirectoryAcl -Path $inbox -TaskSid $trustedTunnelTaskSid -Mode CALLER_MODIFY | Out-Null
Assert-FactoryQueueDirectoryAcl -Path $outbox -TaskSid $trustedTunnelTaskSid -Mode CALLER_MODIFY | Out-Null
Assert-FactoryQueueDirectoryAcl -Path $processing -TaskSid $trustedTunnelTaskSid -Mode SYSTEM_ONLY | Out-Null

foreach ($path in @($inbox,$processing,$outbox,$state)) {
  if (-not (Test-Path -LiteralPath $path)) { throw ('BROKER_PATH_MISSING:' + $path) }
}
if (-not (Test-Path -LiteralPath $modulePath)) { throw 'HOSTGUARD_MODULE_MISSING' }
if (-not (Test-Path -LiteralPath $hostExecHelperPath)) { throw 'HOST_EXEC_HELPER_MISSING' }
Import-Module $modulePath -Force -ErrorAction Stop
. $hostExecHelperPath
foreach ($path in @($execTemp,$execReceipts)) {
  if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, 'Global\PTYSDFactoryMCPHostGuardBrokerV47', [ref]$createdNew)
if (-not $createdNew) { throw 'BROKER_ALREADY_RUNNING' }

function Write-AtomicJson {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$Value)
  $tmp = $Path + '.tmp.' + [Guid]::NewGuid().ToString('N')
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress))
  $stream = [IO.FileStream]::new($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $stream.Write($bytes,0,$bytes.Length)
    # Durable to the volume before the atomic rename makes the file visible.
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  Move-Item -LiteralPath $tmp -Destination $Path -Force
  # Same-source exact-byte readback: the renamed file must equal the durable bytes.
  $readBack = [IO.File]::ReadAllBytes($Path)
  if ($readBack.Length -ne $bytes.Length) { throw 'ATOMIC_JSON_READBACK_LENGTH_MISMATCH' }
  for ($i = 0; $i -lt $bytes.Length; $i++) { if ($readBack[$i] -ne $bytes[$i]) { throw 'ATOMIC_JSON_READBACK_MISMATCH' } }
}

function Write-Health {
  $ownerLivenessPublisherStatus = 'PUBLISH_FAILED'
  try { $ownerLivenessPublisherStatus = Publish-OwnerLivenessSnapshot } catch {}
  $payload = [ordered]@{
    schema = 'v47.factory-mcp.broker.health.v1'
    status = (Get-OwnerLivenessBrokerHealthStatus -PublisherStatus $ownerLivenessPublisherStatus)
    pid = $PID
    host = $env:COMPUTERNAME
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
    owner_liveness_publisher_status = $ownerLivenessPublisherStatus
    powershell_exec = $true
    host_exec_helper_sha256 = (Get-FileHash -LiteralPath $hostExecHelperPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  Write-AtomicJson -Path $health -Value $payload
}

function Get-FactoryRequestReplayState {
  param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{32}$')][string]$RequestId,
    [Parameter(Mandatory)][string]$ReceiptRoot,
    [Parameter(Mandatory)][string]$ResponsePath
  )

  if (Test-Path -LiteralPath $ResponsePath -PathType Leaf) {
    return [ordered]@{ state='RESPONSE_PRESENT'; artifact_path=$ResponsePath; artifact_digest=$null; effect_status=$null }
  }
  foreach ($candidate in @(
    [ordered]@{ kind='RECEIPT'; path=(Join-Path $ReceiptRoot ($RequestId + '.json')) },
    [ordered]@{ kind='INTENT'; path=(Join-Path $ReceiptRoot ($RequestId + '.intent.json')) }
  )) {
    if (-not (Test-Path -LiteralPath $candidate.path)) { continue }
    try {
      $attributes = [IO.File]::GetAttributes($candidate.path)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
          ($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
        return [ordered]@{ state='ARTIFACT_INVALID'; artifact_path=[string]$candidate.path; artifact_digest=$null; effect_status=$null }
      }
      $info = New-Object IO.FileInfo($candidate.path)
      if ($info.Length -lt 2 -or $info.Length -gt 1048576) {
        return [ordered]@{ state='ARTIFACT_INVALID'; artifact_path=[string]$candidate.path; artifact_digest=$null; effect_status=$null }
      }
      $bytes = [IO.File]::ReadAllBytes($candidate.path)
      if ($bytes.Length -ne $info.Length) {
        return [ordered]@{ state='ARTIFACT_INVALID'; artifact_path=[string]$candidate.path; artifact_digest=$null; effect_status=$null }
      }
      $text = (New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)
      $value = ConvertFrom-FactoryCanonicalJson -JsonText $text -Depth 12
      $digest = 'sha256:' + (Get-PTYSDHostExecSha256Hex -Bytes $bytes)
      if ($candidate.kind -ceq 'RECEIPT') {
        if ([string]$value.schema -cne 'v48.factory-mcp.host-exec.receipt.v2' -or
            [string]$value.request_id -cne $RequestId -or
            [string]$value.effect_status -cnotin @('PROCESS_COMPLETED_RECEIPT_DURABLE','UNKNOWN_EFFECT_READBACK_REQUIRED')) {
          return [ordered]@{ state='ARTIFACT_INVALID'; artifact_path=[string]$candidate.path; artifact_digest=$digest; effect_status=$null }
        }
        return [ordered]@{ state='RECEIPT_PRESENT'; artifact_path=[string]$candidate.path; artifact_digest=$digest; effect_status=[string]$value.effect_status }
      }
      if ([string]$value.schema -cne 'v48.factory-mcp.host-exec.intent.v1' -or
          [string]$value.request_id -cne $RequestId -or [string]$value.operation -cne 'powershell' -or
          [string]$value.script_sha256 -cnotmatch '^[a-f0-9]{64}$') {
        return [ordered]@{ state='ARTIFACT_INVALID'; artifact_path=[string]$candidate.path; artifact_digest=$digest; effect_status=$null }
      }
      return [ordered]@{ state='INTENT_PRESENT'; artifact_path=[string]$candidate.path; artifact_digest=$digest; effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED' }
    } catch {
      return [ordered]@{ state='ARTIFACT_UNREADABLE'; artifact_path=[string]$candidate.path; artifact_digest=$null; effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED' }
    }
  }
  return [ordered]@{ state='NEW'; artifact_path=$null; artifact_digest=$null; effect_status=$null }
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

  $script:brokerPowerShellPhase = 'BEFORE_EFFECT'
  # Intent-before-effect: persist the request identity BEFORE any effect runs.
  $intentPath = Join-Path $execReceipts ($RequestId + '.intent.json')
  $intent = [ordered]@{
    schema='v48.factory-mcp.host-exec.intent.v1'
    request_id=$RequestId
    operation='powershell'
    run_id=[string]$Request.run_id
    task_id=[string]$Request.task_id
    attempt_id=[string]$Request.attempt_id
    attempt_epoch=[int]$Request.attempt_epoch
    timeout_seconds=[int]$Request.timeout_seconds
    script_sha256=(Get-PTYSDHostExecSha256Hex -Bytes $scriptBytes)
    requested_at_utc=[DateTime]::UtcNow.ToString('o')
  }
  try {
    Write-AtomicJson -Path $intentPath -Value $intent
  } catch {
    throw 'RECEIPT_INTENT_PERSISTENCE_FAILED'
  }
  $script:brokerPowerShellPhase = 'EFFECT_STARTED'
  try {
    $raw = Invoke-PTYSDHostPowerShellExec -ScriptBytes $scriptBytes -TimeoutSeconds $timeout -ExecTemp $execTemp -RequestId $RequestId -MaxOutputBytes $maxOutputBytes
  } catch {
    # Any helper failure after the bounded effect started cannot be proven
    # no-effect: durable intent is preserved and the effect is readback-required.
    throw ('POWERSHELL_UNKNOWN_EFFECT_READBACK_REQUIRED:' + $_.Exception.Message)
  }
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
    capture_outcome=[string]$raw.capture_outcome
    cleanup_effect=[string]$raw.cleanup_effect
    effect_status=if([bool]$raw.timed_out -or [string]$raw.capture_outcome -ne 'COMPLETED'){'UNKNOWN_EFFECT_READBACK_REQUIRED'}else{'PROCESS_COMPLETED_RECEIPT_DURABLE'}
    stdout_hash_scope=[string]$raw.stdout_hash_scope
    stderr_hash_scope=[string]$raw.stderr_hash_scope
    started_at_utc=[string]$raw.started_at_utc
    finished_at_utc=[string]$raw.finished_at_utc
  }
  $receiptPath = Join-Path $execReceipts ($RequestId + '.json')
  try {
    Write-AtomicJson -Path $receiptPath -Value $receipt
  } catch {
    # Effect may have completed but durable receipt acknowledgement failed:
    # the exact-source receipt state is unknown; never blind replay.
    throw 'RECEIPT_PERSISTENCE_UNKNOWN_EFFECT'
  }
  $receiptBytes = [IO.File]::ReadAllBytes($receiptPath)
  $receiptSha = [Security.Cryptography.SHA256]::Create()
  try { $receiptDigest = 'sha256:' + [BitConverter]::ToString($receiptSha.ComputeHash($receiptBytes)).Replace('-','').ToLowerInvariant() }
  finally { $receiptSha.Dispose() }
  try { Remove-Item -LiteralPath $intentPath -Force -ErrorAction Stop } catch {}

  return [ordered]@{
    schema='v48.factory-mcp.host-exec.result.v2'
    operation='powershell'
    result=if([bool]$raw.timed_out){'TIMED_OUT'}elseif([string]$raw.capture_outcome -ne 'COMPLETED'){'CAPTURE_INCOMPLETE'}else{'COMPLETED'}
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
    stdout_sha256=[string]$raw.stdout_sha256
    stderr_sha256=[string]$raw.stderr_sha256
    stdout_truncated=[bool]$raw.stdout_truncated
    stderr_truncated=[bool]$raw.stderr_truncated
    stdout_hash_scope=[string]$raw.stdout_hash_scope
    stderr_hash_scope=[string]$raw.stderr_hash_scope
    script_sha256=[string]$raw.script_sha256
    capture_outcome=[string]$raw.capture_outcome
    cleanup_effect=[string]$raw.cleanup_effect
    effect_status=[string]$receipt.effect_status
    receipt_digest=$receiptDigest
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
    execution_effect = 'NONE_OBSERVED'
    brokered_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  $script:brokerPowerShellPhase = 'NONE'
  try {
    if ($requestId -notmatch '^[0-9a-f]{32}$') { throw 'REQUEST_ID_INVALID' }
    $replay = Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $execReceipts -ResponsePath $responsePath
    if ($replay.state -eq 'RESPONSE_PRESENT') { return }
    if ($replay.state -ne 'NEW') {
      $hasReceipt = $replay.state -eq 'RECEIPT_PRESENT'
      $priorEffectUnknown = [string]$replay.effect_status -eq 'UNKNOWN_EFFECT_READBACK_REQUIRED'
      $response.ok = $false
      $response.error_code = if ($hasReceipt -and -not $priorEffectUnknown) { 'REQUEST_ID_REPLAY_RECEIPT_PRESENT' } else { 'UNKNOWN_EFFECT_READBACK_REQUIRED' }
      $response.execution_effect = if ($hasReceipt -and -not $priorEffectUnknown) { 'NO_NEW_EFFECT_RECEIPT_PRESENT' } else { 'UNKNOWN_EFFECT_READBACK_REQUIRED' }
      $response.result = [ordered]@{
        schema='v48.factory-mcp.host-exec.replay.v1'
        request_id=$requestId
        replay_state=[string]$replay.state
        effect_status=[string]$replay.effect_status
        artifact_path=$replay.artifact_path
        artifact_digest=$replay.artifact_digest
      }
      Write-AtomicJson -Path $responsePath -Value $response
      return
    }
    if ($File.Length -gt $maxRequestBytes) { throw 'REQUEST_TOO_LARGE' }
    $requestText = Get-Content -LiteralPath $File.FullName -Raw
    $req = ConvertFrom-FactoryCanonicalJson -JsonText $requestText -Depth 4
    if ($req.schema -ne 'v51.factory-mcp.hostguard.request.v3') { throw 'REQUEST_SCHEMA_INVALID' }
    Assert-FactoryRequestScope -Request $req -ExpectedProjectId $script:factoryTrustedCallerProjectId -ExpectedHostId $script:factoryTrustedCallerHostId
    if ($req.request_id -ne $requestId) { throw 'REQUEST_ID_MISMATCH' }
    if ($req.operation -notin @('status','prepare','start','powershell')) { throw 'OPERATION_INVALID' }
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
      'powershell' {
        $result = Invoke-BrokerPowerShell -Request $req -RequestId $requestId
      }
    }
    $response.result = $result
    if ($result -and $result.result -in @('TIMED_OUT','CAPTURE_INCOMPLETE')) {
      $response.ok = $false
      $response.error_code = 'UNKNOWN_EFFECT_READBACK_REQUIRED'
      $response.execution_effect = 'UNKNOWN_EFFECT_READBACK_REQUIRED'
    } else {
      $response.ok = $true
      $response.error_code = $null
      $response.execution_effect = 'REPORTED_WITH_RECEIPT'
    }
  } catch {
    $response.ok = $false
    $response.result = $null
    $effectPhase = if (Test-Path variable:script:brokerPowerShellPhase) { [string]$script:brokerPowerShellPhase } else { 'UNKNOWN' }
    $response.execution_effect = if ($_.Exception.Message -match '^RECEIPT_INTENT_') { 'NO_EFFECT_OR_RECEIPT_NOT_STARTED' } elseif ($_.Exception.Message -match '^RECEIPT_') { 'UNKNOWN_RECEIPT_STATE_AFTER_EFFECT' } elseif ($effectPhase -eq 'EFFECT_STARTED') { 'UNKNOWN_EFFECT_READBACK_REQUIRED' } else { 'NO_EFFECT_OR_RECEIPT_NOT_STARTED' }
    $response.error_code = switch -Regex ($_.Exception.Message) {
      '^HOST_ID_MISMATCH' { 'HOST_ID_MISMATCH'; break }
      '^VM_ID_MISMATCH' { 'VM_ID_MISMATCH'; break }
      '^VM_STATE_NOT_STARTABLE' { 'VM_STATE_NOT_STARTABLE'; break }
      '^VM_START_READBACK_FAILED' { 'VM_START_READBACK_FAILED'; break }
      '^RECEIPT_ID_INVALID' { 'RECEIPT_ID_INVALID'; break }
      '^ATTEMPT_EPOCH_INVALID' { 'ATTEMPT_EPOCH_INVALID'; break }
      '^POWERSHELL_UNKNOWN_EFFECT_READBACK_REQUIRED' { 'UNKNOWN_EFFECT_READBACK_REQUIRED'; break }
      '^POWERSHELL_' { $_.Exception.Message; break }
      '^REQUEST_' { $_.Exception.Message; break }
      '^OPERATION_INVALID' { 'OPERATION_INVALID'; break }
      '^PRODUCTION_SCOPE_DENIED' { 'PRODUCTION_SCOPE_DENIED'; break }
      '^ID_INVALID' { 'ID_INVALID'; break }
      '^RECEIPT_' { $_.Exception.Message; break }
      default { 'REQUEST_REJECTED' }
    }
    if ($response.execution_effect -in @('UNKNOWN_EFFECT_READBACK_REQUIRED','UNKNOWN_RECEIPT_STATE_AFTER_EFFECT') -and
        $requestId -match '^[0-9a-f]{32}$') {
      try {
        $artifact = Get-FactoryRequestReplayState -RequestId $requestId -ReceiptRoot $execReceipts -ResponsePath $responsePath
        if ($artifact.state -in @('RECEIPT_PRESENT','INTENT_PRESENT','ARTIFACT_INVALID','ARTIFACT_UNREADABLE')) {
          $response.result = [ordered]@{
            schema='v48.factory-mcp.host-exec.unknown-effect.v1'
            request_id=$requestId
            effect_status='UNKNOWN_EFFECT_READBACK_REQUIRED'
            artifact_path=$artifact.artifact_path
            artifact_digest=$artifact.artifact_digest
            replay_state=[string]$artifact.state
            error_code=[string]$response.error_code
          }
        }
      } catch {}
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
        [void](Assert-TrustedBrokerRequestFile -Path $file.FullName -InboxPath $inbox -TaskSid $trustedTunnelTaskSid -MaximumBytes $maxRequestBytes)
        Move-Item -LiteralPath $file.FullName -Destination $claimed -ErrorAction Stop
        $claimedFile = Protect-ClaimedBrokerRequestFile -Path $claimed
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
