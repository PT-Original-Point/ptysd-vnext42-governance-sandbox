[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$unboundArgs = Get-Variable -Name args -Scope 0 -ValueOnly -ErrorAction SilentlyContinue
if (@($unboundArgs).Count -ne 0) { throw 'READONLY_DIAGNOSTICS_ARGUMENTS_NOT_SUPPORTED' }

$factoryRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path $factoryRoot 'state'
$receiptRoot = Join-Path $stateRoot 'exec-receipts'
$brokerHealthPath = Join-Path $stateRoot 'broker-health.json'
$ownerLivenessPath = Join-Path $stateRoot 'owner-liveness.json'
$capabilityPath = Join-Path $factoryRoot 'config\system-capability.json'
$maxReceiptBytes = 524288
$maxTotalReceiptBytes = 16777216
$maxReceiptFiles = 10000
$maxOrphanRecords = 16
$maxOwnerLivenessBytes = 65536
. (Join-Path $factoryRoot 'broker\trusted-caller-boundary.ps1')

function ConvertTo-BoundedToken {
  param([object]$Value)
  if ($null -eq $Value -or $Value -isnot [string]) { return $null }
  if ($Value.Length -gt 128 -or $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') { return $null }
  return $Value
}

function ConvertTo-BoundedIdentifier {
  param([object]$Value)
  if ($null -eq $Value -or $Value -isnot [string]) { return $null }
  if ($Value.Length -gt 80 -or $Value -notmatch '^[A-Z0-9][A-Z0-9._-]{0,79}$') { return $null }
  return $Value
}

function ConvertTo-BoundedInteger {
  param([object]$Value,[Parameter(Mandatory)][int64]$Maximum)
  if ($null -eq $Value) { return $null }
  $parsed = 0L
  if (-not [int64]::TryParse([string]$Value,[ref]$parsed)) { return $null }
  if ($parsed -lt 1 -or $parsed -gt $Maximum) { return $null }
  return $parsed
}

function ConvertTo-BoundedTimestamp {
  param([object]$Value)
  if ($null -eq $Value -or $Value -isnot [string] -or $Value.Length -gt 64) { return $null }
  try {
    return ([DateTime]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)).ToUniversalTime().ToString('o')
  } catch { return $null }
}

function Get-FileDigestFromBytes {
  param([Parameter(Mandatory)][byte[]]$Bytes)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return 'sha256:' + ([BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant())
  } finally { $algorithm.Dispose() }
}

function Read-BoundedJsonFile {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][int64]$MaximumBytes)
  $stream = $null
  $memory = $null
  try {
    $attributes = [IO.File]::GetAttributes($Path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT' }
    $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,$share)
    if ($stream.Length -gt $MaximumBytes) { throw 'TOO_LARGE' }
    $memory = New-Object IO.MemoryStream
    $buffer = New-Object byte[] 8192
    $total = 0L
    while ($true) {
      $read = $stream.Read($buffer,0,$buffer.Length)
      if ($read -le 0) { break }
      $total += $read
      if ($total -gt $MaximumBytes) { throw 'TOO_LARGE' }
      $memory.Write($buffer,0,$read)
    }
    [byte[]]$bytes = $memory.ToArray()
    $encoding = New-Object System.Text.UTF8Encoding($false,$true)
    $json = $encoding.GetString($bytes)
    if ($json.Length -gt 0 -and $json[0] -eq [char]0xFEFF) { $json = $json.Substring(1) }
    $value = ConvertFrom-Json -InputObject $json -ErrorAction Stop
    return [pscustomobject]@{ value=$value; digest=(Get-FileDigestFromBytes -Bytes $bytes); byte_length=$bytes.Length }
  } finally {
    if ($stream) { $stream.Dispose() }
    if ($memory) { $memory.Dispose() }
  }
}

function Get-HostGuardStatus {
  $session = $null
  try {
    $session = New-PSSession -ComputerName 'localhost' -ConfigurationName 'PTYSD.HostGuard.V45' -Authentication Negotiate -ErrorAction Stop
    $result = Invoke-Command -Session $session -ScriptBlock { Get-PTYSDHostGuardStatus } -ErrorAction Stop
    if ($null -eq $result -or [string]$result.schema -cne 'v45.hostguard.status.v1') {
      return [ordered]@{ read_status='INVALID'; payload=$null }
    }
    return [ordered]@{
      read_status='AVAILABLE'
      payload=[ordered]@{
        schema=[string]$result.schema
        host=[string]$result.host
        boot_identity=[string]$result.boot_identity
        vm_name=[string]$result.vm_name
        vm_id=[string]$result.vm_id
        vm_state=[string]$result.vm_state
        guest_ip=[string]$result.guest_ip
        ssh22_reachable=[bool]$result.ssh22_reachable
        run_as=[string]$result.run_as
      }
    }
  } catch {
    return [ordered]@{ read_status='UNAVAILABLE'; payload=$null }
  } finally {
    if ($session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
  }
}

function Get-CapabilityStatus {
  if (-not (Test-Path -LiteralPath $capabilityPath -PathType Leaf)) { return [ordered]@{ read_status='MISSING' } }
  try {
    $snapshot = Read-BoundedJsonFile -Path $capabilityPath -MaximumBytes 65536
    $value = $snapshot.value
    return [ordered]@{
      read_status='PRESENT'
      schema=ConvertTo-BoundedToken $value.schema
      project_id=ConvertTo-BoundedIdentifier $value.project_id
      capability_id=ConvertTo-BoundedIdentifier $value.capability_id
      capability_generation=ConvertTo-BoundedInteger $value.capability_generation 2147483647
      max_timeout_seconds=ConvertTo-BoundedInteger $value.max_timeout_seconds 86400
      production_allowed=if ($value.production_allowed -is [bool]) { [bool]$value.production_allowed } else { $null }
      business_project_allowed=if ($value.business_project_allowed -is [bool]) { [bool]$value.business_project_allowed } else { $null }
      public_tool_count=ConvertTo-BoundedInteger $value.public_tool_count 32
      execution_authority_mode=ConvertTo-BoundedToken $value.execution_authority_mode
      trusted_caller_sid=if ([string]$value.trusted_caller_sid -match '^S-1-(?:\d+-?)+$') { [string]$value.trusted_caller_sid } else { $null }
    }
  } catch { return [ordered]@{ read_status='INVALID' } }
}

function Get-BrokerHealth {
  if (-not (Test-Path -LiteralPath $brokerHealthPath -PathType Leaf)) { return [ordered]@{ read_status='MISSING' } }
  try {
    $snapshot = Read-BoundedJsonFile -Path $brokerHealthPath -MaximumBytes 65536
    $value = $snapshot.value
    return [ordered]@{
      read_status='AVAILABLE'
      schema=ConvertTo-BoundedToken $value.schema
      status=ConvertTo-BoundedToken $value.status
      pid=ConvertTo-BoundedInteger $value.pid 2147483647
      run_as=if ([string]$value.run_as -match '^[A-Za-z0-9 _\.-]{1,128}$') { [string]$value.run_as } else { $null }
      recorded_at_utc=ConvertTo-BoundedTimestamp $value.recorded_at_utc
      owner_liveness_publisher_status=if ([string]$value.owner_liveness_publisher_status -match '^(?:PUBLISHED|SOURCE_MISSING|SOURCE_INVALID|SOURCE_STALE|PUBLISH_FAILED)$') { [string]$value.owner_liveness_publisher_status } else { 'UNAVAILABLE' }
    }
  } catch { return [ordered]@{ read_status='INVALID' } }
}

function Test-OwnerLivenessReadAclRules {
  param([Parameter(Mandatory)]$Acl,[Parameter(Mandatory)][string]$CallerSid)
  try {
    $systemSid = 'S-1-5-18'
    $administratorsSid = 'S-1-5-32-544'
    $networkServiceSid = 'S-1-5-20'
    if ($CallerSid -cne $networkServiceSid) { return $false }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $systemSid) { return $false }
    $callerCanRead = $false
    $readMask = [int64]([Security.AccessControl.FileSystemRights]::Read -bor
      [Security.AccessControl.FileSystemRights]::ReadData -bor
      [Security.AccessControl.FileSystemRights]::ReadAttributes -bor
      [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes -bor
      [Security.AccessControl.FileSystemRights]::ReadPermissions -bor
      [Security.AccessControl.FileSystemRights]::Synchronize)
    $writeMask = [int64]([Security.AccessControl.FileSystemRights]::WriteData -bor
      [Security.AccessControl.FileSystemRights]::AppendData -bor
      [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
      [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
      [Security.AccessControl.FileSystemRights]::Delete -bor
      [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
      [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [Security.AccessControl.FileSystemRights]::TakeOwnership)
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
      $sid = [string]$rule.IdentityReference.Value
      $rights = [int64]$rule.FileSystemRights
      if ($sid -ceq $systemSid -or $sid -ceq $administratorsSid) { continue }
      if ($sid -cne $CallerSid -or ($rights -band $writeMask) -ne 0) { return $false }
      if (($rights -band $readMask) -ne 0) { $callerCanRead = $true }
    }
    return $callerCanRead
  } catch { return $false }
}

function Test-OwnerLivenessReadAcl {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$CallerSid)
  try {
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    return Test-OwnerLivenessReadAclRules -Acl $acl -CallerSid $CallerSid
  } catch { return $false }
}

function ConvertTo-OwnerLivenessRecoveryEvidenceView {
  param([object]$Value)
  $unavailable = [ordered]@{
    schema='PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1'
    status='UNAVAILABLE'
    reason_code='TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED'
  }
  if ($null -eq $Value -or $Value -is [array]) { return $unavailable }
  $keys = @($Value.PSObject.Properties.Name)
  if ([string]$Value.schema -cne 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1') {
    $unavailable.reason_code='RECOVERY_EVIDENCE_REFERENCE_INVALID'
    return $unavailable
  }
  if ([string]$Value.status -ceq 'UNAVAILABLE') {
    if ($keys.Count -ne 3 -or $keys -cnotcontains 'reason_code' -or
        [string]$Value.reason_code -notmatch '^[A-Z0-9_]{1,96}$') {
      $unavailable.reason_code='RECOVERY_EVIDENCE_REFERENCE_INVALID'
      return $unavailable
    }
    return [ordered]@{ schema='PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1'; status='UNAVAILABLE'; reason_code=[string]$Value.reason_code }
  }
  if ([string]$Value.status -cne 'AVAILABLE' -or $keys.Count -ne 4 -or
      $keys -cnotcontains 'provider' -or $keys -cnotcontains 'local') {
    $unavailable.reason_code='RECOVERY_EVIDENCE_REFERENCE_INVALID'
    return $unavailable
  }
  $provider=$Value.provider
  $local=$Value.local
  if ($null -eq $provider -or $provider -is [array] -or $null -eq $local -or $local -is [array] -or
      @($provider.PSObject.Properties.Name).Count -ne 2 -or @($local.PSObject.Properties.Name).Count -ne 2 -or
      [string]$provider.evidence_ref -notmatch '^recovery://provider/[a-f0-9]{32}$' -or
      [string]$local.evidence_ref -notmatch '^recovery://local/[a-f0-9]{32}$' -or
      [string]$provider.evidence_digest -notmatch '^sha256:[a-f0-9]{64}$' -or
      [string]$local.evidence_digest -notmatch '^sha256:[a-f0-9]{64}$') {
    $unavailable.reason_code='RECOVERY_EVIDENCE_REFERENCE_INVALID'
    return $unavailable
  }
  foreach ($reference in @($provider,$local)) {
    $referenceKeys=@($reference.PSObject.Properties.Name)
    if ($referenceKeys -cnotcontains 'evidence_ref' -or $referenceKeys -cnotcontains 'evidence_digest') {
      $unavailable.reason_code='RECOVERY_EVIDENCE_REFERENCE_INVALID'
      return $unavailable
    }
  }
  return [ordered]@{
    schema='PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1'
    status='AVAILABLE'
    provider=[ordered]@{ evidence_ref=[string]$provider.evidence_ref; evidence_digest=[string]$provider.evidence_digest }
    local=[ordered]@{ evidence_ref=[string]$local.evidence_ref; evidence_digest=[string]$local.evidence_digest }
  }
}

function Get-OwnerLivenessSnapshot {
  param([Parameter(Mandatory)][string]$CallerSid)
  if (-not (Test-Path -LiteralPath $ownerLivenessPath -PathType Leaf)) {
    return [ordered]@{ read_status='MISSING' }
  }
  try {
    $attributesBefore = [IO.File]::GetAttributes($ownerLivenessPath)
    if (($attributesBefore -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      return [ordered]@{ read_status='INVALID' }
    }
    if (-not (Test-OwnerLivenessReadAcl -Path $ownerLivenessPath -CallerSid $CallerSid)) {
      return [ordered]@{ read_status='INVALID' }
    }
    $before = Get-Item -LiteralPath $ownerLivenessPath -Force -ErrorAction Stop
    $snapshot = Read-BoundedJsonFile -Path $ownerLivenessPath -MaximumBytes $maxOwnerLivenessBytes
    $publication = $snapshot.value
    if ([string]$publication.schema -cne 'v51.factory.owner-liveness.publication.v1' -or
        [string]$publication.read_status -notin @('AVAILABLE','UNAVAILABLE','INVALID','STALE') -or
        [string]$publication.publisher_status -notin @('PUBLISHED','SOURCE_MISSING','SOURCE_INVALID','SOURCE_STALE','PUBLISH_FAILED')) {
      return [ordered]@{ read_status='INVALID' }
    }
    $after = Get-Item -LiteralPath $ownerLivenessPath -Force -ErrorAction Stop
    $attributesAfter = [IO.File]::GetAttributes($ownerLivenessPath)
    if (($attributesAfter -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $before.Length -ne $after.Length -or
        $before.LastWriteTimeUtc.Ticks -ne $after.LastWriteTimeUtc.Ticks) {
      return [ordered]@{ read_status='INVALID' }
    }
    $common = [ordered]@{
      read_status=[string]$publication.read_status
      publisher_status=[string]$publication.publisher_status
      reason=if ([string]$publication.reason -match '^[A-Z0-9_]{1,64}$') { [string]$publication.reason } else { $null }
      publisher_observed_at_utc=ConvertTo-BoundedTimestamp $publication.published_at_utc
      source_digest=if ([string]$publication.source_digest -match '^sha256:[0-9a-f]{64}$') { [string]$publication.source_digest } else { $null }
      source_observed_at_utc=ConvertTo-BoundedTimestamp $publication.snapshot_observed_at_utc
      evidence_ref='factory-mcp://state/owner-liveness.json'
      evidence_digest=[string]$snapshot.digest
      recovery_evidence=ConvertTo-OwnerLivenessRecoveryEvidenceView $publication.recovery_evidence
    }
    if ([string]$publication.read_status -cne 'AVAILABLE') { return $common }
    if ($null -eq $publication.snapshot -or [string]$publication.snapshot.schema -cne 'v51.factory.owner-liveness.snapshot.v1') {
      return [ordered]@{ read_status='INVALID'; publisher_status='SOURCE_INVALID'; reason='PUBLICATION_SNAPSHOT_INVALID'; evidence_ref='factory-mcp://state/owner-liveness.json'; evidence_digest=[string]$snapshot.digest }
    }
    $common.acl_status='VERIFIED_READ_ONLY'
    $common.snapshot=$publication.snapshot
    return $common
  } catch {
    return [ordered]@{ read_status='UNAVAILABLE' }
  }
}

function ConvertTo-OrphanReceiptRecord {
  param([Parameter(Mandatory)]$Snapshot,[Parameter(Mandatory)][string]$FileName)
  $value = $Snapshot.value
  if ([string]$value.state -cne 'ORPHANED') { return $null }
  $baseName = [IO.Path]::GetFileNameWithoutExtension($FileName)
  if ($baseName -notmatch '^[0-9a-f]{32}$' -or [string]$value.request_id -cne $baseName) {
    throw 'ORPHAN_RECEIPT_ID_MISMATCH'
  }
  $controlOid = $null
  if ([string]$value.control_oid -match '^(?:[0-9a-f]{40}|[0-9a-f]{64})$') { $controlOid = [string]$value.control_oid }
  $checkpointDigest = $null
  if ([string]$value.checkpoint_digest -match '^sha256:[0-9a-f]{64}$') { $checkpointDigest = [string]$value.checkpoint_digest }
  $authorizationDigest = $null
  if ([string]$value.authorization_envelope_digest -match '^sha256:[0-9a-f]{64}$') { $authorizationDigest = [string]$value.authorization_envelope_digest }
  return [ordered]@{
    request_id=$baseName
    project_id=ConvertTo-BoundedIdentifier $value.project_id
    capability_id=ConvertTo-BoundedIdentifier $value.capability_id
    operation_id=ConvertTo-BoundedIdentifier $value.operation_id
    control_oid=$controlOid
    checkpoint_digest=$checkpointDigest
    authorization_envelope_digest=$authorizationDigest
    capability_generation=ConvertTo-BoundedInteger $value.capability_generation 2147483647
    run_id=ConvertTo-BoundedIdentifier $value.run_id
    task_id=ConvertTo-BoundedIdentifier $value.task_id
    attempt_id=ConvertTo-BoundedIdentifier $value.attempt_id
    attempt_epoch=ConvertTo-BoundedInteger $value.attempt_epoch 2147483647
    started_at_utc=ConvertTo-BoundedTimestamp $value.started_at_utc
    finished_at_utc=ConvertTo-BoundedTimestamp $value.finished_at_utc
    timeout_seconds=ConvertTo-BoundedInteger $value.timeout_seconds 86400
    state='ORPHANED'
    historical_execution_outcome=ConvertTo-BoundedToken $value.side_effect_state
    current_target_state='NOT_OBSERVED_BY_READONLY_STATUS'
    error_code=if ([string]$value.error_code -match '^[A-Z0-9][A-Z0-9._-]{0,79}$') { [string]$value.error_code } else { $null }
    receipt_digest=[string]$Snapshot.digest
  }
}

function Get-OrphanReceiptStatus {
  $result = [ordered]@{
    read_status='UNAVAILABLE'
    total_count=$null
    records=@()
    truncated=$true
    consistency='BEST_EFFORT_NON_ATOMIC_DIRECTORY_READ'
    read_at_utc=[DateTime]::UtcNow.ToString('o')
  }
  try {
    if (-not (Test-Path -LiteralPath $receiptRoot -PathType Container)) { return $result }
    $rootAttributes = [IO.File]::GetAttributes($receiptRoot)
    if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $result }
    $files = @(Get-ChildItem -LiteralPath $receiptRoot -Filter '*.json' -File -ErrorAction Stop | Select-Object -First ($maxReceiptFiles + 1))
    if ($files.Count -gt $maxReceiptFiles) { $files = @($files | Select-Object -First $maxReceiptFiles); $result.read_status='PARTIAL' }
    else { $result.read_status='COMPLETE' }
    $records = New-Object 'System.Collections.Generic.List[object]'
    $orphanCount = 0
    $totalBytes = 0L
    $recordReadErrors = $false
    foreach ($file in $files) {
      if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $recordReadErrors=$true; continue }
      try {
        $snapshot = Read-BoundedJsonFile -Path $file.FullName -MaximumBytes $maxReceiptBytes
        $totalBytes += [int64]$snapshot.byte_length
        if ($totalBytes -gt $maxTotalReceiptBytes) { $recordReadErrors=$true; break }
        if ([string]$snapshot.value.state -ceq 'ORPHANED') {
          $record = ConvertTo-OrphanReceiptRecord -Snapshot $snapshot -FileName $file.Name
          if ($null -ne $record) {
            $orphanCount++
            if ($records.Count -lt $maxOrphanRecords) { $records.Add($record) }
          }
        }
      } catch { $recordReadErrors=$true }
    }
    if ($recordReadErrors) { $result.read_status='PARTIAL' }
    if ($result.read_status -eq 'COMPLETE') { $result.total_count=$orphanCount }
    $result.records=@($records)
    $result.truncated=($result.read_status -ne 'COMPLETE' -or $orphanCount -gt $records.Count)
    return $result
  } catch {
    $result.read_status='UNAVAILABLE'
    return $result
  }
}

function Get-ScheduledTaskIdentity {
  try {
    $records = @()
    $status = 'COMPLETE'
    foreach ($taskName in @('PTYSD-FactoryMCP-HostGuard-Broker-V47','PTYSD-FactoryMCP-Tunnel-V47')) {
      try { $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop }
      catch { $status='PARTIAL'; continue }
      if ($null -eq $task) { $status='PARTIAL'; continue }
      $actionName = $null
      if ($task.Actions -and $task.Actions.Count -gt 0) { $actionName=[IO.Path]::GetFileName([string]$task.Actions[0].Execute) }
      $principal = if ([string]$task.Principal.UserId -match '^[A-Za-z0-9 _\.-]{1,128}$') { [string]$task.Principal.UserId } else { $null }
      $taskEnabled = if ($task.Settings.Enabled -is [bool]) { [bool]$task.Settings.Enabled } else { $null }
      $processTokenSidType = [string]$task.Principal.ProcessTokenSidType
      $taskSid = $null
      try { $taskSid = Get-FactoryScheduledTaskSid -TaskName $taskName } catch {}
      $records += [ordered]@{
        task_name=[string]$task.TaskName
        state=[string]$task.State
        enabled=$taskEnabled
        principal=$principal
        process_token_sid_type=if ($processTokenSidType -ceq 'Unrestricted') { $processTokenSidType } else { $null }
        task_sid=$taskSid
        action_executable=$actionName
      }
    }
    return [ordered]@{ read_status=$status; records=@($records | Select-Object -First 16) }
  } catch { return [ordered]@{ read_status='UNAVAILABLE'; records=@() } }
}

function Get-ServiceIdentity {
  try {
    $records = @()
    $escapedRoot = $factoryRoot.Replace("'", "''")
    $filter = "Name LIKE 'PTYSD%FactoryMCP%' OR DisplayName LIKE 'PTYSD FactoryMCP%' OR PathName LIKE '%$escapedRoot%'"
    foreach ($service in @(Get-CimInstance -ClassName Win32_Service -Filter $filter -ErrorAction Stop)) {
      $path = [string]$service.PathName
      $nameMatch = [string]$service.Name -match '^PTYSD.?FactoryMCP'
      $displayMatch = [string]$service.DisplayName -match '^PTYSD FactoryMCP'
      $pathMatch = $path.Length -gt 0 -and $path.IndexOf($factoryRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0
      if (-not $nameMatch -and -not $displayMatch -and -not $pathMatch) { continue }
      $matchReason = if ($nameMatch) { 'FACTORY_SERVICE_NAME' } elseif ($displayMatch) { 'FACTORY_SERVICE_DISPLAY_NAME' } else { 'FACTORY_INSTALL_PATH' }
      $startName = if ([string]$service.StartName -match '^[A-Za-z0-9 _\.-]{1,128}$') { [string]$service.StartName } else { $null }
      $records += [ordered]@{
        service_name=[string]$service.Name
        match_reason=$matchReason
        state=[string]$service.State
        start_mode=[string]$service.StartMode
        start_name=$startName
      }
    }
    return [ordered]@{ read_status='COMPLETE'; records=@($records | Select-Object -First 16) }
  } catch { return [ordered]@{ read_status='UNAVAILABLE'; records=@() } }
}

function Get-ProcessIdentity {
  $records = New-Object 'System.Collections.Generic.List[object]'
  $status = 'COMPLETE'
  try {
    $psProcess = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID) -ErrorAction Stop
    if ($psProcess -and $psProcess.ParentProcessId) {
      $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$psProcess.ParentProcessId) -ErrorAction Stop
      if ($parent) {
        $owner = $null
        try {
          $ownerResult = Invoke-CimMethod -InputObject $parent -MethodName GetOwner -ErrorAction Stop
          if ($ownerResult.ReturnValue -eq 0) { $owner=([string]$ownerResult.Domain + '\' + [string]$ownerResult.User).Trim('\') }
        } catch {}
        $records.Add([ordered]@{
          role='MCP_PARENT'
          pid=[int]$parent.ProcessId
          owner=$owner
          image_name=[IO.Path]::GetFileName([string]$parent.ExecutablePath)
          started_at_utc=ConvertTo-BoundedTimestamp $parent.CreationDate
        })
      } else { $status='PARTIAL' }
    } else { $status='PARTIAL' }
  } catch { $status='PARTIAL' }
  try {
    $brokerScript = Join-Path $factoryRoot 'broker\hostguard-broker.ps1'
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction Stop)) {
      $commandLine = [string]$process.CommandLine
      if ($commandLine.Length -eq 0 -or $commandLine.IndexOf($brokerScript,[StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
      $owner = $null
      try {
        $ownerResult = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction Stop
        if ($ownerResult.ReturnValue -eq 0) { $owner=([string]$ownerResult.Domain + '\' + [string]$ownerResult.User).Trim('\') }
      } catch {}
      $records.Add([ordered]@{
        role='HOSTGUARD_BROKER'
        pid=[int]$process.ProcessId
        owner=$owner
        image_name=[IO.Path]::GetFileName([string]$process.ExecutablePath)
        started_at_utc=ConvertTo-BoundedTimestamp $process.CreationDate
      })
    }
  } catch { $status='PARTIAL' }
  return [ordered]@{ read_status=$status; records=@($records | Select-Object -First 16) }
}

$trustedCaller = Get-FactoryTrustedCallerObservation -FactoryRoot $factoryRoot

$output = [ordered]@{
  schema='v51.factory-mcp.readonly-probe.v1'
  observed_at_utc=[DateTime]::UtcNow.ToString('o')
  hostguard=Get-HostGuardStatus
  capability=Get-CapabilityStatus
  broker=Get-BrokerHealth
  orphans=Get-OrphanReceiptStatus
  scheduled_tasks=Get-ScheduledTaskIdentity
  services=Get-ServiceIdentity
  processes=Get-ProcessIdentity
  owner_liveness=Get-OwnerLivenessSnapshot -CallerSid ([string]$callerSid)
  trusted_caller=$trustedCaller
}
$output | ConvertTo-Json -Depth 12 -Compress
