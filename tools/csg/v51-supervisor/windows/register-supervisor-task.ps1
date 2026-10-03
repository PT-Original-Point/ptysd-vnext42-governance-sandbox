#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$PackageRoot,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{64}$')]
  [string]$ExpectedManifestSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Registration([string]$Code) {
  throw [System.InvalidOperationException]::new($Code)
}

function Get-RelativePackageFile([string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($RelativePath) -or $RelativePath.Contains('\') -or
      $RelativePath.StartsWith('/') -or
      @($RelativePath.Split('/')) -contains '..' -or
      @($RelativePath.Split('/')) -contains '.') {
    Stop-Registration 'SUPERVISOR_PACKAGE_PATH_INVALID'
  }
  $resolved = [System.IO.Path]::GetFullPath((Join-Path $script:ResolvedRoot ($RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))))
  if (-not $resolved.StartsWith($script:ResolvedRoot + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Registration 'SUPERVISOR_PACKAGE_PATH_ESCAPE'
  }
  $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $item.PSIsContainer) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Stop-Registration 'SUPERVISOR_PACKAGE_REPARSE_POINT'
    }
  }
  return $resolved
}

function Assert-PackageAcl([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  if ($acl.Owner -notin @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    Stop-Registration 'SUPERVISOR_PACKAGE_OWNER_INVALID'
  }
  $untrustedSids = @('S-1-5-19', 'S-1-5-32-545', 'S-1-1-0', 'S-1-5-11')
  $writeRights = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::Modify -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor
    [System.Security.AccessControl.FileSystemRights]::FullControl
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
    $sid = $null
    try { $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { }
    if ($sid -in $untrustedSids -and ($rule.FileSystemRights -band $writeRights) -ne 0) {
      Stop-Registration 'SUPERVISOR_PACKAGE_WRITABLE_BY_UNTRUSTED_PRINCIPAL'
    }
  }
}

function Test-ScheduledTaskMatchesContract($Task, [string]$NodePath, [string]$ArgumentText, [string]$WorkingDirectory) {
  if ($null -eq $Task -or @($Task.Actions).Count -ne 1 -or @($Task.Triggers).Count -ne 1) { return $false }
  $actionsMatch = [string]::Equals([string]$Task.Actions[0].Execute, $NodePath, [System.StringComparison]::OrdinalIgnoreCase) -and
    [string]::Equals([string]$Task.Actions[0].Arguments, $ArgumentText, [System.StringComparison]::Ordinal) -and
    [string]::Equals([string]$Task.Actions[0].WorkingDirectory, $WorkingDirectory, [System.StringComparison]::OrdinalIgnoreCase)
  $identityMatch = [string]::Equals([string]$Task.Principal.UserId, 'NT AUTHORITY\LOCAL SERVICE', [System.StringComparison]::OrdinalIgnoreCase) -and
    [string]$Task.Principal.LogonType -eq 'ServiceAccount' -and [string]$Task.Principal.RunLevel -eq 'Limited'
  $triggerMatch = [string]$Task.Triggers[0].CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' -and
    [string]$Task.Triggers[0].Delay -eq 'PT30S'
  $settingsMatch = $Task.Settings.StartWhenAvailable -eq $true -and
    $Task.Settings.DisallowStartIfOnBatteries -eq $false -and
    $Task.Settings.StopIfGoingOnBatteries -eq $false -and
    [string]$Task.Settings.MultipleInstances -eq 'IgnoreNew' -and
    [string]$Task.Settings.ExecutionTimeLimit -eq 'PT0S' -and
    [int]$Task.Settings.RestartCount -eq 255 -and
    [string]$Task.Settings.RestartInterval -eq 'PT1M'
  $enabled = [string]$Task.State -in @('Ready', 'Running')
  return $actionsMatch -and $identityMatch -and $triggerMatch -and $settingsMatch -and $enabled
}

$expectedRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'CSG\VNEXT5.1-R2-Supervisor'
$script:ResolvedRoot = [System.IO.Path]::GetFullPath($PackageRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if (-not [string]::Equals($script:ResolvedRoot, [System.IO.Path]::GetFullPath($expectedRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar),
    [System.StringComparison]::OrdinalIgnoreCase)) {
  Stop-Registration 'SUPERVISOR_INSTALL_ROOT_NOT_ALLOWLISTED'
}
$rootItem = Get-Item -LiteralPath $script:ResolvedRoot -Force -ErrorAction Stop
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  Stop-Registration 'SUPERVISOR_INSTALL_ROOT_INVALID'
}
Assert-PackageAcl -Path $script:ResolvedRoot

$profilePath = Join-Path $script:ResolvedRoot 'windows\supervisor-task-profile.json'
$manifestPath = Join-Path $script:ResolvedRoot 'install-manifest.json'
if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  Stop-Registration 'SUPERVISOR_INSTALL_MANIFEST_OR_PROFILE_MISSING'
}
Assert-PackageAcl -Path $profilePath
Assert-PackageAcl -Path $manifestPath
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifestHash -cne $ExpectedManifestSha256) { Stop-Registration 'SUPERVISOR_INSTALL_MANIFEST_HASH_MISMATCH' }
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json -ErrorAction Stop
$expectedArguments = @('--project-id', 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', '--locator', 'refs/heads/governance/project-directory')
if ($profile.schema -cne 'VNEXT5_1_R2_SUPERVISOR_TASK_PROFILE_V1' -or
    $profile.task_name -cne 'VNEXT5.1-R2-Supervisor' -or $profile.task_path -cne '\' -or
    $profile.principal.user_id -cne 'NT AUTHORITY\LOCAL SERVICE' -or
    $profile.principal.logon_type -cne 'ServiceAccount' -or $profile.principal.run_level -cne 'Limited' -or
    $profile.trigger.kind -cne 'AtStartup' -or $profile.trigger.random_delay_seconds -ne 30 -or
    $profile.action.node_executable_relative_path -cne 'runtime/node.exe' -or
    $profile.action.entrypoint_relative_path -cne 'bin/host-supervisor.mjs' -or
    $profile.action.working_directory -cne '.' -or
    (ConvertTo-Json -InputObject @($profile.action.arguments) -Compress) -cne (ConvertTo-Json -InputObject $expectedArguments -Compress) -or
    $profile.settings.start_when_available -ne $true -or
    $profile.settings.allow_start_if_on_batteries -ne $true -or
    $profile.settings.stop_if_going_on_batteries -ne $false -or
    $profile.settings.multiple_instances -cne 'IgnoreNew' -or
    $profile.settings.execution_time_limit_seconds -ne 0 -or
    $profile.settings.restart_on_failure_count -ne 255 -or
    $profile.settings.restart_interval_seconds -ne 60 -or
    $profile.candidate_only -ne $true -or
    $profile.host_effect -cne 'REGISTER_ONE_DEDICATED_SCHEDULED_TASK') {
  Stop-Registration 'SUPERVISOR_TASK_PROFILE_REJECTED'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
$requiredPaths = @($profile.action.node_executable_relative_path, $profile.action.entrypoint_relative_path,
  'windows/supervisor-task-profile.json')
$expectedHashes = @{}
foreach ($file in @($manifest.files)) {
  if ($null -eq $file -or $file.path -isnot [string] -or $file.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
      $expectedHashes.ContainsKey($file.path)) {
    Stop-Registration 'SUPERVISOR_INSTALL_MANIFEST_INVALID'
  }
  $expectedHashes[$file.path] = $file.sha256
}
foreach ($relativePath in $requiredPaths) {
  if (-not $expectedHashes.ContainsKey($relativePath)) { Stop-Registration 'SUPERVISOR_INSTALL_MANIFEST_COVERAGE_MISSING' }
  $filePath = Get-RelativePackageFile -RelativePath $relativePath
  Assert-PackageAcl -Path $filePath
  $observedHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($observedHash -cne $expectedHashes[$relativePath]) { Stop-Registration 'SUPERVISOR_PACKAGE_FILE_HASH_MISMATCH' }
}

$taskName = [string]$profile.task_name
$existingTask = Get-ScheduledTask -TaskName $taskName -TaskPath ([string]$profile.task_path) -ErrorAction SilentlyContinue
$nodePath = Get-RelativePackageFile -RelativePath $profile.action.node_executable_relative_path
$entryPointPath = Get-RelativePackageFile -RelativePath $profile.action.entrypoint_relative_path
$argumentText = '"' + $entryPointPath + '" --project-id CHATGPT_GLOBAL_SKILL_GOVERNANCE --locator refs/heads/governance/project-directory'
if ($null -ne $existingTask) {
  if (-not (Test-ScheduledTaskMatchesContract $existingTask $nodePath $argumentText $script:ResolvedRoot)) {
    Stop-Registration 'SUPERVISOR_TASK_NAME_COLLISION'
  }
  [pscustomobject]@{status='EXISTING_EXACT_TASK_READBACK';task_name=$taskName;task_path=$profile.task_path;principal=$existingTask.Principal.UserId;state=[string]$existingTask.State;action=$existingTask.Actions[0].Execute;arguments=$existingTask.Actions[0].Arguments} | ConvertTo-Json -Compress
  exit 0
}

$action = New-ScheduledTaskAction -Execute $nodePath -Argument $argumentText -WorkingDirectory $script:ResolvedRoot
$trigger = New-ScheduledTaskTrigger -AtStartup -RandomDelay ([TimeSpan]::FromSeconds(30))
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 255 -RestartInterval (New-TimeSpan -Minutes 1)
$null = Register-ScheduledTask -TaskName $taskName -TaskPath ([string]$profile.task_path) -Action $action `
  -Trigger $trigger -Principal $principal -Settings $settings -Description 'VNEXT5.1-R2 durable read/reconcile Supervisor' -ErrorAction Stop
$readback = Get-ScheduledTask -TaskName $taskName -TaskPath ([string]$profile.task_path) -ErrorAction Stop
if (-not (Test-ScheduledTaskMatchesContract $readback $nodePath $argumentText $script:ResolvedRoot)) {
  Stop-Registration 'SUPERVISOR_TASK_SAME_SOURCE_READBACK_MISMATCH'
}
[pscustomobject]@{status='REGISTERED_AND_READ_BACK';task_name=$taskName;task_path=$profile.task_path;principal=$readback.Principal.UserId;state=[string]$readback.State;action=$readback.Actions[0].Execute;arguments=$readback.Actions[0].Arguments;manifest_sha256=$manifestHash} | ConvertTo-Json -Compress
