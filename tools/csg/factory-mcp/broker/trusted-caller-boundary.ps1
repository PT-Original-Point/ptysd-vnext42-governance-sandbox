$script:factoryTrustedCallerNetworkServiceSid = 'S-1-5-20'
$script:factoryTrustedCallerSystemSid = 'S-1-5-18'
$script:factoryTrustedCallerAdministratorsSid = 'S-1-5-32-544'
$script:factoryProjectScopeSchema = 'v52.factory-mcp.project-scope.v1'
$script:factoryProjectScopePath = 'C:\ProgramData\PTYSD\MCP\config\factory-mcp-project-scope.json'
$script:factoryProjectIdPattern = '^[A-Z0-9][A-Z0-9._-]{0,79}$'
$script:factoryHostIdPattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
if (-not (Get-Command Get-Acl -ErrorAction SilentlyContinue)) {
  $securityModule = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
  Import-Module -Name $securityModule -ErrorAction Stop
}

function Get-FactoryScheduledTaskSid {
  param([Parameter(Mandatory)][string]$TaskName)

  if ($TaskName -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw 'TRUSTED_TASK_NAME_INVALID' }
  $task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction Stop
  if ([string]$task.Principal.UserId -notin @('NT AUTHORITY\NETWORK SERVICE','NETWORK SERVICE','S-1-5-20')) {
    throw 'TRUSTED_TASK_PRINCIPAL_INVALID'
  }
  if ([string]$task.Principal.ProcessTokenSidType -cne 'Unrestricted') {
    throw 'TRUSTED_TASK_SID_TYPE_INVALID'
  }

  $fullTaskPath = '\' + $TaskName
  $output = @(& (Join-Path $env:SystemRoot 'System32\schtasks.exe') /showsid /tn $fullTaskPath 2>&1)
  if ($LASTEXITCODE -ne 0) { throw 'TRUSTED_TASK_SID_READ_FAILED' }
  $text = [string]::Join("`n",[string[]]$output)
  $matches = [regex]::Matches($text,'(?<![A-Z0-9-])S-1-5-87(?:-\d+)+(?!\d)','IgnoreCase')
  if ($matches.Count -ne 1) { throw 'TRUSTED_TASK_SID_AMBIGUOUS' }

  $sid = New-Object Security.Principal.SecurityIdentifier($matches[0].Value)
  $account = New-Object Security.Principal.NTAccount(('NT TASK\' + $TaskName))
  $resolved = $account.Translate([Security.Principal.SecurityIdentifier])
  if ($resolved.Value -cne $sid.Value) { throw 'TRUSTED_TASK_SID_NAME_MISMATCH' }
  return $sid.Value
}

function Assert-FactoryRequestScope {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)][string]$ExpectedProjectId,
    [Parameter(Mandatory)][string]$ExpectedHostId
  )

  if ($ExpectedProjectId -cnotmatch $script:factoryProjectIdPattern -or $ExpectedHostId -cnotmatch $script:factoryHostIdPattern) { throw 'REQUEST_SCOPE_CONFIGURATION_INVALID' }
  if ([string]$Request.project_id -cne $ExpectedProjectId) { throw 'REQUEST_PROJECT_MISMATCH' }
  if ([string]$Request.host_id -cne $ExpectedHostId) { throw 'REQUEST_HOST_MISMATCH' }
  if ([string]$Request.execution_scope -cne 'PREPRODUCTION_REVERSIBLE' -or $Request.production_allowed -ne $false) {
    throw 'PRODUCTION_SCOPE_DENIED'
  }
  if ($ExpectedHostId -cne $env:COMPUTERNAME) { throw 'REQUEST_HOST_NOT_AUTHORIZED' }
}

function ConvertFrom-FactoryCanonicalJson {
  param([Parameter(Mandatory)][string]$JsonText,[int]$Depth = 4)

  try {
    $value = $JsonText | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $value -or $value -isnot [pscustomobject]) { throw 'REQUEST_JSON_OBJECT_REQUIRED' }
    $canonical = ConvertTo-Json -InputObject $value -Depth $Depth -Compress
  } catch { throw 'REQUEST_JSON_INVALID' }
  if ($canonical -cne $JsonText) { throw 'REQUEST_JSON_NONCANONICAL' }
  return $value
}

function Assert-FactoryCurrentTunnelTaskContext {
  param([Parameter(Mandatory)][string]$TaskSid)

  if ($TaskSid -cnotmatch '^S-1-5-87(?:-\d+)+$') { throw 'TRUSTED_TASK_SID_INVALID' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $identity.User -or $identity.User.Value -cne $script:factoryTrustedCallerNetworkServiceSid -or
      @($identity.Groups | ForEach-Object { $_.Value } | Where-Object { $_ -ceq $TaskSid }).Count -ne 1) {
    throw 'REQUEST_UNTRUSTED_CALLER'
  }
}

function Read-FactoryProjectScope {
  param([Parameter(Mandatory)][string]$TunnelTaskSid)

  if ($TunnelTaskSid -cnotmatch '^S-1-5-87(?:-\d+)+$') { throw 'PROJECT_SCOPE_TASK_SID_INVALID' }
  $directory = Split-Path -Parent $script:factoryProjectScopePath
  if (-not (Test-Path -LiteralPath $directory -PathType Container) -or
      (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw 'PROJECT_SCOPE_DIRECTORY_INVALID'
  }
  if (-not (Test-Path -LiteralPath $script:factoryProjectScopePath -PathType Leaf)) { throw 'PROJECT_SCOPE_FILE_MISSING' }
  $item = Get-Item -LiteralPath $script:factoryProjectScopePath -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -lt 2 -or $item.Length -gt 1024) {
    throw 'PROJECT_SCOPE_FILE_INVALID'
  }

  $acl = Get-Acl -LiteralPath $script:factoryProjectScopePath -ErrorAction Stop
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $script:factoryTrustedCallerSystemSid) {
    throw 'PROJECT_SCOPE_ACL_INVALID'
  }
  $systemFull = $false
  $adminFull = $false
  $taskRead = $false
  $taskWriteMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
    [Security.AccessControl.FileSystemRights]::AppendData -bor
    [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'PROJECT_SCOPE_ACL_INVALID' }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin @($script:factoryTrustedCallerSystemSid,$script:factoryTrustedCallerAdministratorsSid,$TunnelTaskSid)) {
      throw 'PROJECT_SCOPE_ACL_INVALID'
    }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if ($sid -ceq $script:factoryTrustedCallerSystemSid -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) { $systemFull = $true }
    if ($sid -ceq $script:factoryTrustedCallerAdministratorsSid -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) { $adminFull = $true }
    if ($sid -ceq $TunnelTaskSid) {
      if (($rights -band $taskWriteMask) -ne 0) { throw 'PROJECT_SCOPE_TASK_WRITE_ACCESS_UNEXPECTED' }
      if (($rights -band [Security.AccessControl.FileSystemRights]::Read) -eq [Security.AccessControl.FileSystemRights]::Read) { $taskRead = $true }
    }
  }
  if (-not $systemFull -or -not $adminFull -or -not $taskRead) { throw 'PROJECT_SCOPE_ACL_INVALID' }

  try {
    $encoding = New-Object Text.UTF8Encoding($false,$true)
    $jsonText = $encoding.GetString([IO.File]::ReadAllBytes($script:factoryProjectScopePath))
    $scope = $jsonText | ConvertFrom-Json -ErrorAction Stop
  } catch { throw 'PROJECT_SCOPE_JSON_INVALID' }
  $properties = @($scope.PSObject.Properties.Name)
  if ($scope -isnot [pscustomobject] -or $properties.Count -ne 3 -or
      $properties -cnotcontains 'schema' -or $properties -cnotcontains 'project_id' -or $properties -cnotcontains 'host_id' -or
      [string]$scope.schema -cne $script:factoryProjectScopeSchema -or
      [string]$scope.project_id -cnotmatch $script:factoryProjectIdPattern -or
      [string]$scope.host_id -cnotmatch $script:factoryHostIdPattern) {
    throw 'PROJECT_SCOPE_FIELDS_INVALID'
  }
  $canonical = [ordered]@{schema=$script:factoryProjectScopeSchema;project_id=[string]$scope.project_id;host_id=[string]$scope.host_id} | ConvertTo-Json -Compress
  if ($jsonText -cne $canonical) { throw 'PROJECT_SCOPE_CANONICAL_JSON_INVALID' }
  return [pscustomobject]@{schema=$script:factoryProjectScopeSchema;project_id=[string]$scope.project_id;host_id=[string]$scope.host_id}
}

function Assert-FactoryQueueDirectoryAcl {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$TaskSid,
    [Parameter(Mandatory)][ValidateSet('CALLER_MODIFY','SYSTEM_ONLY')][string]$Mode
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'TRUSTED_QUEUE_DIRECTORY_MISSING' }
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'TRUSTED_QUEUE_DIRECTORY_REPARSE_POINT' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  if (-not $acl.AreAccessRulesProtected) { throw 'TRUSTED_QUEUE_ACL_INHERITANCE_ENABLED' }

  $allowed = @($script:factoryTrustedCallerSystemSid,$script:factoryTrustedCallerAdministratorsSid)
  $taskSids = @($TaskSid | Where-Object { $_ } | Select-Object -Unique)
  if ($Mode -eq 'CALLER_MODIFY') {
    if ($taskSids.Count -lt 1 -or @($taskSids | Where-Object { $_ -notmatch '^S-1-5-87(?:-\d+)+$' }).Count -gt 0) { throw 'TRUSTED_TASK_SID_INVALID' }
    $allowed += $taskSids
  }
  $systemFull = $false
  $adminFull = $false
  $callerModifySids = @()
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'TRUSTED_QUEUE_ACL_DENY_RULE_UNEXPECTED' }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed) { throw ('TRUSTED_QUEUE_ACL_PRINCIPAL_UNEXPECTED:' + $sid) }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if ($sid -ceq $script:factoryTrustedCallerSystemSid -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) { $systemFull = $true }
    if ($sid -ceq $script:factoryTrustedCallerAdministratorsSid -and (($rights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) { $adminFull = $true }
    if ($sid -in $taskSids -and (($rights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify)) { $callerModifySids += $sid }
  }
  if (-not $systemFull -or -not $adminFull) { throw 'TRUSTED_QUEUE_ACL_ADMINISTRATOR_ACCESS_MISSING' }
  if ($Mode -eq 'CALLER_MODIFY' -and @($taskSids | Where-Object { $_ -notin $callerModifySids }).Count -gt 0) { throw 'TRUSTED_QUEUE_ACL_TASK_ACCESS_MISSING' }
  if ($Mode -eq 'SYSTEM_ONLY' -and $callerModifySids.Count -gt 0) { throw 'TRUSTED_QUEUE_ACL_TASK_ACCESS_UNEXPECTED' }
  return $true
}

function Set-FactoryDirectoryAcl {
  param(
    [Parameter(Mandatory)][string]$Path,
    [AllowEmptyCollection()][string[]]$TaskSid = @(),
    [Parameter(Mandatory)][ValidateSet('FULL','MODIFY','READ','RX','SYSTEM_ONLY')][string]$Mode
  )

  $grants = @('*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F')
  if ($Mode -eq 'SYSTEM_ONLY') { $verifyMode = 'SYSTEM_ONLY' }
  else {
    if (@($TaskSid | Where-Object { $_ -notmatch '^S-1-5-87(?:-\d+)+$' }).Count -gt 0 -or $TaskSid.Count -lt 1) { throw 'TRUSTED_TASK_SID_INVALID' }
    $rights = switch ($Mode) { FULL {'F'} MODIFY {'M'} READ {'R'} RX {'RX'} }
    foreach ($sid in @($TaskSid | Select-Object -Unique)) { $grants += ('*' + $sid + ':(OI)(CI)' + $rights) }
    $verifyMode = if ($Mode -eq 'MODIFY') { 'CALLER_MODIFY' } else { $null }
  }
  $args = @($Path,'/inheritance:r','/grant:r') + $grants
  & (Join-Path $env:SystemRoot 'System32\icacls.exe') @args | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'TRUSTED_QUEUE_ACL_SET_FAILED' }
  if ($verifyMode) { Assert-FactoryQueueDirectoryAcl -Path $Path -TaskSid $TaskSid -Mode $verifyMode | Out-Null }
  return $true
}

function Get-FactoryTrustedCallerObservation {
  param([Parameter(Mandatory)][string]$FactoryRoot)

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $userSid = if ($identity.User) { $identity.User.Value } else { $null }
  $tokenTaskSids = @($identity.Groups | ForEach-Object { $_.Value } | Where-Object { $_ -match '^S-1-5-87(?:-\d+)+$' } | Select-Object -Unique)
  $knownTaskSids = @()
  foreach ($taskName in @('PTYSD-FactoryMCP-Tunnel-V47','PTYSD-FactoryMCP-Live-Probe-Temp')) {
    try { $knownTaskSids += Get-FactoryScheduledTaskSid -TaskName $taskName } catch {}
  }
  $knownTaskSids = @($knownTaskSids | Select-Object -Unique)
  $matchingTaskSids = @($tokenTaskSids | Where-Object { $_ -in $knownTaskSids })
  $queueStatus = 'NOT_ESTABLISHED'
  try {
    if ($knownTaskSids.Count -lt 1 -or $matchingTaskSids.Count -ne 1) { throw 'TRUSTED_TASK_TOKEN_SID_MISSING' }
    $inbox = Join-Path $FactoryRoot 'queue\inbox'
    $outbox = Join-Path $FactoryRoot 'queue\outbox'
    [void](Assert-FactoryQueueDirectoryAcl -Path $inbox -TaskSid $knownTaskSids -Mode CALLER_MODIFY)
    [void](Assert-FactoryQueueDirectoryAcl -Path $outbox -TaskSid $knownTaskSids -Mode CALLER_MODIFY)
    $queueStatus = 'PASS'
  } catch { $queueStatus = 'FAIL_CLOSED' }
  $unique = ($userSid -ceq $script:factoryTrustedCallerNetworkServiceSid -and $matchingTaskSids.Count -eq 1 -and $queueStatus -ceq 'PASS')
  return [ordered]@{
    identity=[string]$identity.Name
    sid=$userSid
    task_sid=if ($matchingTaskSids.Count -eq 1) { [string]$matchingTaskSids[0] } else { $null }
    task_sid_present=($matchingTaskSids.Count -eq 1)
    queue_acl_status=$queueStatus
    unique_os_enforced=[bool]$unique
    boundary_status=if ($unique) { 'TASK_SID_ACL_PROTECTED' } elseif ($userSid -ceq $script:factoryTrustedCallerNetworkServiceSid) { 'SHARED_NETWORK_SERVICE_NOT_UNIQUE' } else { 'NOT_ESTABLISHED' }
  }
}

function Assert-TrustedBrokerRequestFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$InboxPath,
    [Parameter(Mandatory)][string]$TaskSid,
    [int64]$MaximumBytes = 65536
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  $fullInbox = [IO.Path]::GetFullPath($InboxPath).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  if (-not [string]::Equals([IO.Path]::GetDirectoryName($fullPath),$fullInbox,[StringComparison]::OrdinalIgnoreCase)) { throw 'REQUEST_PATH_OUTSIDE_INBOX' }
  $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REQUEST_REPARSE_POINT_DENIED' }
  if ($item.PSIsContainer) { throw 'REQUEST_NOT_REGULAR_FILE' }
  if ($item.Length -lt 1 -or $item.Length -gt $MaximumBytes) { throw 'REQUEST_SIZE_INVALID' }

  $acl = Get-Acl -LiteralPath $fullPath -ErrorAction Stop
  $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -cnotin @($script:factoryTrustedCallerNetworkServiceSid,$TaskSid)) { throw 'REQUEST_OWNER_INVALID' }
  $taskModify = $false
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'REQUEST_ACL_DENY_RULE_UNEXPECTED' }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin @($script:factoryTrustedCallerSystemSid,$script:factoryTrustedCallerAdministratorsSid,$TaskSid)) {
      throw 'REQUEST_ACL_PRINCIPAL_UNEXPECTED'
    }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if ($sid -ceq $TaskSid -and (($rights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify)) { $taskModify = $true }
  }
  if (-not $taskModify) { throw 'REQUEST_TASK_ACL_MISSING' }
  return $item
}

function Protect-ClaimedBrokerRequestFile {
  param([Parameter(Mandatory)][string]$Path)

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'REQUEST_REPARSE_POINT_DENIED' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($script:factoryTrustedCallerSystemSid)))
  foreach ($sidValue in @($script:factoryTrustedCallerSystemSid,$script:factoryTrustedCallerAdministratorsSid)) {
    $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
  $readback = Get-Acl -LiteralPath $Path -ErrorAction Stop
  if (-not $readback.AreAccessRulesProtected -or $readback.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $script:factoryTrustedCallerSystemSid) {
    throw 'REQUEST_CLAIMED_ACL_READBACK_FAILED'
  }
  foreach ($rule in $readback.Access) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $sid -notin @($script:factoryTrustedCallerSystemSid,$script:factoryTrustedCallerAdministratorsSid)) {
      throw 'REQUEST_CLAIMED_ACL_READBACK_FAILED'
    }
  }
  return (Get-Item -LiteralPath $Path -Force -ErrorAction Stop)
}
