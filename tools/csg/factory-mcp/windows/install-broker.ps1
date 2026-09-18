[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$base = 'C:\ProgramData\PTYSD\MCP'
$install = Join-Path $base 'FactoryMCP'
$tunnel = Join-Path $base 'tunnel\v0.0.14'
$doctorClient = Join-Path $base 'tunnel\full\v0.0.14'
$runtimeStaging = Join-Path $base 'staging\v0.0.14\runtime'
$fullStaging = Join-Path $base 'staging\v0.0.14\client'
$expectedRuntimeExeSha256 = '09eac072d392b8d27b7aea8cbc146ab3738934961278b6b69cb23513607a08d7'
$expectedDoctorExeSha256 = 'fcc85a69ec0ad82518e4f8964f60c45e31787957782a0fc9c1b0c44e82d61b9b'
$brokerTask = 'PTYSD-FactoryMCP-HostGuard-Broker-V47'
$tunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
$probeTask = 'PTYSD-FactoryMCP-Live-Probe-Temp'
$probeOut = Join-Path $base 'qualification\factory-mcp-live-status.json'

foreach ($name in @($brokerTask,$tunnelTask,$probeTask)) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw ('TASK_ALREADY_EXISTS:' + $name) }
}
if (Test-Path -LiteralPath $install) { throw 'INSTALL_ROOT_ALREADY_EXISTS' }

$required = @('package.json','package-lock.json','src\index.mjs','src\invoke-hostguard.ps1','broker\hostguard-broker.ps1','tests\protocol-smoke.mjs','tests\live-status-smoke.mjs','tests\tunnel-preflight-negative.ps1','tests\credential-ingest-smoke.ps1','windows\qualify-tunnel.ps1','windows\import-tunnel-credentials.ps1','windows\run-tunnel.ps1','windows\factory-mcp-tunnel.template.yaml')
foreach ($rel in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot $rel))) { throw ('SOURCE_FILE_MISSING:' + $rel) }
}
if (-not (Test-Path -LiteralPath $runtimeStaging)) { throw 'RUNTIME_STAGING_MISSING' }
if (-not (Test-Path -LiteralPath $fullStaging)) { throw 'FULL_CLIENT_STAGING_MISSING' }
$runtimeExe = Get-ChildItem -LiteralPath $runtimeStaging -Recurse -Filter 'tunnel-client-runtime.exe' -File | Select-Object -First 1
$doctorExe = Get-ChildItem -LiteralPath $fullStaging -Recurse -Filter 'tunnel-client.exe' -File | Select-Object -First 1
if (-not $runtimeExe) { throw 'RUNTIME_EXE_MISSING' }
if (-not $doctorExe) { throw 'DOCTOR_EXE_MISSING' }
$runtimeExeSha = (Get-FileHash -LiteralPath $runtimeExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$doctorExeSha = (Get-FileHash -LiteralPath $doctorExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedRuntimeExeSha256 -eq 'REPLACE_RUNTIME_EXE_SHA256') { throw 'INSTALLER_RUNTIME_EXE_SHA_NOT_PINNED' }
if ($expectedDoctorExeSha256 -eq 'REPLACE_DOCTOR_EXE_SHA256') { throw 'INSTALLER_DOCTOR_EXE_SHA_NOT_PINNED' }
if ($runtimeExeSha -ne $expectedRuntimeExeSha256) { throw 'RUNTIME_EXE_SHA256_MISMATCH' }
if ($doctorExeSha -ne $expectedDoctorExeSha256) { throw 'DOCTOR_EXE_SHA256_MISMATCH' }
& $runtimeExe.FullName run --help *> $null
if ($LASTEXITCODE -ne 0) { throw 'RUNTIME_RUN_HELP_FAILED' }
& $doctorExe.FullName doctor --help *> $null
if ($LASTEXITCODE -ne 0) { throw 'DOCTOR_HELP_FAILED' }

$createdTasks = @()
try {
  New-Item -ItemType Directory -Force -Path $install,(Join-Path $install 'queue\inbox'),(Join-Path $install 'queue\processing'),(Join-Path $install 'queue\outbox'),(Join-Path $install 'state'),(Join-Path $base 'qualification'),(Join-Path $base 'config'),(Join-Path $base 'secrets'),(Join-Path $base 'logs'),(Join-Path $base 'state'),$tunnel,$doctorClient | Out-Null
  foreach ($rel in $required) {
    $src = Join-Path $SourceRoot $rel
    $dst = Join-Path $install $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  Copy-Item -LiteralPath $runtimeExe.FullName -Destination (Join-Path $tunnel 'tunnel-client.exe') -Force
  Copy-Item -LiteralPath $doctorExe.FullName -Destination (Join-Path $doctorClient 'tunnel-client.exe') -Force
  Copy-Item -LiteralPath (Join-Path $SourceRoot 'windows\run-tunnel.ps1') -Destination (Join-Path $base 'run-factory-mcp-tunnel.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $SourceRoot 'windows\import-tunnel-credentials.ps1') -Destination (Join-Path $base 'import-factory-mcp-credentials.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $SourceRoot 'windows\factory-mcp-tunnel.template.yaml') -Destination (Join-Path $base 'config\factory-mcp-tunnel.template.yaml') -Force

  Push-Location $install
  try {
    & npm.cmd ci --ignore-scripts --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'NPM_CI_FAILED' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'FACTORY_MCP_PROTOCOL_SMOKE_FAILED' }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $install 'tests\tunnel-preflight-negative.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'TUNNEL_PREFLIGHT_NEGATIVE_FAILED' }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $install 'tests\credential-ingest-smoke.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'CREDENTIAL_INGEST_SMOKE_FAILED' }
  } finally { Pop-Location }

  & icacls.exe $install /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)RX' | Out-Null
  foreach ($q in @('queue\inbox','queue\processing','queue\outbox')) {
    & icacls.exe (Join-Path $install $q) /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M' | Out-Null
  }
  & icacls.exe (Join-Path $base 'state') /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M' 2>$null | Out-Null
  & icacls.exe (Join-Path $base 'logs') /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M' | Out-Null
  & icacls.exe (Join-Path $base 'qualification') /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M' | Out-Null
  & icacls.exe (Join-Path $base 'secrets') /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)R' | Out-Null
  & icacls.exe (Join-Path $base 'config') /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)R' | Out-Null
  & icacls.exe $tunnel /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)RX' | Out-Null
  & icacls.exe $doctorClient /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)RX' | Out-Null
  & icacls.exe (Join-Path $base 'run-factory-mcp-tunnel.ps1') /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' 'NT AUTHORITY\NETWORK SERVICE:RX' | Out-Null
  & icacls.exe (Join-Path $base 'import-factory-mcp-credentials.ps1') /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' | Out-Null

  $brokerAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $install 'broker\hostguard-broker.ps1')+'"')
  $brokerTrigger = New-ScheduledTaskTrigger -AtStartup
  $brokerPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $brokerSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $brokerTask -Action $brokerAction -Trigger $brokerTrigger -Principal $brokerPrincipal -Settings $brokerSettings | Out-Null
  $createdTasks += $brokerTask

  $tunnelAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $base 'run-factory-mcp-tunnel.ps1')+'"')
  $tunnelTrigger = New-ScheduledTaskTrigger -AtStartup
  $tunnelPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\NETWORK SERVICE' -LogonType ServiceAccount -RunLevel Limited
  $tunnelSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $tunnelTask -Action $tunnelAction -Trigger $tunnelTrigger -Principal $tunnelPrincipal -Settings $tunnelSettings | Out-Null
  $createdTasks += $tunnelTask
  Disable-ScheduledTask -TaskName $tunnelTask | Out-Null

  Start-ScheduledTask -TaskName $brokerTask
  $health = Join-Path $install 'state\broker-health.json'
  $deadline = (Get-Date).AddSeconds(15)
  do { Start-Sleep -Milliseconds 250 } while (-not (Test-Path -LiteralPath $health) -and (Get-Date) -lt $deadline)
  if (-not (Test-Path -LiteralPath $health)) { throw 'BROKER_HEALTH_MISSING' }
  $healthObj = Get-Content -LiteralPath $health -Raw | ConvertFrom-Json
  if ($healthObj.status -ne 'READY' -or $healthObj.run_as -ne 'NT AUTHORITY\SYSTEM') { throw 'BROKER_HEALTH_INVALID' }

  if (Test-Path -LiteralPath $probeOut) { Remove-Item -LiteralPath $probeOut -Force }
  $probeAction = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument ('"'+(Join-Path $install 'tests\live-status-smoke.mjs')+'" "'+$probeOut+'"')
  $probePrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\NETWORK SERVICE' -LogonType ServiceAccount -RunLevel Limited
  Register-ScheduledTask -TaskName $probeTask -Action $probeAction -Principal $probePrincipal | Out-Null
  Start-ScheduledTask -TaskName $probeTask
  $deadline = (Get-Date).AddSeconds(30)
  do { Start-Sleep -Milliseconds 250; $probeState=(Get-ScheduledTask -TaskName $probeTask).State } while ($probeState -eq 'Running' -and (Get-Date) -lt $deadline)
  $probeInfo = Get-ScheduledTaskInfo -TaskName $probeTask
  Unregister-ScheduledTask -TaskName $probeTask -Confirm:$false
  if ($probeInfo.LastTaskResult -ne 0 -or -not (Test-Path -LiteralPath $probeOut)) { throw 'LIVE_STATUS_PROBE_FAILED' }
  $probe = Get-Content -LiteralPath $probeOut -Raw | ConvertFrom-Json
  if ($probe.result -ne 'PASS') { throw 'LIVE_STATUS_PROBE_NOT_PASS' }

  [ordered]@{
    result='PASS'
    broker_task=(Get-ScheduledTask -TaskName $brokerTask).State.ToString()
    tunnel_task=(Get-ScheduledTask -TaskName $tunnelTask).State.ToString()
    runtime_exe_sha256=(Get-FileHash -LiteralPath (Join-Path $tunnel 'tunnel-client.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    doctor_exe_sha256=(Get-FileHash -LiteralPath (Join-Path $doctorClient 'tunnel-client.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    broker_health=$healthObj
    live_probe=$probe
  } | ConvertTo-Json -Depth 8 -Compress
} catch {
  foreach ($name in @($probeTask,$tunnelTask,$brokerTask)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    }
  }
  throw
}
