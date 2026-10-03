[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utilityModule = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'
if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) { Import-Module -Name $utilityModule -ErrorAction Stop }
if (-not (Get-Command Get-Acl -ErrorAction SilentlyContinue)) {
  $securityModule = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
  Import-Module -Name $securityModule -ErrorAction Stop
}

$script:factoryMcpRepairRoot = 'C:\ProgramData\PTYSD\MCP\Repair'
$script:factoryMcpRepairTargetRoot = 'C:\ProgramData\PTYSD\MCP\FactoryMCP'
$script:factoryMcpRepairManifestName = 'qualified-manifest.json'
$script:factoryMcpRepairManifestSha256 = 'f6fe178735228d3cdca07368c53d9c3bee9a29b99be84e2890db26f12b2a3bb8'
$script:factoryMcpRepairBrokerTask = 'PTYSD-FactoryMCP-HostGuard-Broker-V47'
$script:factoryMcpRepairTunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
$script:factoryMcpRepairCanaryRelativePath = 'tests/live-status-smoke.mjs'
$script:factoryMcpRepairAllowedTargets = @(
  'package.json',
  'package-lock.json',
  'src/index.mjs',
  'src/project-scope.mjs',
  'src/invoke-hostguard.ps1',
  'src/readonly-diagnostics.mjs',
  'src/shared-context.mjs',
  'src/readonly-diagnostics.ps1',
  'broker/hostguard-broker.ps1',
  'broker/host-powershell-exec.ps1',
  'broker/owner-liveness-publisher.ps1',
  'broker/trusted-caller-boundary.ps1',
  'windows/qualify-tunnel.ps1',
  'windows/import-tunnel-credentials.ps1',
  'windows/run-tunnel.ps1',
  'windows/factory-mcp-tunnel.template.yaml'
)

function Get-FactoryMcpRepairAllowedTargets {
  return @($script:factoryMcpRepairAllowedTargets)
}

function Get-FactoryMcpRepairManifestSha256 {
  return [string]$script:factoryMcpRepairManifestSha256
}

function Get-FactoryMcpRepairSha256 {
  param([Parameter(Mandatory)][byte[]]$Bytes)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function Test-FactoryMcpRepairWriteRights {
  param([Parameter(Mandatory)][string]$Sid,[Parameter(Mandatory)][Security.AccessControl.FileSystemRights]$Rights)

  if ($Sid -in @('S-1-5-18','S-1-5-32-544')) { return $false }
  $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
    [Security.AccessControl.FileSystemRights]::AppendData -bor
    [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  return (($Rights -band $writeMask) -ne 0)
}

function Assert-FactoryMcpRepairSafePathAncestors {
  param([Parameter(Mandatory)][string]$Path)

  $cursor = [IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $cursor -PathType Container)) { throw 'REPAIR_ANCESTOR_DIRECTORY_MISSING' }
  $trustedInstallerSid = $null
  try { $trustedInstallerSid = (New-Object Security.Principal.NTAccount('NT SERVICE','TrustedInstaller')).Translate([Security.Principal.SecurityIdentifier]).Value } catch {}
  while ($true) {
    if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_ANCESTOR_REPARSE_POINT' }
    $acl = Get-Acl -LiteralPath $cursor -ErrorAction Stop
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18','S-1-5-32-544',$trustedInstallerSid)) { throw 'REPAIR_ANCESTOR_OWNER_INVALID' }
    $fullControl = @{}
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'REPAIR_ANCESTOR_DENY_RULE_UNEXPECTED' }
      if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
      if (Test-FactoryMcpRepairWriteRights -Sid $sid -Rights $rights) { throw 'REPAIR_ANCESTOR_UNTRUSTED_WRITE_ACCESS' }
      if ($sid -in @('S-1-5-18','S-1-5-32-544') -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) {
        $fullControl[$sid] = $true
      }
    }
    if (-not $fullControl['S-1-5-18'] -or -not $fullControl['S-1-5-32-544']) { throw 'REPAIR_ANCESTOR_ADMIN_ACL_MISSING' }
    $parent = Split-Path -Parent $cursor
    if ([string]::IsNullOrEmpty($parent) -or [string]::Equals($parent,$cursor,[StringComparison]::OrdinalIgnoreCase)) { break }
    $cursor = $parent
  }
}

function Assert-FactoryMcpRepairNoReparseAncestors {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$Root)

  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $fullPath = [IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith(($fullRoot + [IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)) {
    throw 'REPAIR_TARGET_PATH_ESCAPE'
  }
  $cursor = $fullPath
  while ($cursor.StartsWith(($fullRoot + [IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $cursor) {
      $attributes = [IO.File]::GetAttributes($cursor)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_PATH_REPARSE_POINT' }
    }
    $cursor = Split-Path -Parent $cursor
  }
  if (-not [string]::Equals($cursor,$fullRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'REPAIR_TARGET_PATH_ESCAPE' }
}

function Assert-FactoryMcpRepairManifest {
  param(
    [Parameter(Mandatory)][string]$JsonText,
    [Parameter(Mandatory)][string]$ExpectedSha256
  )

  if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'REPAIR_MANIFEST_TRUST_PIN_INVALID' }
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($JsonText)
  $actualSha256 = Get-FactoryMcpRepairSha256 -Bytes $bytes
  if ($actualSha256 -cne $ExpectedSha256) { throw 'REPAIR_MANIFEST_DIGEST_MISMATCH' }

  try { $manifest = $JsonText | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'REPAIR_MANIFEST_JSON_INVALID' }
  $expectedProperties = @('schema','project_scope_mode','release_version','files','restart_tasks','canary')
  $actualProperties = @($manifest.PSObject.Properties.Name | Sort-Object -CaseSensitive)
  if (Compare-Object -ReferenceObject ($expectedProperties | Sort-Object -CaseSensitive) -DifferenceObject $actualProperties -CaseSensitive) {
    throw 'REPAIR_MANIFEST_FIELDS_INVALID'
  }
  if ([string]$manifest.schema -cne 'v51.factory-mcp.repair-manifest.v1' -or
      [string]$manifest.project_scope_mode -cne 'PROTECTED_INSTALL_CONFIGURATION' -or
      [version]$manifest.release_version -lt [version]'0.2.3') {
    throw 'REPAIR_MANIFEST_IDENTITY_INVALID'
  }
  if ($null -eq $manifest.canary) { throw 'REPAIR_MANIFEST_CANARY_INVALID' }
  $canaryProperties = @($manifest.canary.PSObject.Properties.Name | Sort-Object -CaseSensitive)
  if (Compare-Object -ReferenceObject (@('id','relative_path','sha256') | Sort-Object -CaseSensitive) -DifferenceObject $canaryProperties -CaseSensitive) {
    throw 'REPAIR_MANIFEST_CANARY_INVALID'
  }
  if ([string]$manifest.canary.id -cne 'READ_ONLY_FACTORY_STATUS' -or
      [string]$manifest.canary.relative_path -cne $script:factoryMcpRepairCanaryRelativePath -or
      [string]$manifest.canary.sha256 -cnotmatch '^[0-9a-f]{64}$') {
    throw 'REPAIR_MANIFEST_CANARY_INVALID'
  }

  $expectedTasks = @($script:factoryMcpRepairBrokerTask,$script:factoryMcpRepairTunnelTask)
  if (@($manifest.restart_tasks).Count -ne $expectedTasks.Count -or
      (@($manifest.restart_tasks) -join '|') -cne ($expectedTasks -join '|')) {
    throw 'REPAIR_MANIFEST_RESTART_SCOPE_INVALID'
  }

  $allowed = @(Get-FactoryMcpRepairAllowedTargets)
  if (@($manifest.files).Count -ne $allowed.Count) { throw 'REPAIR_MANIFEST_TARGET_SET_INCOMPLETE' }
  $seen = @{}
  foreach ($entry in @($manifest.files)) {
    $entryProperties = @($entry.PSObject.Properties.Name | Sort-Object -CaseSensitive)
    if (Compare-Object -ReferenceObject (@('relative_path','sha256') | Sort-Object -CaseSensitive) -DifferenceObject $entryProperties -CaseSensitive) {
      throw 'REPAIR_MANIFEST_FILE_FIELDS_INVALID'
    }
    $relativePath = [string]$entry.relative_path
    if ($relativePath -cnotin $allowed -or $relativePath.Contains('\') -or $relativePath.Contains(':') -or $relativePath.Contains('..')) {
      throw 'REPAIR_MANIFEST_TARGET_NOT_ALLOWLISTED'
    }
    if ($seen.ContainsKey($relativePath)) { throw 'REPAIR_MANIFEST_DUPLICATE_TARGET' }
    if ([string]$entry.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'REPAIR_MANIFEST_FILE_DIGEST_INVALID' }
    $seen[$relativePath] = [string]$entry.sha256
  }
  foreach ($path in $allowed) { if (-not $seen.ContainsKey($path)) { throw 'REPAIR_MANIFEST_TARGET_SET_INCOMPLETE' } }
  return $manifest
}

function Assert-FactoryMcpRepairProtectedPath {
  param([Parameter(Mandatory)][string]$Path,[switch]$Directory)

  if ($Directory) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'REPAIR_PROTECTED_DIRECTORY_MISSING' }
  } elseif (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'REPAIR_PROTECTED_FILE_MISSING' }
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_PATH_REPARSE_POINT' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'REPAIR_PATH_OWNER_INVALID' }
  if ($Directory -and -not $acl.AreAccessRulesProtected) { throw 'REPAIR_DIRECTORY_INHERITANCE_ENABLED' }

  $fullControl = @{}
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'REPAIR_PATH_DENY_RULE_UNEXPECTED' }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin @('S-1-5-18','S-1-5-32-544')) { throw 'REPAIR_PATH_PRINCIPAL_UNEXPECTED' }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) { $fullControl[$sid] = $true }
  }
  if (-not $fullControl['S-1-5-18'] -or -not $fullControl['S-1-5-32-544']) { throw 'REPAIR_PATH_ADMIN_ACL_MISSING' }
  return $acl
}

function Get-FactoryMcpRepairPath {
  param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$RelativePath)

  if ($RelativePath -cnotin $script:factoryMcpRepairAllowedTargets) { throw 'REPAIR_MANIFEST_TARGET_NOT_ALLOWLISTED' }
  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $fullRoot -PathType Container)) { throw 'REPAIR_TARGET_ROOT_MISSING' }
  if (([IO.File]::GetAttributes($fullRoot) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_TARGET_ROOT_REPARSE_POINT' }
  $fullPath = [IO.Path]::GetFullPath((Join-Path $fullRoot ($RelativePath -replace '/', '\')))
  if (-not $fullPath.StartsWith(($fullRoot + [IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)) {
    throw 'REPAIR_TARGET_PATH_ESCAPE'
  }
  Assert-FactoryMcpRepairNoReparseAncestors -Path $fullPath -Root $fullRoot
  return $fullPath
}

function Assert-FactoryMcpRepairTargetFileAcl {
  param([Parameter(Mandatory)][string]$Path)

  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'REPAIR_TARGET_OWNER_INVALID' }
  $fullControl = @{}
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'REPAIR_TARGET_ACL_DENY_RULE_UNEXPECTED' }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-20')) { throw 'REPAIR_TARGET_ACL_PRINCIPAL_UNEXPECTED' }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if (Test-FactoryMcpRepairWriteRights -Sid $sid -Rights $rights) { throw 'REPAIR_TARGET_NETWORK_SERVICE_WRITE_ACCESS' }
    if ($sid -in @('S-1-5-18','S-1-5-32-544') -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) {
      $fullControl[$sid] = $true
    }
  }
  if (-not $fullControl['S-1-5-18'] -or -not $fullControl['S-1-5-32-544']) { throw 'REPAIR_TARGET_ADMIN_ACL_MISSING' }
  return $acl
}

function Assert-FactoryMcpRepairTargetDirectoryAcl {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'REPAIR_TARGET_DIRECTORY_MISSING' }
  if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_TARGET_REPARSE_POINT' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'REPAIR_TARGET_DIRECTORY_OWNER_INVALID' }
  $fullControl = @{}
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'REPAIR_TARGET_DIRECTORY_DENY_RULE_UNEXPECTED' }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-20')) { throw 'REPAIR_TARGET_DIRECTORY_PRINCIPAL_UNEXPECTED' }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if (Test-FactoryMcpRepairWriteRights -Sid $sid -Rights $rights) { throw 'REPAIR_TARGET_DIRECTORY_NETWORK_SERVICE_WRITE_ACCESS' }
    if ($sid -in @('S-1-5-18','S-1-5-32-544') -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) {
      $fullControl[$sid] = $true
    }
  }
  if (-not $fullControl['S-1-5-18'] -or -not $fullControl['S-1-5-32-544']) { throw 'REPAIR_TARGET_DIRECTORY_ADMIN_ACL_MISSING' }
  return $acl
}

function Copy-FactoryMcpRepairDurableBackup {
  param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Destination,[Parameter(Mandatory)][string]$ExpectedSha256)

  if (Test-Path -LiteralPath $Destination) { throw 'REPAIR_BACKUP_ALREADY_EXISTS' }
  $input = New-Object IO.FileStream($Source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    $output = New-Object IO.FileStream($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $input.CopyTo($output); $output.Flush($true) }
    finally { $output.Dispose() }
  } finally { $input.Dispose() }
  $backupSha256 = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($backupSha256 -cne $ExpectedSha256) { throw 'REPAIR_BACKUP_READBACK_MISMATCH' }
}

function Get-FactoryMcpRepairFileState {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [ordered]@{exists=$false;sha256=$null;owner_sid=$null;access_sddl=$null}
  }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_TARGET_REPARSE_POINT' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  return [ordered]@{
    exists=$true
    sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    owner_sid=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    access_sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  }
}

function Test-FactoryMcpRepairStateEquals {
  param([Parameter(Mandatory)]$Left,[Parameter(Mandatory)]$Right)
  if ([bool]$Left.exists -ne [bool]$Right.exists) { return $false }
  if (-not $Left.exists) { return $true }
  return ([string]$Left.sha256 -ceq [string]$Right.sha256 -and
          [string]$Left.owner_sid -ceq [string]$Right.owner_sid -and
          [string]$Left.access_sddl -ceq [string]$Right.access_sddl)
}

function Write-FactoryMcpRepairDurableJson {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$Value)

  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'REPAIR_RECEIPT_DIRECTORY_MISSING' }
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress))
  $tempPath = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  $stream = New-Object IO.FileStream($tempPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
  [IO.File]::Move($tempPath,$Path)
}

function Assert-FactoryMcpRepairTaskConfiguration {
  $broker = Get-ScheduledTask -TaskName $script:factoryMcpRepairBrokerTask -ErrorAction Stop
  $tunnel = Get-ScheduledTask -TaskName $script:factoryMcpRepairTunnelTask -ErrorAction Stop
  if ([string]$broker.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or $broker.Settings.Enabled -ne $true) {
    throw 'REPAIR_BROKER_TASK_SCOPE_INVALID'
  }
  if ([string]$tunnel.Principal.UserId -notin @('NT AUTHORITY\NETWORK SERVICE','NETWORK SERVICE','S-1-5-20') -or
      [string]$tunnel.Principal.ProcessTokenSidType -cne 'Unrestricted' -or $tunnel.Settings.Enabled -ne $true) {
    throw 'REPAIR_TUNNEL_TASK_SCOPE_INVALID'
  }
  $brokerArgs = [string]$broker.Actions[0].Arguments
  $tunnelArgs = [string]$tunnel.Actions[0].Arguments
  $expectedBrokerArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ProgramData\PTYSD\MCP\FactoryMCP\broker\hostguard-broker.ps1"'
  $expectedTunnelArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ProgramData\PTYSD\MCP\run-factory-mcp-tunnel.ps1"'
  if ($brokerArgs -cne $expectedBrokerArgs -or $tunnelArgs -cne $expectedTunnelArgs) {
    throw 'REPAIR_TASK_ACTION_PATH_INVALID'
  }
  if ([string]$broker.Actions[0].Execute -notmatch '(^|\\)powershell\.exe$' -or
      [string]$tunnel.Actions[0].Execute -notmatch '(^|\\)powershell\.exe$') {
    throw 'REPAIR_TASK_EXECUTABLE_INVALID'
  }
  return @(
    [pscustomobject]@{task=$broker;initial_state=[string]$broker.State}
    [pscustomobject]@{task=$tunnel;initial_state=[string]$tunnel.State}
  )
}

function Restore-FactoryMcpRepairTaskStates {
  param([Parameter(Mandatory)][object[]]$TaskSnapshots)

  foreach ($snapshot in $TaskSnapshots) {
    $name = [string]$snapshot.task.TaskName
    $current = Get-ScheduledTask -TaskName $name -ErrorAction Stop
    if ([string]$snapshot.initial_state -ceq 'Running') {
      if ([string]$current.State -cne 'Running') {
        Start-ScheduledTask -TaskName $name -ErrorAction Stop | Out-Null
        [void](Wait-FactoryMcpRepairTaskRunning -TaskName $name -TimeoutSeconds 30)
      }
    } elseif ([string]$current.State -ceq 'Running') {
      Stop-ScheduledTask -TaskName $name -ErrorAction Stop
      $deadline = [DateTime]::UtcNow.AddSeconds(30)
      do {
        Start-Sleep -Milliseconds 250
        $current = Get-ScheduledTask -TaskName $name -ErrorAction Stop
      } while ([string]$current.State -ceq 'Running' -and [DateTime]::UtcNow -lt $deadline)
      if ([string]$current.State -ceq 'Running') { throw 'REPAIR_TASK_STATE_RESTORE_TIMEOUT' }
    }
  }
  return $true
}

function Wait-FactoryMcpRepairTaskRunning {
  param([Parameter(Mandatory)][string]$TaskName,[int]$TimeoutSeconds=30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ([string]$task.State -ceq 'Running') { return $task }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'REPAIR_TASK_START_TIMEOUT'
}

function Assert-FactoryMcpRepairCanaryFile {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$ExpectedSha256)

  if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'REPAIR_CANARY_DIGEST_INVALID' }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'REPAIR_CANARY_ASSET_MISSING' }
  if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPAIR_CANARY_REPARSE_POINT' }
  $actualSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
  if ($actualSha256 -cne $ExpectedSha256) { throw 'REPAIR_CANARY_DIGEST_MISMATCH' }
}

function Invoke-FactoryMcpRepairCanary {
  param(
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$ExpectedSha256
  )

  $node = 'C:\Program Files\nodejs\node.exe'
  $canary = Join-Path $InstallRoot $script:factoryMcpRepairCanaryRelativePath
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    throw 'REPAIR_CANARY_ASSET_MISSING'
  }
  Assert-FactoryMcpRepairNoReparseAncestors -Path $canary -Root $InstallRoot
  [void](Assert-FactoryMcpRepairTargetFileAcl -Path $canary)
  Assert-FactoryMcpRepairCanaryFile -Path $canary -ExpectedSha256 $ExpectedSha256
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $node
  $start.Arguments = '"' + $canary + '" "' + $OutputPath + '"'
  $start.WorkingDirectory = $InstallRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'REPAIR_CANARY_START_FAILED' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(45000)) {
    try { $process.Kill() } catch {}
    throw 'REPAIR_CANARY_TIMEOUT'
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'REPAIR_CANARY_FAILED' }
  if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw 'REPAIR_CANARY_READBACK_MISSING' }
  $canaryResult = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json -ErrorAction Stop
  if ($canaryResult.result -cne 'PASS') { throw 'REPAIR_CANARY_NOT_PASS' }
  return [ordered]@{result='PASS';exit_code=$process.ExitCode;stdout_bytes=$stdoutTask.Result.Length;stderr_bytes=$stderrTask.Result.Length}
}

function Invoke-FactoryMcpRepair {
  $mutex = New-Object Threading.Mutex($false,'Global\PTYSD.FactoryMcp.Repair')
  $mutexHeld = $false
  try {
  try { $mutexHeld = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $mutexHeld = $true }
  if (-not $mutexHeld) { throw 'REPAIR_ALREADY_RUNNING' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $identity.User -or $identity.User.Value -cne 'S-1-5-18') { throw 'REPAIR_REQUIRES_SYSTEM' }
  if ($script:factoryMcpRepairManifestSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'REPAIR_MANIFEST_TRUST_PIN_NOT_CONFIGURED' }

  $repairRoot = $script:factoryMcpRepairRoot
  $targetRoot = $script:factoryMcpRepairTargetRoot
  [void](Assert-FactoryMcpRepairSafePathAncestors -Path $repairRoot)
  [void](Assert-FactoryMcpRepairSafePathAncestors -Path $targetRoot)
  $payloadRoot = Join-Path $repairRoot 'payload'
  $manifestPath = Join-Path $repairRoot $script:factoryMcpRepairManifestName
  $backupRoot = Join-Path $repairRoot 'backups'
  $receiptRoot = Join-Path $repairRoot 'receipts'
  [void](Assert-FactoryMcpRepairProtectedPath -Path $repairRoot -Directory)
  [void](Assert-FactoryMcpRepairProtectedPath -Path $payloadRoot -Directory)
  [void](Assert-FactoryMcpRepairProtectedPath -Path $manifestPath)
  foreach ($directory in @($backupRoot,$receiptRoot)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    Assert-FactoryMcpRepairNoReparseAncestors -Path $directory -Root $repairRoot
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $directory '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'REPAIR_PROTECTED_DIRECTORY_ACL_SET_FAILED' }
    [void](Assert-FactoryMcpRepairProtectedPath -Path $directory -Directory)
  }

  $manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifestSha256 -cne $script:factoryMcpRepairManifestSha256) { throw 'REPAIR_MANIFEST_DIGEST_MISMATCH' }
  $manifestText = [IO.File]::ReadAllText($manifestPath)
  $manifest = Assert-FactoryMcpRepairManifest -JsonText $manifestText -ExpectedSha256 $script:factoryMcpRepairManifestSha256
  $receiptPath = Join-Path $receiptRoot ($manifestSha256 + '.json')
  $priorReceipt = Test-Path -LiteralPath $receiptPath -PathType Leaf
  if ($priorReceipt) {
    [void](Assert-FactoryMcpRepairProtectedPath -Path $receiptPath)
    $recorded = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json -ErrorAction Stop
    $targetsMatch = $true
    foreach ($entry in @($manifest.files)) {
      $target = Get-FactoryMcpRepairPath -Root $targetRoot -RelativePath ([string]$entry.relative_path)
      [void](Assert-FactoryMcpRepairTargetDirectoryAcl -Path (Split-Path -Parent $target))
      $state = Get-FactoryMcpRepairFileState -Path $target
      if (-not $state.exists -or $state.sha256 -cne [string]$entry.sha256) { $targetsMatch = $false }
      else { [void](Assert-FactoryMcpRepairTargetFileAcl -Path $target) }
    }
    $taskSnapshots = @(Assert-FactoryMcpRepairTaskConfiguration)
    $tasksMatch = $true
    foreach ($taskSnapshot in $taskSnapshots) {
      $currentTask = Get-ScheduledTask -TaskName $taskSnapshot.task.TaskName -ErrorAction Stop
      if ([string]$currentTask.State -cne 'Running' -or $currentTask.Settings.Enabled -ne $true) { $tasksMatch = $false }
    }
    if ($recorded.result -ceq 'PASS' -and $targetsMatch -and $tasksMatch) { return $recorded }
    throw 'REPAIR_PRIOR_EFFECT_REQUIRES_READBACK'
  }
  foreach ($priorOperation in @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue)) {
    $priorPrestatePath = Join-Path $priorOperation.FullName 'prestate.json'
    if (-not (Test-Path -LiteralPath $priorPrestatePath -PathType Leaf)) { continue }
    try { $priorPrestate = Get-Content -LiteralPath $priorPrestatePath -Raw | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'REPAIR_PRIOR_EFFECT_REQUIRES_READBACK' }
    if ([string]$priorPrestate.manifest_sha256 -ceq $manifestSha256) { throw 'REPAIR_PRIOR_EFFECT_REQUIRES_READBACK' }
  }

  $taskSnapshots = @(Assert-FactoryMcpRepairTaskConfiguration)
  $snapshots = @()
  [void](Assert-FactoryMcpRepairTargetDirectoryAcl -Path $targetRoot)
  foreach ($entry in @($manifest.files)) {
    $source = Join-Path $payloadRoot ([string]$entry.relative_path -replace '/', '\')
    Assert-FactoryMcpRepairNoReparseAncestors -Path $source -Root $payloadRoot
    [void](Assert-FactoryMcpRepairProtectedPath -Path $source)
    $sourceSha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceSha -cne [string]$entry.sha256) { throw 'REPAIR_PAYLOAD_DIGEST_MISMATCH' }
    $target = Get-FactoryMcpRepairPath -Root $targetRoot -RelativePath ([string]$entry.relative_path)
    $parent = Split-Path -Parent $target
    while ($parent.StartsWith(($targetRoot.TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) {
      [void](Assert-FactoryMcpRepairTargetDirectoryAcl -Path $parent)
      $parent = Split-Path -Parent $parent
    }
    $current = Get-FactoryMcpRepairFileState -Path $target
    if ($current.exists) { [void](Assert-FactoryMcpRepairTargetFileAcl -Path $target) }
    $snapshots += [pscustomobject]@{relative_path=[string]$entry.relative_path;target=$target;prestate=$current;expected_sha256=[string]$entry.sha256}
  }

  $operationId = [Guid]::NewGuid().ToString('N')
  $operationBackup = Join-Path $backupRoot $operationId
  New-Item -ItemType Directory -Path $operationBackup -Force | Out-Null
  Assert-FactoryMcpRepairNoReparseAncestors -Path $operationBackup -Root $repairRoot
  & (Join-Path $env:SystemRoot 'System32\icacls.exe') $operationBackup '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'REPAIR_OPERATION_BACKUP_ACL_SET_FAILED' }
  [void](Assert-FactoryMcpRepairProtectedPath -Path $operationBackup -Directory)

  $receipt = [ordered]@{
    schema='v51.factory-mcp.repair-receipt.v1'
    operation_id=$operationId
    manifest_sha256=$manifestSha256
    result='IN_PROGRESS'
    started_at_utc=[DateTime]::UtcNow.ToString('o')
    prestate=@($snapshots | ForEach-Object { [ordered]@{relative_path=$_.relative_path;exists=$_.prestate.exists;sha256=$_.prestate.sha256;owner_sid=$_.prestate.owner_sid;access_sddl=$_.prestate.access_sddl} })
    applied_targets=@()
    task_prestate=@($taskSnapshots | ForEach-Object { [ordered]@{task_name=$_.task.TaskName;initial_state=$_.initial_state;principal=[string]$_.task.Principal.UserId} })
    task_readback=$null
    canary=$null
    rollback_status='NOT_REQUIRED'
    failure_code=$null
  }
  Write-FactoryMcpRepairDurableJson -Path (Join-Path $operationBackup 'prestate.json') -Value $receipt

  $tasksMayHaveChanged = $false
  $completedReplacePaths = @()
  $temporaryPaths = @()
  $taskNames = @($script:factoryMcpRepairTunnelTask,$script:factoryMcpRepairBrokerTask)
  try {
    $tasksMayHaveChanged = $true
    foreach ($taskName in $taskNames) {
      $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
      if ([string]$task.State -ceq 'Running') { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop }
    }
    foreach ($taskName in $taskNames) {
      $deadline = [DateTime]::UtcNow.AddSeconds(30)
      while (([string](Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State -ceq 'Running') -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
      if ([string](Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State -ceq 'Running') { throw 'REPAIR_TASK_STOP_TIMEOUT' }
    }
    for ($i=0;$i -lt $snapshots.Count;$i++) {
      $snapshot = $snapshots[$i]
      [void](Assert-FactoryMcpRepairTargetDirectoryAcl -Path (Split-Path -Parent $snapshot.target))
      $before = Get-FactoryMcpRepairFileState -Path $snapshot.target
      if ([bool]$before.exists -ne [bool]$snapshot.prestate.exists -or
          ($snapshot.prestate.exists -and ($before.sha256 -cne [string]$snapshot.prestate.sha256 -or
           $before.owner_sid -cne [string]$snapshot.prestate.owner_sid -or
           $before.access_sddl -cne [string]$snapshot.prestate.access_sddl))) {
        throw 'REPAIR_PRESTATE_CHANGED'
      }
      $entry = @($manifest.files | Where-Object { [string]$_.relative_path -ceq $snapshot.relative_path })[0]
      $source = Join-Path $payloadRoot ([string]$entry.relative_path -replace '/', '\')
      $backup = Join-Path $operationBackup ($snapshot.relative_path -replace '/', '\')
      $backupParent = Split-Path -Parent $backup
      if (-not (Test-Path -LiteralPath $backupParent -PathType Container)) { New-Item -ItemType Directory -Path $backupParent -Force | Out-Null }
      Assert-FactoryMcpRepairNoReparseAncestors -Path $backup -Root $operationBackup
      if ($snapshot.prestate.exists) {
        Copy-FactoryMcpRepairDurableBackup -Source $snapshot.target -Destination $backup -ExpectedSha256 ([string]$snapshot.prestate.sha256)
        & (Join-Path $env:SystemRoot 'System32\icacls.exe') $backup '/inheritance:r' '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'REPAIR_BACKUP_ACL_SET_FAILED' }
      }

      $temp = $snapshot.target + '.repair.' + $operationId + '.tmp'
      $payloadBytes = [IO.File]::ReadAllBytes($source)
      $stream = New-Object IO.FileStream($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      $temporaryPaths += [pscustomobject]@{path=$temp;expected_sha256=[string]$snapshot.expected_sha256}
      try { $stream.Write($payloadBytes,0,$payloadBytes.Length); $stream.Flush($true) }
      finally { $stream.Dispose() }
      [void](Assert-FactoryMcpRepairTargetDirectoryAcl -Path (Split-Path -Parent $snapshot.target))
      $beforeReplace = Get-FactoryMcpRepairFileState -Path $snapshot.target
      if (-not (Test-FactoryMcpRepairStateEquals -Left $beforeReplace -Right $snapshot.prestate)) {
        throw 'REPAIR_PRESTATE_CHANGED_BEFORE_REPLACE'
      }
      if ($snapshot.prestate.exists) { [IO.File]::Replace($temp,$snapshot.target,$null,$true) }
      else { [IO.File]::Move($temp,$snapshot.target) }
      $completedReplacePaths += $snapshot.relative_path
      $post = Get-FactoryMcpRepairFileState -Path $snapshot.target
      if (-not $post.exists -or $post.sha256 -cne $snapshot.expected_sha256) { throw 'REPAIR_TARGET_READBACK_MISMATCH' }
      [void](Assert-FactoryMcpRepairTargetFileAcl -Path $snapshot.target)
      $receipt.applied_targets += $snapshot.relative_path
    }

    foreach ($taskName in @($script:factoryMcpRepairBrokerTask,$script:factoryMcpRepairTunnelTask)) {
      Start-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
      [void](Wait-FactoryMcpRepairTaskRunning -TaskName $taskName -TimeoutSeconds 30)
    }
    $tasksAfter = @(Get-ScheduledTask -TaskName $script:factoryMcpRepairBrokerTask, $script:factoryMcpRepairTunnelTask)
    $receipt.task_readback = @($tasksAfter | ForEach-Object { [ordered]@{task_name=$_.TaskName;state=[string]$_.State;enabled=$_.Settings.Enabled;principal=[string]$_.Principal.UserId} })
    $receipt.canary = Invoke-FactoryMcpRepairCanary -InstallRoot $targetRoot -OutputPath (Join-Path $operationBackup 'canary.json') -ExpectedSha256 ([string]$manifest.canary.sha256)
    foreach ($snapshot in $snapshots) {
      $post = Get-FactoryMcpRepairFileState -Path $snapshot.target
      if (-not $post.exists -or $post.sha256 -cne $snapshot.expected_sha256) { throw 'REPAIR_FINAL_SOURCE_READBACK_MISMATCH' }
      [void](Assert-FactoryMcpRepairTargetFileAcl -Path $snapshot.target)
    }
    $receipt.result='PASS'
    $receipt.completed_at_utc=[DateTime]::UtcNow.ToString('o')
    Write-FactoryMcpRepairDurableJson -Path $receiptPath -Value $receipt
    [void](Assert-FactoryMcpRepairProtectedPath -Path $receiptPath)
    return $receipt
  } catch {
    $failure = $_.Exception.Message
    $rollbackStatus = 'NOT_REQUIRED'
    $readbacks = @()
    $observedMutation = $false
    $hasUnexpectedDrift = $false
    foreach ($snapshot in $snapshots) {
      try { $current = Get-FactoryMcpRepairFileState -Path $snapshot.target }
      catch { $current = $null }
      $matchesPrestate = ($current -and (Test-FactoryMcpRepairStateEquals -Left $current -Right $snapshot.prestate))
      $matchesExpected = ($current -and $current.exists -and [string]$current.sha256 -ceq [string]$snapshot.expected_sha256)
      $attempted = $snapshot.relative_path -in $completedReplacePaths
      if (-not $matchesPrestate) {
        if ($attempted -and $matchesExpected) { $observedMutation = $true }
        else { $hasUnexpectedDrift = $true }
      }
      $readbacks += [pscustomobject]@{snapshot=$snapshot;current=$current;matches_prestate=$matchesPrestate;matches_expected=$matchesExpected;attempted=$attempted}
    }
    $rollbackFailed = $hasUnexpectedDrift
    foreach ($temporary in $temporaryPaths) {
      if (Test-Path -LiteralPath $temporary.path -PathType Leaf) {
        try {
          Assert-FactoryMcpRepairNoReparseAncestors -Path $temporary.path -Root $targetRoot
          $tempSha = (Get-FileHash -LiteralPath $temporary.path -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($tempSha -cne $temporary.expected_sha256) { throw 'REPAIR_TEMPORARY_FILE_UNEXPECTED_CONTENT' }
          Remove-Item -LiteralPath $temporary.path -Force -ErrorAction Stop
        } catch { $rollbackFailed = $true }
      }
    }
    if ($observedMutation) {
      $rollbackStatus = 'ROLLBACK_ATTEMPTED'
      try {
        foreach ($taskName in $taskNames) {
          $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
          if ([string]$task.State -ceq 'Running') { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop }
        }
        foreach ($readback in @($readbacks | Where-Object { $_.attempted -and $_.matches_expected -and -not $_.matches_prestate } | Select-Object -Reverse)) {
          $snapshot = $readback.snapshot
          $backup = Join-Path $operationBackup ($snapshot.relative_path -replace '/', '\')
          if ($snapshot.prestate.exists) {
            if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw 'REPAIR_BACKUP_MISSING' }
            if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$snapshot.prestate.sha256) { throw 'REPAIR_BACKUP_DIGEST_MISMATCH' }
            $restoreTemp = $snapshot.target + '.rollback.' + $operationId + '.tmp'
            Copy-FactoryMcpRepairDurableBackup -Source $backup -Destination $restoreTemp -ExpectedSha256 ([string]$snapshot.prestate.sha256)
            $temporaryPaths += [pscustomobject]@{path=$restoreTemp;expected_sha256=[string]$snapshot.prestate.sha256}
            [IO.File]::Replace($restoreTemp,$snapshot.target,$null,$true)
            $security = Get-Acl -LiteralPath $snapshot.target
            $security.SetSecurityDescriptorSddlForm([string]$snapshot.prestate.access_sddl,[Security.AccessControl.AccessControlSections]::Access)
            $security.SetOwner((New-Object Security.Principal.SecurityIdentifier([string]$snapshot.prestate.owner_sid)))
            Set-Acl -LiteralPath $snapshot.target -AclObject $security -ErrorAction Stop
          } else {
            Remove-Item -LiteralPath $snapshot.target -Force -ErrorAction Stop
          }
        }
        foreach ($snapshot in $snapshots) {
          $restored = Get-FactoryMcpRepairFileState -Path $snapshot.target
          if (-not (Test-FactoryMcpRepairStateEquals -Left $restored -Right $snapshot.prestate)) { throw 'REPAIR_ROLLBACK_READBACK_MISMATCH' }
        }
      } catch { $rollbackFailed = $true }
    }
    foreach ($temporary in $temporaryPaths) {
      if (Test-Path -LiteralPath $temporary.path -PathType Leaf) {
        try {
          Assert-FactoryMcpRepairNoReparseAncestors -Path $temporary.path -Root $targetRoot
          $tempSha = (Get-FileHash -LiteralPath $temporary.path -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($tempSha -cne $temporary.expected_sha256) { throw 'REPAIR_TEMPORARY_FILE_UNEXPECTED_CONTENT' }
          Remove-Item -LiteralPath $temporary.path -Force -ErrorAction Stop
        } catch { $rollbackFailed = $true }
      }
    }
    if ($tasksMayHaveChanged) {
      try { [void](Restore-FactoryMcpRepairTaskStates -TaskSnapshots $taskSnapshots) }
      catch { $rollbackFailed = $true }
    }
    if ($rollbackFailed) { $rollbackStatus='ROLLBACK_INCOMPLETE' }
    elseif ($observedMutation) { $rollbackStatus='ROLLBACK_CONFIRMED' }
    elseif ($tasksMayHaveChanged) { $rollbackStatus='TASK_STATE_RESTORED' }
    $receipt.result = 'FAIL'
    $receipt.completed_at_utc=[DateTime]::UtcNow.ToString('o')
    $receipt.rollback_status=$rollbackStatus
    $receipt.failure_code=$failure
    try { Write-FactoryMcpRepairDurableJson -Path $receiptPath -Value $receipt } catch {}
    throw ('FACTORY_MCP_REPAIR_FAILED:' + $failure + ':' + $rollbackStatus)
  }
  } finally {
    if ($mutexHeld) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
  }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-FactoryMcpRepair }
