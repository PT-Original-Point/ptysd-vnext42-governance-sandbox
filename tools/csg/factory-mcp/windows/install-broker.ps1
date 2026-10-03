[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$ProjectId,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')][string]$HostId = $env:COMPUTERNAME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrEmpty($env:COMPUTERNAME) -or $HostId -cne $env:COMPUTERNAME) { throw 'INSTALL_HOST_SCOPE_MISMATCH' }

$base = 'C:\ProgramData\PTYSD\MCP'
$install = Join-Path $base 'FactoryMCP'
$repairRoot = Join-Path $base 'Repair'
$repairScriptRelative = 'windows\repair-factory-mcp.ps1'
$repairManifestRelative = 'windows\repair-manifest.json'
$tunnel = Join-Path $base 'tunnel\v0.0.14'
$doctorClient = Join-Path $base 'tunnel\full\v0.0.14'
$runtimeStaging = Join-Path $base 'staging\v0.0.14\runtime'
$fullStaging = Join-Path $base 'staging\v0.0.14\client'
$expectedRuntimeExeSha256 = '09eac072d392b8d27b7aea8cbc146ab3738934961278b6b69cb23513607a08d7'
$expectedDoctorExeSha256 = 'fcc85a69ec0ad82518e4f8964f60c45e31787957782a0fc9c1b0c44e82d61b9b'
$brokerTask = 'PTYSD-FactoryMCP-HostGuard-Broker-V47'
$tunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
$probeTask = 'PTYSD-FactoryMCP-Live-Probe-Temp'
$probeTaskSid = $null
$probeOut = Join-Path $base 'qualification\factory-mcp-live-status.json'
$trustedCallerHelperRelative = 'broker\trusted-caller-boundary.ps1'
$projectScopePath = Join-Path $base 'config\factory-mcp-project-scope.json'

function Test-FreshUtcTimestamp {
  param([Parameter(Mandatory)][string]$Value,[int]$MaximumAgeSeconds = 30)
  try { $observed = [DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind) }
  catch { return $false }
  if ($observed.Offset -ne [TimeSpan]::Zero) { return $false }
  $ageSeconds = ([DateTimeOffset]::UtcNow - $observed).TotalSeconds
  return ($ageSeconds -ge 0 -and $ageSeconds -le $MaximumAgeSeconds)
}

function Test-OwnerLivenessBoundedValue {
  param([Parameter(Mandatory)][string]$Value,[Parameter(Mandatory)][string]$Pattern,[Parameter(Mandatory)][int]$MaximumLength)
  return ($Value.Length -gt 0 -and $Value.Length -le $MaximumLength -and $Value -match $Pattern)
}

function Assert-ReadyBrokerHealth {
  param([Parameter(Mandatory)]$Health)
  if ($Health.status -cne 'READY' -or $Health.run_as -cne 'NT AUTHORITY\SYSTEM') { throw 'BROKER_HEALTH_INVALID' }
  if ($Health.powershell_exec -ne $true -or [string]$Health.host_exec_helper_sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'BROKER_HOST_EXEC_CAPABILITY_INVALID' }
  if ([string]$Health.host_exec_helper_sha256 -cne $hostExecHelperInstalledSha) { throw 'BROKER_HOST_EXEC_HELPER_HASH_MISMATCH' }
  if (-not (Test-FreshUtcTimestamp -Value ([string]$Health.recorded_at_utc))) { throw 'BROKER_HEALTH_STALE' }
  if ([string]$Health.owner_liveness_publisher_status -cnotin @('PUBLISHED','SOURCE_MISSING','SOURCE_INVALID','SOURCE_STALE')) { throw 'BROKER_OWNER_LIVENESS_PUBLISHER_NOT_READY' }
}

function Get-VerifiedBrokerTaskState {
  param([Parameter(Mandatory)][string]$TaskName)
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ([string]$task.State -cne 'Running' -or $task.Settings.Enabled -ne $true) { throw 'BROKER_TASK_NOT_RUNNING' }
  if ([string]$task.Principal.UserId -cnotin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18')) { throw 'BROKER_TASK_PRINCIPAL_INVALID' }
  return [string]$task.State
}

foreach ($name in @($brokerTask,$tunnelTask,$probeTask)) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw ('TASK_ALREADY_EXISTS:' + $name) }
}
if (Test-Path -LiteralPath $install) { throw 'INSTALL_ROOT_ALREADY_EXISTS' }
if (Test-Path -LiteralPath $repairRoot) { throw 'REPAIR_ROOT_ALREADY_EXISTS' }
if (Test-Path -LiteralPath $projectScopePath) { throw 'PROJECT_SCOPE_ALREADY_EXISTS' }

$required = @(
  'package.json',
  'package-lock.json',
  'src\index.mjs',
  'src\project-scope.mjs',
  'src\invoke-hostguard.ps1',
  'src\readonly-diagnostics.mjs',
  'src\readonly-diagnostics.ps1',
  'broker\hostguard-broker.ps1',
  'broker\host-powershell-exec.ps1',
  $trustedCallerHelperRelative,
  'broker\owner-liveness-publisher.ps1',
  'tests\live-status-smoke.mjs',
  'tests\official-inspector-equivalence.mjs',
  'tests\host-powershell-exec-smoke.ps1',
  'tests\capability-parity.test.mjs',
  'tests\fixtures\installed-runtime-capability-baseline.json',
  'tests\fixtures\candidate-runtime-capability-matrix.json',
  'tests\read-only-diagnostics.test.mjs',
  'tests\project-scope.test.mjs',
  'tests\owner-liveness-publisher.test.mjs',
  'tests\owner-liveness-e2e.test.mjs',
  'tests\trusted-caller-boundary.test.mjs',
  'tests\tunnel-preflight-negative.ps1',
  'tests\credential-ingest-smoke.ps1',
  'tests\trusted-caller-boundary-smoke.ps1',
  'tests\repair-lane.test.mjs',
  'tests\repair-lane-smoke.ps1',
  $repairScriptRelative,
  $repairManifestRelative,
  'windows\qualify-tunnel.ps1',
  'windows\import-tunnel-credentials.ps1',
  'windows\run-tunnel.ps1',
  'windows\factory-mcp-tunnel.template.yaml'
)
foreach ($rel in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot $rel))) { throw ('SOURCE_FILE_MISSING:' + $rel) }
}
. (Join-Path $SourceRoot $trustedCallerHelperRelative)
. (Join-Path $SourceRoot $repairScriptRelative)
$repairManifestPath = Join-Path $SourceRoot $repairManifestRelative
$repairManifestText = [IO.File]::ReadAllText($repairManifestPath)
$repairManifestSha256 = (Get-FileHash -LiteralPath $repairManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($repairManifestSha256 -cne (Get-FactoryMcpRepairManifestSha256)) { throw 'REPAIR_MANIFEST_DIGEST_MISMATCH' }
$repairManifest = Assert-FactoryMcpRepairManifest -JsonText $repairManifestText -ExpectedSha256 $repairManifestSha256
$repairCanaryRelative = ([string]$repairManifest.canary.relative_path -replace '/', '\')
if ($repairCanaryRelative -cnotin $required) { throw 'REPAIR_CANARY_NOT_PACKAGED' }
$repairCanarySource = Join-Path $SourceRoot $repairCanaryRelative
if (-not (Test-Path -LiteralPath $repairCanarySource -PathType Leaf)) { throw 'REPAIR_CANARY_SOURCE_MISSING' }
if ((Get-FileHash -LiteralPath $repairCanarySource -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$repairManifest.canary.sha256) {
  throw 'REPAIR_CANARY_PAYLOAD_DIGEST_MISMATCH'
}
foreach ($entry in @($repairManifest.files)) {
  $payloadSource = Join-Path $SourceRoot ([string]$entry.relative_path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $payloadSource -PathType Leaf)) { throw ('REPAIR_PAYLOAD_SOURCE_MISSING:' + [string]$entry.relative_path) }
  if (([IO.File]::GetAttributes($payloadSource) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('REPAIR_PAYLOAD_SOURCE_REPARSE:' + [string]$entry.relative_path) }
  if ((Get-FileHash -LiteralPath $payloadSource -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256) { throw ('REPAIR_PAYLOAD_DIGEST_MISMATCH:' + [string]$entry.relative_path) }
}
[void](Assert-FactoryMcpRepairSafePathAncestors -Path $base)
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
  $hostExecHelperRelative = 'broker\host-powershell-exec.ps1'
  $hostExecHelperSourceSha = (Get-FileHash -LiteralPath (Join-Path $SourceRoot $hostExecHelperRelative) -Algorithm SHA256).Hash.ToLowerInvariant()
  $hostExecHelperInstalledSha = (Get-FileHash -LiteralPath (Join-Path $install $hostExecHelperRelative) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hostExecHelperInstalledSha -cne $hostExecHelperSourceSha) { throw 'HOST_EXEC_HELPER_INSTALL_READBACK_MISMATCH' }
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

  $repairPayloadRoot = Join-Path $repairRoot 'payload'
  New-Item -ItemType Directory -Path $repairRoot -Force | Out-Null
  & icacls.exe $repairRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_DIRECTORY_ACL_FAILED' }
  & icacls.exe $repairRoot /setowner '*S-1-5-18' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_DIRECTORY_OWNER_FAILED' }
  New-Item -ItemType Directory -Path $repairPayloadRoot -Force | Out-Null
  & icacls.exe $repairPayloadRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_DIRECTORY_ACL_FAILED' }
  & icacls.exe $repairPayloadRoot /setowner '*S-1-5-18' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_DIRECTORY_OWNER_FAILED' }
  Copy-Item -LiteralPath (Join-Path $SourceRoot $repairScriptRelative) -Destination (Join-Path $repairRoot 'repair-factory-mcp.ps1') -Force
  Copy-Item -LiteralPath $repairManifestPath -Destination (Join-Path $repairRoot 'qualified-manifest.json') -Force
  foreach ($entry in @($repairManifest.files)) {
    $rel = [string]$entry.relative_path
    $source = Join-Path $SourceRoot ($rel -replace '/', '\')
    $destination = Join-Path $repairPayloadRoot ($rel -replace '/', '\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
  $repairDirectories = @((Get-Item -LiteralPath $repairRoot)) + @(Get-ChildItem -LiteralPath $repairRoot -Directory -Recurse -Force | Sort-Object { $_.FullName.Length })
  foreach ($directory in $repairDirectories) {
    if (([IO.File]::GetAttributes($directory.FullName) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_STAGE_REPARSE_POINT' }
    & icacls.exe $directory.FullName /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_DIRECTORY_ACL_FAILED' }
    & icacls.exe $directory.FullName /setowner '*S-1-5-18' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_DIRECTORY_OWNER_FAILED' }
  }
  $repairFiles = @((Get-Item -LiteralPath (Join-Path $repairRoot 'repair-factory-mcp.ps1')),(Get-Item -LiteralPath (Join-Path $repairRoot 'qualified-manifest.json'))) + @(Get-ChildItem -LiteralPath $repairPayloadRoot -File -Recurse -Force)
  foreach ($file in $repairFiles) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_STAGE_REPARSE_POINT' }
    & icacls.exe $file.FullName /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_FILE_ACL_FAILED' }
    & icacls.exe $file.FullName /setowner '*S-1-5-18' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'REPAIR_STAGE_FILE_OWNER_FAILED' }
    [void](Assert-FactoryMcpRepairProtectedPath -Path $file.FullName)
  }
  [void](Assert-FactoryMcpRepairProtectedPath -Path $repairRoot -Directory)
  [void](Assert-FactoryMcpRepairProtectedPath -Path $repairPayloadRoot -Directory)
  $stagedManifest = Join-Path $repairRoot 'qualified-manifest.json'
  if ((Get-FileHash -LiteralPath $stagedManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne (Get-FactoryMcpRepairManifestSha256)) { throw 'REPAIR_MANIFEST_DIGEST_MISMATCH' }
  foreach ($entry in @($repairManifest.files)) {
    $staged = Join-Path $repairPayloadRoot ([string]$entry.relative_path -replace '/', '\')
    if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256) { throw ('REPAIR_PAYLOAD_DIGEST_MISMATCH:' + [string]$entry.relative_path) }
    [void](Assert-FactoryMcpRepairProtectedPath -Path $staged)
  }

  & icacls.exe $install /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)RX' | Out-Null
  foreach ($q in @('queue\inbox','queue\processing','queue\outbox','state')) {
    Set-FactoryDirectoryAcl -Path (Join-Path $install $q) -Mode SYSTEM_ONLY | Out-Null
  }
  foreach ($path in @((Join-Path $base 'state'),(Join-Path $base 'logs'),(Join-Path $base 'qualification'),(Join-Path $base 'secrets'),(Join-Path $base 'config'),$tunnel,$doctorClient)) {
    Set-FactoryDirectoryAcl -Path $path -Mode SYSTEM_ONLY | Out-Null
  }
  & icacls.exe (Join-Path $base 'run-factory-mcp-tunnel.ps1') /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' | Out-Null
  & icacls.exe (Join-Path $base 'import-factory-mcp-credentials.ps1') /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' | Out-Null

  $brokerAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $install 'broker\hostguard-broker.ps1')+'"')
  $brokerTrigger = New-ScheduledTaskTrigger -AtStartup
  $brokerPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $brokerSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $brokerTask -Action $brokerAction -Trigger $brokerTrigger -Principal $brokerPrincipal -Settings $brokerSettings | Out-Null
  $createdTasks += $brokerTask

  $tunnelAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $base 'run-factory-mcp-tunnel.ps1')+'"')
  $tunnelTrigger = New-ScheduledTaskTrigger -AtStartup
  $tunnelPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\NETWORK SERVICE' -LogonType ServiceAccount -RunLevel Limited -ProcessTokenSidType Unrestricted
  $tunnelSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $tunnelTask -Action $tunnelAction -Trigger $tunnelTrigger -Principal $tunnelPrincipal -Settings $tunnelSettings | Out-Null
  $createdTasks += $tunnelTask
  Disable-ScheduledTask -TaskName $tunnelTask | Out-Null
  $tunnelTaskSid = Get-FactoryScheduledTaskSid -TaskName $tunnelTask
  $projectScopeText = [ordered]@{
    schema='v52.factory-mcp.project-scope.v1'
    project_id=$ProjectId
    host_id=$HostId
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($projectScopePath,$projectScopeText,(New-Object Text.UTF8Encoding($false)))
  & icacls.exe $projectScopePath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' ('*' + $tunnelTaskSid + ':R') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PROJECT_SCOPE_ACL_SET_FAILED' }
  & icacls.exe $projectScopePath /setowner '*S-1-5-18' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PROJECT_SCOPE_OWNER_SET_FAILED' }
  $scopeReadback = Read-FactoryProjectScope -TunnelTaskSid $tunnelTaskSid
  if ([string]$scopeReadback.project_id -cne $ProjectId -or [string]$scopeReadback.host_id -cne $HostId) { throw 'PROJECT_SCOPE_READBACK_MISMATCH' }
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'queue\inbox') -TaskSid @($tunnelTaskSid) -Mode MODIFY | Out-Null
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'queue\outbox') -TaskSid @($tunnelTaskSid) -Mode MODIFY | Out-Null
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'state') -TaskSid @($tunnelTaskSid) -Mode RX | Out-Null
  foreach ($path in @((Join-Path $base 'state'),(Join-Path $base 'logs'))) {
    Set-FactoryDirectoryAcl -Path $path -TaskSid @($tunnelTaskSid) -Mode MODIFY | Out-Null
  }
  foreach ($path in @((Join-Path $base 'secrets'),(Join-Path $base 'config'))) {
    Set-FactoryDirectoryAcl -Path $path -TaskSid @($tunnelTaskSid) -Mode READ | Out-Null
  }
  foreach ($path in @($tunnel,$doctorClient,(Join-Path $base 'run-factory-mcp-tunnel.ps1'))) {
    if ($path.EndsWith('.ps1',[StringComparison]::OrdinalIgnoreCase)) {
      & icacls.exe $path /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' ('*' + $tunnelTaskSid + ':RX') | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'TRUSTED_TUNNEL_SCRIPT_ACL_SET_FAILED' }
    } else { Set-FactoryDirectoryAcl -Path $path -TaskSid @($tunnelTaskSid) -Mode RX | Out-Null }
  }

  Start-ScheduledTask -TaskName $brokerTask
  $health = Join-Path $install 'state\broker-health.json'
  $deadline = (Get-Date).AddSeconds(15)
  do { Start-Sleep -Milliseconds 250 } while (-not (Test-Path -LiteralPath $health) -and (Get-Date) -lt $deadline)
  if (-not (Test-Path -LiteralPath $health)) { throw 'BROKER_HEALTH_MISSING' }
  $healthObj = Get-Content -LiteralPath $health -Raw | ConvertFrom-Json
  [void](Get-VerifiedBrokerTaskState -TaskName $brokerTask)
  Assert-ReadyBrokerHealth -Health $healthObj

  if (Test-Path -LiteralPath $probeOut) { Remove-Item -LiteralPath $probeOut -Force }
  $probeAction = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument ('"'+(Join-Path $install 'tests\live-status-smoke.mjs')+'" "'+$probeOut+'"')
  $probePrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\NETWORK SERVICE' -LogonType ServiceAccount -RunLevel Limited -ProcessTokenSidType Unrestricted
  Register-ScheduledTask -TaskName $probeTask -Action $probeAction -Principal $probePrincipal | Out-Null
  $probeTaskSid = Get-FactoryScheduledTaskSid -TaskName $probeTask
  & icacls.exe $projectScopePath /grant ('*' + $probeTaskSid + ':R') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PROJECT_SCOPE_PROBE_READ_GRANT_FAILED' }
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'queue\inbox') -TaskSid @($tunnelTaskSid,$probeTaskSid) -Mode MODIFY | Out-Null
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'queue\outbox') -TaskSid @($tunnelTaskSid,$probeTaskSid) -Mode MODIFY | Out-Null
  Set-FactoryDirectoryAcl -Path (Join-Path $base 'qualification') -TaskSid @($probeTaskSid) -Mode MODIFY | Out-Null
  Start-ScheduledTask -TaskName $probeTask
  $deadline = (Get-Date).AddSeconds(30)
  do { Start-Sleep -Milliseconds 250; $probeState=(Get-ScheduledTask -TaskName $probeTask).State } while ($probeState -eq 'Running' -and (Get-Date) -lt $deadline)
  $probeInfo = Get-ScheduledTaskInfo -TaskName $probeTask
  Unregister-ScheduledTask -TaskName $probeTask -Confirm:$false
  & icacls.exe $projectScopePath /remove:g ('*' + $probeTaskSid) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PROJECT_SCOPE_PROBE_READ_REVOKE_FAILED' }
  $probeTaskSid = $null
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'queue\inbox') -TaskSid @($tunnelTaskSid) -Mode MODIFY | Out-Null
  Set-FactoryDirectoryAcl -Path (Join-Path $install 'queue\outbox') -TaskSid @($tunnelTaskSid) -Mode MODIFY | Out-Null
  Set-FactoryDirectoryAcl -Path (Join-Path $base 'qualification') -Mode SYSTEM_ONLY | Out-Null
  if ($probeInfo.LastTaskResult -ne 0 -or -not (Test-Path -LiteralPath $probeOut)) { throw 'LIVE_STATUS_PROBE_FAILED' }
  $probe = Get-Content -LiteralPath $probeOut -Raw | ConvertFrom-Json
  if ($probe.result -ne 'PASS') { throw 'LIVE_STATUS_PROBE_NOT_PASS' }
  if ($probe.owner_liveness_publisher_status -notin @('PUBLISHED','SOURCE_MISSING','SOURCE_INVALID','SOURCE_STALE') -or
      $probe.owner_liveness_read_status -notin @('AVAILABLE','UNAVAILABLE','INVALID','STALE')) {
    throw 'LIVE_STATUS_OWNER_LIVENESS_READBACK_INVALID'
  }
  if ($probe.owner_liveness_publisher_status -ceq 'PUBLISHED') {
    $ownerReadback = $probe.owner_liveness_readback
    if ($null -eq $ownerReadback -or [string]$ownerReadback.reconciliation_verdict -cne 'NOT_PERFORMED') {
      throw 'LIVE_STATUS_OWNER_LIVENESS_VERDICT_INVALID'
    }
    if ([string]$ownerReadback.source -ceq 'system-broker-fixed-owner-liveness-collector') {
      if ([string]$ownerReadback.os_process_identity_link_status -cne 'UNRESOLVED' -or
          [string]$ownerReadback.provider_session_state -cne 'UNAVAILABLE' -or
          [string]$ownerReadback.provider_session_unavailability_reason -cne 'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED' -or
          [string]$ownerReadback.supervisor_heartbeat_state -cne 'UNAVAILABLE' -or
          [string]$ownerReadback.supervisor_unavailability_reason -cne 'SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED' -or
          [string]$ownerReadback.supervisor_task_read_status -notin @('PRESENT','UNAVAILABLE') -or
          -not (Test-FreshUtcTimestamp -Value ([string]$ownerReadback.supervisor_task_observed_at_utc))) {
        throw 'LIVE_STATUS_PARTIAL_OWNER_OBSERVATION_INVALID'
      }
      if ([string]$ownerReadback.supervisor_task_read_status -ceq 'PRESENT') {
        if ([string]$ownerReadback.supervisor_task_name -cne 'PTYSD-VNext42-Supervisor-Candidate1' -or
            -not (Test-OwnerLivenessBoundedValue ([string]$ownerReadback.supervisor_task_state) '^[A-Za-z0-9._-]{1,64}$' 64) -or
            $ownerReadback.supervisor_task_enabled -isnot [bool] -or
            -not (Test-OwnerLivenessBoundedValue ([string]$ownerReadback.supervisor_task_principal) '^[A-Za-z0-9 _\\.-]{1,128}$' 128)) {
          throw 'LIVE_STATUS_SUPERVISOR_TASK_OBSERVATION_INVALID'
        }
      } elseif ($null -ne $ownerReadback.supervisor_task_name -or $null -ne $ownerReadback.supervisor_task_state -or
          $null -ne $ownerReadback.supervisor_task_enabled -or $null -ne $ownerReadback.supervisor_task_principal) {
        throw 'LIVE_STATUS_SUPERVISOR_TASK_OBSERVATION_INVALID'
      }
    } elseif ([string]$ownerReadback.source -cne 'authorized-cross-source-liveness-readback') {
      throw 'LIVE_STATUS_OWNER_LIVENESS_SOURCE_INVALID'
    }
  }
  if (-not (Test-FreshUtcTimestamp -Value ([string]$probe.broker_recorded_at_utc)) -or
      -not (Test-FreshUtcTimestamp -Value ([string]$probe.owner_liveness_publisher_observed_at_utc)) -or
      [string]$probe.broker_task_state -cne 'Running' -or [int]$probe.broker_pid -ne [int]$probe.broker_process_pid) {
    throw 'LIVE_STATUS_BROKER_OR_PUBLISHER_STALE'
  }
  $brokerTaskState = Get-VerifiedBrokerTaskState -TaskName $brokerTask
  $healthObj = Get-Content -LiteralPath $health -Raw | ConvertFrom-Json
  Assert-ReadyBrokerHealth -Health $healthObj
  if ([int]$healthObj.pid -ne [int]$probe.broker_pid) { throw 'BROKER_PROCESS_CHANGED_DURING_LIVE_PROBE' }

  [ordered]@{
    result='PASS'
    broker_task=$brokerTaskState
    tunnel_task=(Get-ScheduledTask -TaskName $tunnelTask).State.ToString()
    runtime_exe_sha256=(Get-FileHash -LiteralPath (Join-Path $tunnel 'tunnel-client.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    doctor_exe_sha256=(Get-FileHash -LiteralPath (Join-Path $doctorClient 'tunnel-client.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    broker_health=$healthObj
    host_exec_helper_sha256=$hostExecHelperInstalledSha
    trusted_caller_task_sid=$tunnelTaskSid
    queue_acl_status='TASK_SID_ONLY'
    live_probe=$probe
  } | ConvertTo-Json -Depth 8 -Compress
} catch {
  if ($probeTaskSid -and (Test-Path -LiteralPath $projectScopePath)) {
    & icacls.exe $projectScopePath /remove:g ('*' + $probeTaskSid) | Out-Null
  }
  foreach ($name in @($probeTask,$tunnelTask,$brokerTask)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    }
  }
  throw
}
