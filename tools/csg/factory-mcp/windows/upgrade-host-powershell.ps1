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
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$staging = Join-Path $base ('staging\factory-mcp-host-powershell-' + $stamp)
$backup = Join-Path $base ('backup\factory-mcp-host-powershell-' + $stamp)

$baselineFiles = @(
  'src/index.mjs',
  'src/invoke-hostguard.ps1',
  'broker/hostguard-broker.ps1',
  'tests/protocol-smoke.mjs',
  'tests/live-status-smoke.mjs',
  'package.json',
  'package-lock.json'
)
$newFiles = @(
  'broker/host-powershell-exec.ps1',
  'tests/host-powershell-exec-smoke.ps1'
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
  foreach ($rel in $newFiles) {
    Remove-Item -LiteralPath (Join-Path $install $rel) -Force -ErrorAction SilentlyContinue
  }
  foreach ($rel in $baselineFiles) {
    $src = Join-Path $backup $rel
    if (Test-Path -LiteralPath $src) {
      $dst = Join-Path $install $rel
      New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
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

  $systemSelfTest = Invoke-SystemHostExecSelfTest `
    -HelperPath (Join-Path $staging 'broker\host-powershell-exec.ps1') `
    -SmokePath (Join-Path $staging 'tests\host-powershell-exec-smoke.ps1') `
    -OutputPath (Join-Path $qualificationRoot 'factory-mcp-host-exec-system-preflight.json') `
    -WorkRoot (Join-Path $staging 'system-host-exec-preflight')

  foreach ($rel in $baselineFiles) {
    $src = Join-Path $install $rel
    $dst = Join-Path $backup $rel
    New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }

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

  Push-Location $install
  try {
    $env:NODE_ENV = 'test'
    $env:PTYSD_FACTORY_MCP_TEST_MODE = '1'
    & 'C:\Program Files\nodejs\npm.cmd' test
    if ($LASTEXITCODE -ne 0) { throw 'FACTORY_MCP_PROTOCOL_SMOKE_FAILED' }
  } finally {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    Remove-Item Env:PTYSD_FACTORY_MCP_TEST_MODE -ErrorAction SilentlyContinue
    Pop-Location
  }

  Remove-Item -LiteralPath $health -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $brokerTask
  $brokerHealth = Wait-BrokerReady -Seconds 20

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

  Start-ScheduledTask -TaskName $tunnelTask
  Start-Sleep -Seconds 3
  $tunnelState = (Get-ScheduledTask -TaskName $tunnelTask).State.ToString()

  $post = [ordered]@{
    schema = 'v48.factory-mcp.host-powershell.upgrade.result.v1'
    result = 'PASS'
    source_ref = $SourceRef.ToLowerInvariant()
    host = $env:COMPUTERNAME
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    broker_health = $brokerHealth
    tunnel_task_state = $tunnelState
    system_host_exec_preflight = $systemSelfTest
    live_smoke = $live
    installed = [ordered]@{}
    backup = $backup
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  foreach ($rel in $candidateFiles) {
    $post.installed[$rel] = Get-FileSha256 (Join-Path $install $rel)
  }
  $post | ConvertTo-Json -Depth 12
} catch {
  Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue
  try {
    Restore-Backup
    Remove-Item -LiteralPath $health -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  } catch {}
  throw
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
