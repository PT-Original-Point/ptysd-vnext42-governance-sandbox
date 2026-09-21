[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$mcpBase = 'C:\ProgramData\PTYSD\MCP'
$root = Join-Path $mcpBase 'FactoryMCP'
$tunnelTaskName = 'PTYSD-FactoryMCP-Tunnel-V47'
$tunnelHealthUrlFile = Join-Path $mcpBase 'state\tunnel-health-url.txt'
$queue = Join-Path $root 'queue'
$inbox = Join-Path $queue 'inbox'
$processing = Join-Path $queue 'processing'
$outbox = Join-Path $queue 'outbox'
$state = Join-Path $root 'state'
$health = Join-Path $state 'broker-health.json'
$lastError = Join-Path $state 'broker-last-error.json'
$execTemp = Join-Path $state 'exec-temp'
$execReceipts = Join-Path $state 'exec-receipts'
$operationClaims = Join-Path $state 'operation-claims'
$modulePath = 'C:\Program Files\WindowsPowerShell\Modules\PTYSD.HostGuard\PTYSD.HostGuard.psd1'
$hostExecHelperPath = Join-Path $root 'broker\host-powershell-exec.ps1'
$systemFenceHelperPath = Join-Path $root 'broker\current-execution-fence.ps1'
$trustedCallerHelperPath = Join-Path $root 'broker\trusted-caller.ps1'
$systemCapabilityPath = Join-Path $root 'config\system-capability.json'
$idPattern = '^[A-Z0-9][A-Z0-9._-]{0,79}$'
$maxRequestBytes = 65536
$maxOutputBytes = 131072

foreach ($path in @($inbox,$processing,$outbox,$state)) {
  if (-not (Test-Path -LiteralPath $path)) { throw ('BROKER_PATH_MISSING:' + $path) }
}
foreach ($path in @($execTemp,$execReceipts,$operationClaims)) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}
if (-not (Test-Path -LiteralPath $modulePath)) { throw 'HOSTGUARD_MODULE_MISSING' }
if (-not (Test-Path -LiteralPath $hostExecHelperPath)) { throw 'HOST_EXEC_HELPER_MISSING' }
if (-not (Test-Path -LiteralPath $systemFenceHelperPath)) { throw 'SYSTEM_FENCE_HELPER_MISSING' }
if (-not (Test-Path -LiteralPath $trustedCallerHelperPath)) { throw 'TRUSTED_CALLER_HELPER_MISSING' }
if (-not (Test-Path -LiteralPath $systemCapabilityPath)) { throw 'SYSTEM_CAPABILITY_CONFIG_MISSING' }
$systemCapability = Get-Content -LiteralPath $systemCapabilityPath -Raw | ConvertFrom-Json -ErrorAction Stop
if (
  $systemCapability.schema -ne 'v49.factory-mcp.system-capability.v1' -or
  $systemCapability.project_id -ne 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' -or
  $systemCapability.capability_id -ne 'CAP-GOV-SYSTEM-V1' -or
  $systemCapability.mission_revision -ne '20260919T010100+0800' -or
  $systemCapability.mission_hash -ne 'sha256:58f21a0818bd60b61929925b38ea8507d5b80c09d816a7b6f5a75d2a410d542b' -or
  $systemCapability.authorization_envelope_digest -ne 'sha256:cb614427a0a1755d002cd035f50d33b18208bab7e5a9d8efc42dfbc7c4d99d14' -or
  [int64]$systemCapability.capability_generation -ne 4 -or
  $systemCapability.production_allowed -ne $false -or
  $systemCapability.business_project_allowed -ne $false -or
  [int]$systemCapability.public_tool_count -ne 4
) { throw 'SYSTEM_CAPABILITY_CONFIG_INVALID' }
Import-Module $modulePath -Force -ErrorAction Stop
. $hostExecHelperPath
. $systemFenceHelperPath
. $trustedCallerHelperPath

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, 'Global\PTYSDFactoryMCPHostGuardBrokerV47', [ref]$createdNew)
if (-not $createdNew) { throw 'BROKER_ALREADY_RUNNING' }

$script:activePowerShellJobs = @{}
$maxConcurrentPowerShell = 4
$maxPerRunPowerShell = 1
$staleGraceSeconds = 5
$script:receiptSummary = [ordered]@{
  broker_records = 0
  orphan_count = 0
  started_count = 0
  terminal_count = 0
  recorded_at_utc = $null
}

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
    system_capability_project_id = [string]$systemCapability.project_id
    system_capability_id = [string]$systemCapability.capability_id
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  Write-AtomicJson -Path $health -Value $payload
}

function Test-Id([object]$Value) {
  return ($null -ne $Value -and [string]$Value -match $idPattern)
}

function Assert-SystemCapabilityRequest {
  param([Parameter(Mandatory)]$Request)
  if ([string]$Request.project_id -ne [string]$systemCapability.project_id) { throw 'SYSTEM_CAPABILITY_PROJECT_DENY' }
  if ([string]$Request.capability_id -ne [string]$systemCapability.capability_id) { throw 'SYSTEM_CAPABILITY_ID_DENY' }
  $runOk = $false
  foreach ($pattern in @($systemCapability.allowed_run_id_patterns)) {
    if ([string]$Request.run_id -match [string]$pattern) { $runOk = $true; break }
  }
  if (-not $runOk) { throw 'SYSTEM_CAPABILITY_RUN_DENY' }
  $taskOk = $false
  foreach ($pattern in @($systemCapability.allowed_task_id_patterns)) {
    if ([string]$Request.task_id -match [string]$pattern) { $taskOk = $true; break }
  }
  if (-not $taskOk) { throw 'SYSTEM_CAPABILITY_TASK_DENY' }
  if ([int]$Request.timeout_seconds -gt [int]$systemCapability.max_timeout_seconds) { throw 'SYSTEM_CAPABILITY_TIMEOUT_DENY' }
  $fenceContext = Assert-PTYSDCurrentSystemExecutionFence -Request $Request -SystemCapability $systemCapability
  $callerClaims = Assert-PTYSDTrustedCallerAttestation -Request $Request -FenceContext $fenceContext
  return [pscustomobject]@{ fence_context=$fenceContext; caller_claims=$callerClaims }
}

function Get-OperationDispatchClaimKey {
  param([Parameter(Mandatory)]$Request)
  if (-not (Test-Id $Request.project_id)) { throw 'OPERATION_CLAIM_PROJECT_INVALID' }
  if (-not (Test-Id $Request.run_id)) { throw 'OPERATION_CLAIM_RUN_INVALID' }
  if (-not (Test-Id $Request.operation_id)) { throw 'OPERATION_CLAIM_OPERATION_INVALID' }
  $epoch = [int64]$Request.attempt_epoch
  if ($epoch -lt 1 -or $epoch -gt 2147483647) { throw 'OPERATION_CLAIM_EPOCH_INVALID' }
  $authGeneration = 0
  if ($Request.PSObject.Properties.Name -contains 'authorization_generation' -and $null -ne $Request.authorization_generation) {
    $authGeneration = [int64]$Request.authorization_generation
    if ($authGeneration -lt 1 -or $authGeneration -gt 2147483647) { throw 'OPERATION_CLAIM_AUTH_GENERATION_INVALID' }
  }
  $canonical = '{0}|{1}|{2}|{3}|{4}' -f [string]$Request.project_id,[string]$Request.run_id,$epoch,$authGeneration,[string]$Request.operation_id
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    $hex = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  return [pscustomobject]@{ key=$hex; authorization_generation=$authGeneration; canonical=$canonical }
}

function Acquire-OperationDispatchClaim {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)][string]$RequestId
  )
  $key = Get-OperationDispatchClaimKey -Request $Request
  $claimPath = Join-Path $operationClaims ($key.key + '.json')
  $claim = [ordered]@{
    schema='v49.factory-mcp.operation-dispatch-claim.v1'
    claim_key=[string]$key.key
    project_id=[string]$Request.project_id
    run_id=[string]$Request.run_id
    attempt_id=[string]$Request.attempt_id
    attempt_epoch=[int64]$Request.attempt_epoch
    authorization_generation=[int64]$key.authorization_generation
    operation_id=[string]$Request.operation_id
    request_id=$RequestId
    state='DISPATCH_CLAIMED'
    claimed_at_utc=[DateTime]::UtcNow.ToString('o')
  }
  $json = $claim | ConvertTo-Json -Depth 6 -Compress
  [byte[]]$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
  try {
    $stream = [IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
      $stream.Write($bytes,0,$bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
  } catch [IO.IOException] {
    if (Test-Path -LiteralPath $claimPath) { throw 'OPERATION_ALREADY_DISPATCHED' }
    throw
  }
  return [pscustomobject]@{ path=$claimPath; key=[string]$key.key }
}

function Get-LatestHostExecReceipt {
  $latest = Get-ChildItem -LiteralPath $execReceipts -Filter '*.json' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latest) { return $null }
  try {
    return (Get-Content -LiteralPath $latest.FullName -Raw | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Get-ActivePowerShellEntries {
  return @($script:activePowerShellJobs.GetEnumerator() | ForEach-Object { $_.Value })
}

function Get-PowerShellEntryAgeSeconds {
  param([Parameter(Mandatory)]$Entry)
  $started = ([DateTime]$Entry.context.started_at_utc).ToUniversalTime()
  return [int][Math]::Max(0,[Math]::Floor(([DateTime]::UtcNow - $started).TotalSeconds))
}

function Reconcile-OrphanedStartedReceipts {
  $summary = [ordered]@{
    broker_records = 0
    orphan_count = 0
    started_count = 0
    terminal_count = 0
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  foreach ($file in @(Get-ChildItem -LiteralPath $execReceipts -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
    try {
      $receipt = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
      $summary.broker_records += 1
      $stateValue = [string]$receipt.state
      if ($stateValue -eq 'STARTED') {
        $requestId = [string]$receipt.request_id
        if (-not $script:activePowerShellJobs.ContainsKey($requestId)) {
          $started = ([DateTime]$receipt.started_at_utc).ToUniversalTime()
          $timeout = [int]$receipt.timeout_seconds
          $ageSeconds = [int][Math]::Max(0,[Math]::Floor(([DateTime]::UtcNow - $started).TotalSeconds))
          if ($ageSeconds -gt ($timeout + $staleGraceSeconds)) {
            $receipt.state = 'ORPHANED'
            $receipt.timed_out = $true
            $receipt.finished_at_utc = [DateTime]::UtcNow.ToString('o')
            $receipt | Add-Member -NotePropertyName error_code -NotePropertyValue 'BROKER_RECEIPT_ORPHANED' -Force
            $receipt | Add-Member -NotePropertyName side_effect_state -NotePropertyValue 'UNKNOWN_AFTER_BROKER_RESTART' -Force
            Write-AtomicJson -Path $file.FullName -Value $receipt
            $stateValue = 'ORPHANED'
            $responsePath = Join-Path $outbox ($requestId + '.json')
            if (-not (Test-Path -LiteralPath $responsePath)) {
              $response = [ordered]@{
                schema='v48.factory-mcp.hostguard.response.v2'; request_id=$requestId; ok=$true; error_code=$null
                result=[ordered]@{
                  schema='v48.factory-mcp.host-exec.result.v2'; operation='powershell'; result='ORPHANED'; request_id=$requestId
                  project_id=[string]$receipt.project_id; capability_id=[string]$receipt.capability_id; run_id=[string]$receipt.run_id; task_id=[string]$receipt.task_id; attempt_id=[string]$receipt.attempt_id; attempt_epoch=[int]$receipt.attempt_epoch
                  run_as=[string]$receipt.run_as; exit_code=$null; timed_out=$true; stdout=''; stderr=''; stdout_bytes=0; stderr_bytes=0
                  stdout_truncated=$false; stderr_truncated=$false; script_sha256=[string]$receipt.script_sha256; receipt_path=$file.FullName
                  side_effect_state='UNKNOWN_AFTER_BROKER_RESTART'
                }
                brokered_at_utc=[DateTime]::UtcNow.ToString('o')
              }
              Write-AtomicJson -Path $responsePath -Value $response
            }
          }
        }
      }
      switch ($stateValue) {
        'ORPHANED' { $summary.orphan_count += 1 }
        'STARTED' { $summary.started_count += 1 }
        default { $summary.terminal_count += 1 }
      }
    } catch {
      # Reconciliation is best-effort and never converts malformed evidence into current truth.
    }
  }
  $script:receiptSummary = $summary
}

function Get-HostExecLaneStatus {
  $active = @(Get-ActivePowerShellEntries)
  if ($active.Count -gt 0) {
    $now = [DateTime]::UtcNow
    $items = @(
      $active |
        Sort-Object { [DateTime]$_.context.started_at_utc } |
        ForEach-Object {
          $started = ([DateTime]$_.context.started_at_utc).ToUniversalTime()
          $ageSeconds = [int][Math]::Max(0,[Math]::Floor(($now - $started).TotalSeconds))
          $stale = ($ageSeconds -gt ([int]$_.context.timeout_seconds + $staleGraceSeconds))
          [ordered]@{
            request_id = [string]$_.context.request_id
            run_id = [string]$_.context.run_id
            task_id = [string]$_.context.task_id
            attempt_id = [string]$_.context.attempt_id
            attempt_epoch = [int]$_.context.attempt_epoch
            started_at_utc = [string]$_.context.started_at_utc
            timeout_seconds = [int]$_.context.timeout_seconds
            age_seconds = $ageSeconds
            stale = [bool]$stale
            job_state = [string]$_.job.State
          }
        }
    )
    $oldest = $items[0]
    $staleCount = @($items | Where-Object { $_.stale }).Count
    return [ordered]@{
      state = 'RUNNING'
      active_count = [int]$items.Count
      effective_active_count = [int]$items.Count
      live_job_count = [int]$items.Count
      broker_records = [int]$script:receiptSummary.broker_records
      orphan_count = [int]$script:receiptSummary.orphan_count
      pending_receipt_count = [int]$script:receiptSummary.started_count
      stale_count = [int]$staleCount
      capacity = [int]$maxConcurrentPowerShell
      max_per_run = [int]$maxPerRunPowerShell
      request_id = [string]$oldest.request_id
      run_id = [string]$oldest.run_id
      task_id = [string]$oldest.task_id
      attempt_id = [string]$oldest.attempt_id
      attempt_epoch = [int]$oldest.attempt_epoch
      started_at_utc = [string]$oldest.started_at_utc
      job_state = [string]$oldest.job_state
      active = $items
    }
  }

  $last = Get-LatestHostExecReceipt
  if (-not $last) {
    return [ordered]@{
      state = 'IDLE'
      active_count = 0
      effective_active_count = 0
      live_job_count = 0
      broker_records = [int]$script:receiptSummary.broker_records
      orphan_count = [int]$script:receiptSummary.orphan_count
      pending_receipt_count = [int]$script:receiptSummary.started_count
      stale_count = 0
      capacity = [int]$maxConcurrentPowerShell
      max_per_run = [int]$maxPerRunPowerShell
      last_request_id = $null
      last_state = $null
    }
  }

  $lastState = if ($last.PSObject.Properties.Name -contains 'state') { [string]$last.state } else { 'LEGACY_TERMINAL' }
  if ($lastState -in @('STARTED','ORPHANED')) {
    return [ordered]@{
      state = 'ORPHANED_UNKNOWN'
      active_count = 0
      effective_active_count = 0
      live_job_count = 0
      broker_records = [int]$script:receiptSummary.broker_records
      orphan_count = [int]$script:receiptSummary.orphan_count
      pending_receipt_count = [int]$script:receiptSummary.started_count
      stale_count = 0
      capacity = [int]$maxConcurrentPowerShell
      max_per_run = [int]$maxPerRunPowerShell
      request_id = [string]$last.request_id
      run_id = [string]$last.run_id
      task_id = [string]$last.task_id
      attempt_id = [string]$last.attempt_id
      attempt_epoch = [int]$last.attempt_epoch
      started_at_utc = [string]$last.started_at_utc
    }
  }

  return [ordered]@{
    state = if ([int]$script:receiptSummary.orphan_count -gt 0) { 'IDLE_WITH_ORPHANS' } else { 'IDLE' }
    active_count = 0
    effective_active_count = 0
    live_job_count = 0
    broker_records = [int]$script:receiptSummary.broker_records
    orphan_count = [int]$script:receiptSummary.orphan_count
    pending_receipt_count = [int]$script:receiptSummary.started_count
    stale_count = 0
    capacity = [int]$maxConcurrentPowerShell
    max_per_run = [int]$maxPerRunPowerShell
    last_request_id = [string]$last.request_id
    last_state = $lastState
    last_finished_at_utc = if ($last.PSObject.Properties.Name -contains 'finished_at_utc') { [string]$last.finished_at_utc } else { $null }
  }
}

function Get-TunnelControlPlanePollStatus {
  param([Parameter(Mandatory)][string]$BaseUrl)

  $result = [ordered]@{
    status = 'unknown'
    mode = 'none'
    state = $null
    reason_code = $null
    observed_at = $null
    last_success_unix_seconds = $null
  }

  try {
    $control = Invoke-RestMethod -UseBasicParsing -Method Get -Uri ($BaseUrl + '/health/control-plane') -TimeoutSec 2
    $result.mode = 'component_endpoint'
    if ($control.PSObject.Properties.Name -contains 'status') { $result.status = [string]$control.status }
    if ($control.PSObject.Properties.Name -contains 'state') { $result.state = [string]$control.state }
    if ($control.PSObject.Properties.Name -contains 'reason_code') { $result.reason_code = [string]$control.reason_code }
    if ($control.PSObject.Properties.Name -contains 'observed_at') { $result.observed_at = [string]$control.observed_at }
    return $result
  } catch {
    $statusCode = $null
    try {
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      }
    } catch {}
    if ($statusCode -and $statusCode -ne 404) {
      $result.mode = 'component_endpoint'
      $result.status = 'error'
      $result.reason_code = ('CONTROL_PLANE_ENDPOINT_HTTP_' + [string]$statusCode)
      return $result
    }
  }

  try {
    $metrics = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($BaseUrl + '/metrics') -TimeoutSec 2
    if ([int]$metrics.StatusCode -ne 200) {
      $result.mode = 'metrics_compat'
      $result.status = 'error'
      $result.reason_code = ('METRICS_HTTP_' + [string][int]$metrics.StatusCode)
      return $result
    }
    $pattern = '(?m)^commands_poll_last_successful_timestamp_seconds(?:\{[^}]*\})?\s+([0-9eE+.\-]+)\s*$'
    $match = [regex]::Match([string]$metrics.Content, $pattern)
    $result.mode = 'metrics_compat'
    if (-not $match.Success) {
      $result.reason_code = 'CONTROL_PLANE_POLL_METRIC_MISSING'
      return $result
    }
    $value = [Convert]::ToDouble($match.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    $result.last_success_unix_seconds = $value
    if ($value -gt 0) {
      $result.status = 'ok'
      $result.state = 'poll_success_observed'
      try {
        $result.observed_at = [DateTimeOffset]::FromUnixTimeSeconds([int64][Math]::Floor($value)).UtcDateTime.ToString('o')
      } catch {}
    } else {
      $result.reason_code = 'NO_SUCCESSFUL_CONTROL_PLANE_POLL_OBSERVED'
    }
    return $result
  } catch {
    $result.mode = 'metrics_compat'
    $result.status = 'error'
    $result.reason_code = 'CONTROL_PLANE_HEALTH_UNAVAILABLE'
    return $result
  }
}

function Get-TunnelLaneStatus {
  $taskState = 'MISSING'
  $lastTaskResult = $null
  try {
    $task = Get-ScheduledTask -TaskName $tunnelTaskName -ErrorAction SilentlyContinue
    if ($task) {
      $taskState = $task.State.ToString()
      $info = Get-ScheduledTaskInfo -TaskName $tunnelTaskName -ErrorAction SilentlyContinue
      if ($info) { $lastTaskResult = [int64]$info.LastTaskResult }
    }
  } catch {}

  $baseUrl = $null
  if (Test-Path -LiteralPath $tunnelHealthUrlFile) {
    try {
      $candidate = (Get-Content -LiteralPath $tunnelHealthUrlFile -Raw -ErrorAction Stop).Trim().TrimEnd('/')
      if ($candidate -match '^http://127\.0\.0\.1:\d{1,5}$') { $baseUrl = $candidate }
    } catch {}
  }

  $live = $false
  $ready = $false
  $poll = [ordered]@{
    status = 'unknown'
    mode = 'none'
    state = $null
    reason_code = $null
    observed_at = $null
    last_success_unix_seconds = $null
  }
  if ($baseUrl) {
    try {
      $healthz = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($baseUrl + '/healthz') -TimeoutSec 2
      $live = ([int]$healthz.StatusCode -eq 200)
    } catch {}
    try {
      $readyz = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($baseUrl + '/readyz') -TimeoutSec 2
      $ready = ([int]$readyz.StatusCode -eq 200)
    } catch {}
    $poll = Get-TunnelControlPlanePollStatus -BaseUrl $baseUrl
  }

  return [ordered]@{
    task_state = $taskState
    last_task_result = $lastTaskResult
    health_url_present = [bool]$baseUrl
    live = $live
    ready = $ready
    control_plane_status = [string]$poll.status
    control_plane_probe_mode = [string]$poll.mode
    control_plane_state = $poll.state
    control_plane_reason_code = $poll.reason_code
    control_plane_observed_at = $poll.observed_at
    control_plane_last_success_unix_seconds = $poll.last_success_unix_seconds
  }
}

function Get-CloudflareIdentityReadback {
  $declaredAccountId = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID','Process')
  if (-not $declaredAccountId) {
    $declaredAccountId = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID','Machine')
  }
  $token = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Process')
  if (-not $token) {
    $token = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')
  }

  $accounts = @()
  $verified = $false
  $errorCode = $null
  if ($token) {
    try {
      $headers = @{ Authorization = ('Bearer ' + $token) }
      $reply = Invoke-RestMethod -UseBasicParsing -Method Get -Uri 'https://api.cloudflare.com/client/v4/accounts?per_page=50' -Headers $headers -TimeoutSec 8
      if (-not $reply -or $reply.success -ne $true) { throw 'CLOUDFLARE_API_GET_NOT_SUCCESS' }
      foreach ($account in @($reply.result) | Select-Object -First 50) {
        $accounts += [ordered]@{ id = [string]$account.id; name = [string]$account.name }
      }
      $verified = $true
    } catch {
      $errorCode = 'CLOUDFLARE_IDENTITY_GET_FAILED'
    }
  }

  return [ordered]@{
    provider = 'cloudflare'
    mode = if ($verified) { 'PROVIDER_API_GET' } elseif ($declaredAccountId) { 'LOCAL_DECLARED_ONLY' } else { 'NOT_CONFIGURED' }
    declared_account_id = if ($declaredAccountId) { [string]$declaredAccountId } else { $null }
    accounts = $accounts
    provider_verified = $verified
    api_token_present = [bool]$token
    error_code = $errorCode
  }
}

function Start-BrokerPowerShell {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)][string]$RequestId
  )

  $active = @(Get-ActivePowerShellEntries)
  if ($active.Count -ge $maxConcurrentPowerShell) { throw 'POWERSHELL_CAPACITY_EXHAUSTED' }
  $sameRun = @($active | Where-Object { [string]$_.context.run_id -eq [string]$Request.run_id })
  if ($sameRun.Count -ge $maxPerRunPowerShell) { throw 'POWERSHELL_RUN_BUSY' }
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

  $dispatchClaim = Acquire-OperationDispatchClaim -Request $Request -RequestId $RequestId
  $startedAt = [DateTime]::UtcNow.ToString('o')
  $receiptPath = Join-Path $execReceipts ($RequestId + '.json')
  $startedReceipt = [ordered]@{
    schema='v48.factory-mcp.host-exec.receipt.v2'
    state='STARTED'
    request_id=$RequestId
    operation='powershell'
    project_id=[string]$Request.project_id
    capability_id=[string]$Request.capability_id
    operation_id=[string]$Request.operation_id
    control_oid=[string]$Request.control_oid
    checkpoint_digest=[string]$Request.checkpoint_digest
    authorization_envelope_digest=[string]$Request.authorization_envelope_digest
    capability_generation=[int64]$Request.capability_generation
    run_id=[string]$Request.run_id
    task_id=[string]$Request.task_id
    attempt_id=[string]$Request.attempt_id
    attempt_epoch=[int]$Request.attempt_epoch
    run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    script_sha256=Get-PTYSDHostExecSha256Hex -Bytes $scriptBytes
    timeout_seconds=$timeout
    exit_code=$null
    timed_out=$false
    side_effect_state='PENDING'
    stdout_bytes=$null
    stderr_bytes=$null
    stdout_sha256=$null
    stderr_sha256=$null
    started_at_utc=$startedAt
    finished_at_utc=$null
  }
  Write-AtomicJson -Path $receiptPath -Value $startedReceipt

  $responsePath = Join-Path $outbox ($RequestId + '.json')
  try {
    $job = Start-Job -ScriptBlock {
      param($HelperPath,$EncodedScript,$Timeout,$ExecTemp,$RequestId,$MaxOutputBytes)
      Set-StrictMode -Version Latest
      $ErrorActionPreference = 'Stop'
      . $HelperPath
      try {
        [byte[]]$bytes = [Convert]::FromBase64String($EncodedScript)
        $raw = Invoke-PTYSDHostPowerShellExec -ScriptBytes $bytes -TimeoutSeconds $Timeout -ExecTemp $ExecTemp -RequestId $RequestId -MaxOutputBytes $MaxOutputBytes
        [ordered]@{ ok=$true; raw=$raw } | ConvertTo-Json -Depth 10 -Compress
      } catch {
        [ordered]@{ ok=$false; error=[string]$_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
      }
    } -ArgumentList $hostExecHelperPath,$scriptB64,$timeout,$execTemp,$RequestId,$maxOutputBytes
  } catch {
    $failed = $startedReceipt.Clone()
    $failed.state = 'FAILED'
    $failed.finished_at_utc = [DateTime]::UtcNow.ToString('o')
    Write-AtomicJson -Path $receiptPath -Value $failed
    throw 'POWERSHELL_EXEC_LAUNCH_FAILED'
  }

  $script:activePowerShellJobs[$RequestId] = [ordered]@{
    job=$job
    context=[ordered]@{
      request_id=$RequestId
      response_path=$responsePath
      receipt_path=$receiptPath
      project_id=[string]$Request.project_id
      capability_id=[string]$Request.capability_id
      operation_id=[string]$Request.operation_id
      control_oid=[string]$Request.control_oid
      checkpoint_digest=[string]$Request.checkpoint_digest
      authorization_envelope_digest=[string]$Request.authorization_envelope_digest
      capability_generation=[int64]$Request.capability_generation
      run_id=[string]$Request.run_id
      task_id=[string]$Request.task_id
      attempt_id=[string]$Request.attempt_id
      attempt_epoch=[int]$Request.attempt_epoch
      timeout_seconds=$timeout
      script_sha256=[string]$startedReceipt.script_sha256
      started_at_utc=$startedAt
    }
  }
}

function Complete-OnePowerShellJob {
  param([Parameter(Mandatory)][string]$RequestId)
  if (-not $script:activePowerShellJobs.ContainsKey($RequestId)) { return }
  $entry = $script:activePowerShellJobs[$RequestId]
  $job = $entry.job
  $ctx = $entry.context
  if ([string]$job.State -in @('Running','NotStarted')) {
    $ageSeconds = Get-PowerShellEntryAgeSeconds -Entry $entry
    if ($ageSeconds -le ([int]$ctx.timeout_seconds + $staleGraceSeconds)) { return }
    $finishedAt = [DateTime]::UtcNow.ToString('o')
    try { Stop-Job -Job $job -ErrorAction SilentlyContinue } catch {}
    $receipt = [ordered]@{
      schema='v48.factory-mcp.host-exec.receipt.v2'; state='TIMED_OUT'; request_id=[string]$ctx.request_id; operation='powershell'
      project_id=[string]$ctx.project_id; capability_id=[string]$ctx.capability_id; operation_id=[string]$ctx.operation_id; control_oid=[string]$ctx.control_oid; checkpoint_digest=[string]$ctx.checkpoint_digest; authorization_envelope_digest=[string]$ctx.authorization_envelope_digest; capability_generation=[int64]$ctx.capability_generation; run_id=[string]$ctx.run_id; task_id=[string]$ctx.task_id; attempt_id=[string]$ctx.attempt_id; attempt_epoch=[int]$ctx.attempt_epoch
      run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name; script_sha256=[string]$ctx.script_sha256; timeout_seconds=[int]$ctx.timeout_seconds
      exit_code=$null; timed_out=$true; side_effect_state='UNKNOWN_AFTER_TIMEOUT'; stdout_bytes=$null; stderr_bytes=$null; stdout_sha256=$null; stderr_sha256=$null
      started_at_utc=[string]$ctx.started_at_utc; finished_at_utc=$finishedAt; error_code='BROKER_WATCHDOG_TIMEOUT'
    }
    Write-AtomicJson -Path ([string]$ctx.receipt_path) -Value $receipt
    $response = [ordered]@{
      schema='v48.factory-mcp.hostguard.response.v2'; request_id=[string]$ctx.request_id; ok=$true; error_code=$null
      result=[ordered]@{
        schema='v48.factory-mcp.host-exec.result.v2'; operation='powershell'; result='TIMED_OUT'; request_id=[string]$ctx.request_id
        project_id=[string]$ctx.project_id; capability_id=[string]$ctx.capability_id; operation_id=[string]$ctx.operation_id; control_oid=[string]$ctx.control_oid; checkpoint_digest=[string]$ctx.checkpoint_digest; authorization_envelope_digest=[string]$ctx.authorization_envelope_digest; capability_generation=[int64]$ctx.capability_generation; run_id=[string]$ctx.run_id; task_id=[string]$ctx.task_id; attempt_id=[string]$ctx.attempt_id; attempt_epoch=[int]$ctx.attempt_epoch
        run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name; executable=$null; exit_code=$null; timed_out=$true
        stdout=''; stderr=''; stdout_bytes=0; stderr_bytes=0; stdout_truncated=$false; stderr_truncated=$false
        script_sha256=[string]$ctx.script_sha256; receipt_path=[string]$ctx.receipt_path; side_effect_state='UNKNOWN_AFTER_TIMEOUT'
      }
      brokered_at_utc=$finishedAt
    }
    Write-AtomicJson -Path ([string]$ctx.response_path) -Value $response
    try { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue } catch { try { Remove-Job -Job $job -ErrorAction SilentlyContinue } catch {} }
    [void]$script:activePowerShellJobs.Remove($RequestId)
    return
  }
  $deferred = $false
  $response = [ordered]@{
    schema = 'v48.factory-mcp.hostguard.response.v2'
    request_id = [string]$ctx.request_id
    ok = $false
    error_code = 'POWERSHELL_EXEC_ASYNC_FAILED'
    result = $null
    brokered_at_utc = [DateTime]::UtcNow.ToString('o')
  }

  try {
    if ([string]$job.State -ne 'Completed') { throw 'POWERSHELL_EXEC_ASYNC_FAILED' }
    $lines = @(Receive-Job -Job $job -ErrorAction Stop)
    $jsonLine = $lines | Where-Object { $_ -is [string] -and $_.Trim().StartsWith('{') } | Select-Object -Last 1
    if (-not $jsonLine) { throw 'POWERSHELL_EXEC_ASYNC_RESULT_MISSING' }
    $payload = [string]$jsonLine | ConvertFrom-Json -ErrorAction Stop
    if (-not [bool]$payload.ok) {
      $safe = [string]$payload.error
      if ($safe.Length -gt 240) { $safe = $safe.Substring(0,240) }
      throw ('POWERSHELL_EXEC_ASYNC_CHILD_FAILED:' + $safe)
    }

    $raw = $payload.raw
    $state = if ([bool]$raw.timed_out) { 'TIMED_OUT' } else { 'COMPLETED' }
    $receipt = [ordered]@{
      schema='v48.factory-mcp.host-exec.receipt.v2'
      state=$state
      request_id=[string]$ctx.request_id
      operation='powershell'
      project_id=[string]$ctx.project_id
      capability_id=[string]$ctx.capability_id
      operation_id=[string]$ctx.operation_id
      control_oid=[string]$ctx.control_oid
      checkpoint_digest=[string]$ctx.checkpoint_digest
      authorization_envelope_digest=[string]$ctx.authorization_envelope_digest
      capability_generation=[int64]$ctx.capability_generation
      run_id=[string]$ctx.run_id
      task_id=[string]$ctx.task_id
      attempt_id=[string]$ctx.attempt_id
      attempt_epoch=[int]$ctx.attempt_epoch
      run_as=[string]$raw.run_as
      executable=[string]$raw.executable
      script_sha256=[string]$raw.script_sha256
      timeout_seconds=[int]$raw.timeout_seconds
      exit_code=[int]$raw.exit_code
      timed_out=[bool]$raw.timed_out
      side_effect_state=if([bool]$raw.timed_out){'UNKNOWN_AFTER_TIMEOUT'}else{'OBSERVED_COMPLETED'}
      stdout_bytes=[int64]$raw.stdout_bytes
      stderr_bytes=[int64]$raw.stderr_bytes
      stdout_sha256=[string]$raw.stdout_sha256
      stderr_sha256=[string]$raw.stderr_sha256
      started_at_utc=[string]$raw.started_at_utc
      finished_at_utc=[string]$raw.finished_at_utc
    }
    Write-AtomicJson -Path ([string]$ctx.receipt_path) -Value $receipt

    $response.ok = $true
    $response.error_code = $null
    $response.result = [ordered]@{
      schema='v48.factory-mcp.host-exec.result.v2'
      operation='powershell'
      result=$state
      request_id=[string]$ctx.request_id
      project_id=[string]$ctx.project_id
      capability_id=[string]$ctx.capability_id
      operation_id=[string]$ctx.operation_id
      control_oid=[string]$ctx.control_oid
      checkpoint_digest=[string]$ctx.checkpoint_digest
      authorization_envelope_digest=[string]$ctx.authorization_envelope_digest
      capability_generation=[int64]$ctx.capability_generation
      run_id=[string]$ctx.run_id
      task_id=[string]$ctx.task_id
      attempt_id=[string]$ctx.attempt_id
      attempt_epoch=[int]$ctx.attempt_epoch
      run_as=[string]$raw.run_as
      executable=[string]$raw.executable
      exit_code=[int]$raw.exit_code
      timed_out=[bool]$raw.timed_out
      side_effect_state=if([bool]$raw.timed_out){'UNKNOWN_AFTER_TIMEOUT'}else{'OBSERVED_COMPLETED'}
      stdout=[string]$raw.stdout
      stderr=[string]$raw.stderr
      stdout_bytes=[int64]$raw.stdout_bytes
      stderr_bytes=[int64]$raw.stderr_bytes
      stdout_truncated=[bool]$raw.stdout_truncated
      stderr_truncated=[bool]$raw.stderr_truncated
      script_sha256=[string]$raw.script_sha256
      receipt_path=[string]$ctx.receipt_path
    }
  } catch {
    $safeMessage = [string]$_.Exception.Message
    if ($safeMessage.Length -gt 240) { $safeMessage = $safeMessage.Substring(0,240) }
    $failedReceipt = [ordered]@{
      schema='v48.factory-mcp.host-exec.receipt.v2'
      state='FAILED'
      request_id=[string]$ctx.request_id
      operation='powershell'
      project_id=[string]$ctx.project_id
      capability_id=[string]$ctx.capability_id
      operation_id=[string]$ctx.operation_id
      control_oid=[string]$ctx.control_oid
      checkpoint_digest=[string]$ctx.checkpoint_digest
      authorization_envelope_digest=[string]$ctx.authorization_envelope_digest
      capability_generation=[int64]$ctx.capability_generation
      run_id=[string]$ctx.run_id
      task_id=[string]$ctx.task_id
      attempt_id=[string]$ctx.attempt_id
      attempt_epoch=[int]$ctx.attempt_epoch
      run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name
      script_sha256=[string]$ctx.script_sha256
      timeout_seconds=[int]$ctx.timeout_seconds
      exit_code=$null
      timed_out=$false
      side_effect_state='UNKNOWN_AFTER_EXECUTOR_FAILURE'
      stdout_bytes=$null
      stderr_bytes=$null
      stdout_sha256=$null
      stderr_sha256=$null
      started_at_utc=[string]$ctx.started_at_utc
      finished_at_utc=[DateTime]::UtcNow.ToString('o')
      error_code='POWERSHELL_EXEC_ASYNC_FAILED'
    }
    try { Write-AtomicJson -Path ([string]$ctx.receipt_path) -Value $failedReceipt } catch {}
    $response.ok = $false
    $response.error_code = 'POWERSHELL_EXEC_ASYNC_FAILED'
    $response.result = $null
  } finally {
    try { Write-AtomicJson -Path ([string]$ctx.response_path) -Value $response } catch {}
    try { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue } catch {}
    [void]$script:activePowerShellJobs.Remove($RequestId)
  }
}

function Complete-ActivePowerShellJobs {
  foreach ($requestId in @($script:activePowerShellJobs.Keys)) {
    Complete-OnePowerShellJob -RequestId ([string]$requestId)
  }
}
function Process-Request {
  param([Parameter(Mandatory)][IO.FileInfo]$File)
  $requestId = $File.BaseName
  $responsePath = Join-Path $outbox ($requestId + '.json')
  $deferred = $false
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
    if ($req.operation -eq 'status') {
      $probe = if ($req.PSObject.Properties.Name -contains 'probe' -and $req.probe) { [string]$req.probe } else { 'factory' }
      if ($probe -notin @('factory','cloudflare_identity')) { throw 'STATUS_PROBE_INVALID' }
    }
    if ([int64]$req.attempt_epoch -lt 1 -or [int64]$req.attempt_epoch -gt 2147483647) { throw 'ATTEMPT_EPOCH_INVALID' }
    if ($req.operation -ne 'status') {
      if (-not (Test-Id $req.run_id) -or -not (Test-Id $req.task_id) -or -not (Test-Id $req.attempt_id)) { throw 'ID_INVALID' }
    }
    if ($req.operation -eq 'powershell') {
      $systemAuth = Assert-SystemCapabilityRequest -Request $req
      $req | Add-Member -NotePropertyName caller_id -NotePropertyValue ([string]$systemAuth.caller_claims.caller_id) -Force
      $req | Add-Member -NotePropertyName caller_identity_digest -NotePropertyValue ([string]$systemAuth.caller_claims.caller_identity_digest) -Force
      $req | Add-Member -NotePropertyName caller_certificate_sha256 -NotePropertyValue ([string]$systemAuth.caller_claims.certificate_sha256) -Force
      $req | Add-Member -NotePropertyName caller_identity_generation -NotePropertyValue ([int64]$systemAuth.caller_claims.identity_generation) -Force
    }

    switch ([string]$req.operation) {
      'status' {
        if ($probe -eq 'cloudflare_identity') {
          $result = Get-CloudflareIdentityReadback
        } else {
          $result = Get-PTYSDHostGuardStatus
          $result | Add-Member -NotePropertyName host_exec_lane -NotePropertyValue (Get-HostExecLaneStatus) -Force
          $result | Add-Member -NotePropertyName tunnel_lane -NotePropertyValue (Get-TunnelLaneStatus) -Force
        }
      }
      'prepare' {
        $result = Invoke-PTYSDHostPrepare -RunId ([string]$req.run_id) -TaskId ([string]$req.task_id) -AttemptId ([string]$req.attempt_id) -AttemptEpoch ([int]$req.attempt_epoch)
      }
      'start' {
        $result = Start-PTYSDWorkerVm -RunId ([string]$req.run_id) -TaskId ([string]$req.task_id) -AttemptId ([string]$req.attempt_id) -AttemptEpoch ([int]$req.attempt_epoch)
      }
      'powershell' {
        Start-BrokerPowerShell -Request $req -RequestId $requestId
        $deferred = $true
        $result = $null
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
      '^POWERSHELL_' { $safeMessage; break }
      '^SYSTEM_CAPABILITY_' { $safeMessage; break }
      '^SYSTEM_FENCE_' { $safeMessage; break }
      '^TRUSTED_CALLER_' { $safeMessage; break }
      '^OPERATION_ALREADY_DISPATCHED' { 'OPERATION_ALREADY_DISPATCHED'; break }
      '^OPERATION_CLAIM_' { $safeMessage; break }
      '^STATUS_PROBE_INVALID' { 'STATUS_PROBE_INVALID'; break }
      '^REQUEST_' { $safeMessage; break }
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

  if (-not $deferred) {
    Write-AtomicJson -Path $responsePath -Value $response
  }
}

try {
  Write-Health
  $lastHealth = [DateTime]::UtcNow
  $lastReceiptReconcile = [DateTime]::MinValue
  while ($true) {
    Complete-ActivePowerShellJobs
    if (([DateTime]::UtcNow - $lastReceiptReconcile).TotalSeconds -ge 5) {
      Reconcile-OrphanedStartedReceipts
      $lastReceiptReconcile = [DateTime]::UtcNow
    }
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
