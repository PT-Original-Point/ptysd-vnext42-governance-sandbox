[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$SourceRef
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'ADMINISTRATOR_REQUIRED'
}

$repoRaw = 'https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox'
$relativeRoot = 'tools/csg/factory-mcp'
$install = 'C:\ProgramData\PTYSD\MCP\FactoryMCP'
$base = 'C:\ProgramData\PTYSD\MCP'
$brokerTask = 'PTYSD-FactoryMCP-HostGuard-Broker-V47'
$tunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
$health = Join-Path $install 'state\broker-health.json'
$qualificationRoot = Join-Path $base 'qualification'
$qualificationOut = Join-Path $qualificationRoot 'factory-mcp-host-powershell-upgrade.json'
$upgradeResultOut = Join-Path $qualificationRoot 'factory-mcp-host-powershell-upgrade-result.json'
$operationalTunnelRunner = Join-Path $base 'run-factory-mcp-tunnel.ps1'
$tunnelHealthUrlFile = Join-Path $base 'state\tunnel-health-url.txt'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$staging = Join-Path $base ('staging\factory-mcp-host-powershell-' + $stamp)
$backup = Join-Path $base ('backup\factory-mcp-host-powershell-' + $stamp)

$baselineFiles = @(
  'src/index.mjs',
  'src/invoke-hostguard.ps1',
  'broker/hostguard-broker.ps1',
  'tests/protocol-smoke.mjs',
  'tests/live-status-smoke.mjs',
  'windows/run-tunnel.ps1',
  'package.json',
  'package-lock.json'
)
$newFiles = @(
  'broker/host-powershell-exec.ps1',
  'tests/host-powershell-exec-smoke.ps1',
  'tests/control-lane-source-regression.mjs',
  'tests/control-lane-concurrency-smoke.mjs',
  'tests/tunnel-supervisor-source-regression.mjs',
  'config/system-capability.json'
)
$candidateFiles = @($baselineFiles + $newFiles)

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Parse-PowerShell([string]$Path) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors) | Out-Null
  if ($errors.Count -ne 0) {
    $message = ($errors | ForEach-Object { $_.Message }) -join ';'
    throw ('POWERSHELL_PARSE_FAILED:' + (Split-Path $Path -Leaf) + ':' + $message)
  }
}

function Wait-TaskNotRunning([string]$TaskName,[int]$Seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $state = (Get-ScheduledTask -TaskName $TaskName).State.ToString()
    if ($state -ne 'Running') { return $state }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw ('TASK_STOP_TIMEOUT:' + $TaskName)
}

function Wait-BrokerReady([int]$Seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if (Test-Path -LiteralPath $health) {
      try {
        $obj = Get-Content -LiteralPath $health -Raw | ConvertFrom-Json -ErrorAction Stop
        if (
          $obj.schema -eq 'v48.factory-mcp.broker.health.v2' -and
          $obj.status -eq 'READY' -and
          $obj.run_as -eq 'NT AUTHORITY\SYSTEM' -and
          $obj.powershell_exec -eq $true
        ) {
          return $obj
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'BROKER_V48_HEALTH_TIMEOUT'
}


function Write-AtomicJsonFile {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$Value)
  $tmp = $Path + '.tmp.' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp, ($Value | ConvertTo-Json -Depth 16 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
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

function Wait-TunnelReady([int]$Seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  $last = [ordered]@{
    task_state = $null
    live = $false
    ready = $false
    control_plane_status = 'unknown'
    control_plane_probe_mode = 'none'
    control_plane_state = $null
    control_plane_reason_code = $null
    control_plane_observed_at = $null
    control_plane_last_success_unix_seconds = $null
  }
  do {
    try { $last.task_state = (Get-ScheduledTask -TaskName $tunnelTask).State.ToString() }
    catch { $last.task_state = 'MISSING' }

    $baseUrl = $null
    if (Test-Path -LiteralPath $tunnelHealthUrlFile) {
      try {
        $candidate = (Get-Content -LiteralPath $tunnelHealthUrlFile -Raw -ErrorAction Stop).Trim().TrimEnd('/')
        if ($candidate -match '^http://127\.0\.0\.1:\d{1,5}$') { $baseUrl = $candidate }
      } catch {}
    }

    $last.live = $false
    $last.ready = $false
    $last.control_plane_status = 'unknown'
    $last.control_plane_probe_mode = 'none'
    $last.control_plane_state = $null
    $last.control_plane_reason_code = $null
    $last.control_plane_observed_at = $null
    $last.control_plane_last_success_unix_seconds = $null
    if ($baseUrl) {
      try {
        $healthz = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($baseUrl + '/healthz') -TimeoutSec 2
        $last.live = ([int]$healthz.StatusCode -eq 200)
      } catch {}
      try {
        $readyz = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($baseUrl + '/readyz') -TimeoutSec 2
        $last.ready = ([int]$readyz.StatusCode -eq 200)
      } catch {}
      $poll = Get-TunnelControlPlanePollStatus -BaseUrl $baseUrl
      $last.control_plane_status = [string]$poll.status
      $last.control_plane_probe_mode = [string]$poll.mode
      $last.control_plane_state = $poll.state
      $last.control_plane_reason_code = $poll.reason_code
      $last.control_plane_observed_at = $poll.observed_at
      $last.control_plane_last_success_unix_seconds = $poll.last_success_unix_seconds
    }

    if ($last.task_state -eq 'Running' -and $last.live -and $last.ready -and $last.control_plane_status -eq 'ok') {
      return $last
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw ('TUNNEL_READY_TIMEOUT:' + ($last | ConvertTo-Json -Compress))
}

function Invoke-SystemHostExecSelfTest {
  param(
    [Parameter(Mandatory)][string]$HelperPath,
    [Parameter(Mandatory)][string]$SmokePath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$WorkRoot
  )
  $taskName = 'PTYSD-FactoryMCP-HostExec-Preflight-' + [Guid]::NewGuid().ToString('N')
  Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

  $arg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $SmokePath +
    '" -HelperPath "' + $HelperPath +
    '" -OutputPath "' + $OutputPath +
    '" -WorkRoot "' + $WorkRoot +
    '" -ExpectedRunAs "NT AUTHORITY\SYSTEM"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

  try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
      Start-Sleep -Milliseconds 250
      $state = (Get-ScheduledTask -TaskName $taskName).State.ToString()
    } while ($state -eq 'Running' -and [DateTime]::UtcNow -lt $deadline)

    if ($state -eq 'Running') { throw 'SYSTEM_HOST_EXEC_SELFTEST_TIMEOUT' }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    if ([int]$info.LastTaskResult -ne 0) {
      throw ('SYSTEM_HOST_EXEC_SELFTEST_TASK_FAILED:' + [string]$info.LastTaskResult)
    }
    if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'SYSTEM_HOST_EXEC_SELFTEST_OUTPUT_MISSING' }
    $obj = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json -ErrorAction Stop
    if (
      $obj.result -ne 'PASS' -or
      $obj.run_as -ne 'NT AUTHORITY\SYSTEM' -or
      [int]$obj.exit_code -ne 0 -or
      $obj.timed_out -ne $false
    ) {
      throw 'SYSTEM_HOST_EXEC_SELFTEST_NOT_PASS'
    }
    return $obj
  } finally {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  }
}

function Restore-Backup {
  foreach ($rel in $candidateFiles) {
    $src = Join-Path $backup $rel
    $dst = Join-Path $install $rel
    if (Test-Path -LiteralPath $src) {
      New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst -Force
    } elseif ($rel -in $newFiles) {
      Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue
    }
  }
  $runnerBackup = Join-Path $backup 'operational\run-factory-mcp-tunnel.ps1'
  if (Test-Path -LiteralPath $runnerBackup) {
    New-Item -ItemType Directory -Path (Split-Path $operationalTunnelRunner -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $runnerBackup -Destination $operationalTunnelRunner -Force
  }
}
foreach ($task in @($brokerTask,$tunnelTask)) {
  if (-not (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) {
    throw ('SCHEDULED_TASK_MISSING:' + $task)
  }
}
if (-not (Test-Path -LiteralPath $install)) { throw 'FACTORY_MCP_INSTALL_MISSING' }

New-Item -ItemType Directory -Force -Path $staging,$backup,$qualificationRoot | Out-Null

$prestate = [ordered]@{
  schema = 'v48.factory-mcp.host-powershell.upgrade.prestate.v1'
  source_ref = $SourceRef.ToLowerInvariant()
  host = $env:COMPUTERNAME
  run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  broker_task_state = (Get-ScheduledTask -TaskName $brokerTask).State.ToString()
  tunnel_task_state = (Get-ScheduledTask -TaskName $tunnelTask).State.ToString()
  installed = [ordered]@{}
}
foreach ($rel in $baselineFiles) {
  $installedPath = Join-Path $install $rel
  if (-not (Test-Path -LiteralPath $installedPath)) { throw ('INSTALLED_FILE_MISSING:' + $rel) }
  $prestate.installed[$rel] = Get-FileSha256 $installedPath
}
if (-not (Test-Path -LiteralPath $operationalTunnelRunner)) { throw 'OPERATIONAL_TUNNEL_RUNNER_MISSING' }
$prestate.operational_tunnel_runner_sha256 = Get-FileSha256 $operationalTunnelRunner

try {
  foreach ($rel in $candidateFiles) {
    $uri = $repoRaw + '/' + $SourceRef + '/' + $relativeRoot + '/' + ($rel -replace '\\','/')
    $dst = Join-Path $staging $rel
    New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $dst
    if ((Get-Item -LiteralPath $dst).Length -lt 1) { throw ('DOWNLOADED_FILE_EMPTY:' + $rel) }
  }

  Parse-PowerShell (Join-Path $staging 'src\invoke-hostguard.ps1')
  Parse-PowerShell (Join-Path $staging 'broker\hostguard-broker.ps1')
  Parse-PowerShell (Join-Path $staging 'broker\host-powershell-exec.ps1')
  Parse-PowerShell (Join-Path $staging 'tests\host-powershell-exec-smoke.ps1')

  & 'C:\Program Files\nodejs\node.exe' --check (Join-Path $staging 'src\index.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'INDEX_NODE_CHECK_FAILED' }
  & 'C:\Program Files\nodejs\node.exe' --check (Join-Path $staging 'tests\protocol-smoke.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'PROTOCOL_SMOKE_NODE_CHECK_FAILED' }
  & 'C:\Program Files\nodejs\node.exe' --check (Join-Path $staging 'tests\live-status-smoke.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'LIVE_SMOKE_NODE_CHECK_FAILED' }
  & 'C:\Program Files\nodejs\node.exe' --check (Join-Path $staging 'tests\control-lane-source-regression.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'CONTROL_LANE_SOURCE_REGRESSION_NODE_CHECK_FAILED' }
  & 'C:\Program Files\nodejs\node.exe' --check (Join-Path $staging 'tests\control-lane-concurrency-smoke.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'CONTROL_LANE_CONCURRENCY_NODE_CHECK_FAILED' }

  $systemSelfTest = Invoke-SystemHostExecSelfTest `
    -HelperPath (Join-Path $staging 'broker\host-powershell-exec.ps1') `
    -SmokePath (Join-Path $staging 'tests\host-powershell-exec-smoke.ps1') `
    -OutputPath (Join-Path $qualificationRoot 'factory-mcp-host-exec-system-preflight.json') `
    -WorkRoot (Join-Path $staging 'system-host-exec-preflight')

  foreach ($rel in $candidateFiles) {
    $src = Join-Path $install $rel
    if (Test-Path -LiteralPath $src) {
      $dst = Join-Path $backup $rel
      New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
  }
  $runnerBackup = Join-Path $backup 'operational\run-factory-mcp-tunnel.ps1'
  New-Item -ItemType Directory -Path (Split-Path $runnerBackup -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $operationalTunnelRunner -Destination $runnerBackup -Force

  Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue
  [void](Wait-TaskNotRunning -TaskName $tunnelTask -Seconds 10)
  [void](Wait-TaskNotRunning -TaskName $brokerTask -Seconds 10)

  foreach ($rel in $candidateFiles) {
    $src = Join-Path $staging $rel
    $dst = Join-Path $install $rel
    New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  Copy-Item -LiteralPath (Join-Path $install 'windows\run-tunnel.ps1') -Destination $operationalTunnelRunner -Force

  Push-Location $install
  try {
    $env:NODE_ENV = 'test'
    $env:PTYSD_FACTORY_MCP_TEST_MODE = '1'
    & 'C:\Program Files\nodejs\node.exe' (Join-Path $install 'tests\protocol-smoke.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'FACTORY_MCP_PROTOCOL_SMOKE_FAILED' }
  } finally {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    Remove-Item Env:PTYSD_FACTORY_MCP_TEST_MODE -ErrorAction SilentlyContinue
    Pop-Location
  }

  Remove-Item -LiteralPath $health -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $brokerTask
  $brokerHealth = Wait-BrokerReady -Seconds 20

  $controlLaneOut = Join-Path $qualificationRoot 'factory-mcp-control-lane-concurrency.json'
  Remove-Item -LiteralPath $controlLaneOut -Force -ErrorAction SilentlyContinue
  & 'C:\Program Files\nodejs\node.exe' (Join-Path $install 'tests\control-lane-concurrency-smoke.mjs') $controlLaneOut
  if ($LASTEXITCODE -ne 0) { throw 'FACTORY_MCP_CONTROL_LANE_CONCURRENCY_FAILED' }
  if (-not (Test-Path -LiteralPath $controlLaneOut)) { throw 'FACTORY_MCP_CONTROL_LANE_EVIDENCE_MISSING' }
  $controlLane = Get-Content -LiteralPath $controlLaneOut -Raw | ConvertFrom-Json -ErrorAction Stop
  if ($controlLane.result -ne 'PASS' -or [int]$controlLane.status_latency_ms -ge 5000) {
    throw 'FACTORY_MCP_CONTROL_LANE_NOT_PASS'
  }

  Remove-Item -LiteralPath $qualificationOut -Force -ErrorAction SilentlyContinue
  & 'C:\Program Files\nodejs\node.exe' (Join-Path $install 'tests\live-status-smoke.mjs') $qualificationOut
  if ($LASTEXITCODE -ne 0) {
    $lastErrorPath = Join-Path $install 'state\broker-last-error.json'
    if (Test-Path -LiteralPath $lastErrorPath) {
      $safeDiagnostic = (Get-Content -LiteralPath $lastErrorPath -Raw).Trim()
      if ($safeDiagnostic.Length -gt 1600) { $safeDiagnostic = $safeDiagnostic.Substring(0,1600) }
      Write-Host ('BROKER_LAST_ERROR=' + $safeDiagnostic)
    }
    throw 'FACTORY_MCP_LIVE_SMOKE_FAILED'
  }
  if (-not (Test-Path -LiteralPath $qualificationOut)) { throw 'FACTORY_MCP_LIVE_SMOKE_EVIDENCE_MISSING' }
  $live = Get-Content -LiteralPath $qualificationOut -Raw | ConvertFrom-Json -ErrorAction Stop
  if ($live.result -ne 'PASS' -or $live.host_powershell -ne 'PASS' -or $live.host_powershell_run_as -ne 'NT AUTHORITY\SYSTEM') {
    throw 'FACTORY_MCP_LIVE_SMOKE_NOT_PASS'
  }

  Remove-Item -LiteralPath $tunnelHealthUrlFile -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $tunnelTask
  $tunnelReady = Wait-TunnelReady -Seconds 120
  $tunnelState = (Get-ScheduledTask -TaskName $tunnelTask).State.ToString()

  $post = [ordered]@{
    schema = 'v48.factory-mcp.host-powershell.upgrade.result.v1'
    result = 'PASS'
    source_ref = $SourceRef.ToLowerInvariant()
    host = $env:COMPUTERNAME
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    broker_health = $brokerHealth
    tunnel_task_state = $tunnelState
    tunnel_ready = $tunnelReady
    system_host_exec_preflight = $systemSelfTest
    control_lane_concurrency = $controlLane
    live_smoke = $live
    installed = [ordered]@{}
    backup = $backup
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  foreach ($rel in $candidateFiles) {
    $post.installed[$rel] = Get-FileSha256 (Join-Path $install $rel)
  }
  Write-AtomicJsonFile -Path $upgradeResultOut -Value $post
  $post | ConvertTo-Json -Depth 12
} catch {
  $primaryError = [string]$_.Exception.Message
  if ($primaryError.Length -gt 1200) { $primaryError = $primaryError.Substring(0,1200) }
  $rollbackReady = $null
  $rollbackError = $null
  Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue
  try {
    Restore-Backup
    Remove-Item -LiteralPath $health -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $brokerTask -ErrorAction Stop
    [void](Wait-BrokerReady -Seconds 20)
    Remove-Item -LiteralPath $tunnelHealthUrlFile -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $tunnelTask -ErrorAction Stop
    $rollbackReady = Wait-TunnelReady -Seconds 120
  } catch {
    $rollbackError = [string]$_.Exception.Message
    if ($rollbackError.Length -gt 1200) { $rollbackError = $rollbackError.Substring(0,1200) }
  }
  $failure = [ordered]@{
    schema = 'v49.factory-mcp.host-powershell.upgrade.result.v2'
    result = if ($rollbackReady) { 'FAILED_ROLLED_BACK_READY' } else { 'FAILED_ROLLBACK_UNVERIFIED' }
    source_ref = $SourceRef.ToLowerInvariant()
    host = $env:COMPUTERNAME
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    error = $primaryError
    rollback_tunnel_ready = $rollbackReady
    rollback_error = $rollbackError
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  try { Write-AtomicJsonFile -Path $upgradeResultOut -Value $failure } catch {}
  throw
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
