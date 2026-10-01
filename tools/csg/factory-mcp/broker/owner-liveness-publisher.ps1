Set-StrictMode -Version Latest

$script:ownerLivenessSnapshotSchema = 'v51.factory.owner-liveness.snapshot.v1'
$script:ownerLivenessPublicationSchema = 'v51.factory.owner-liveness.publication.v1'
$script:ownerLivenessHeartbeatReadbackSchema = 'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1'
$script:ownerLivenessHeartbeatEvidenceSchema = 'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1'
$script:ownerLivenessProviderReadbackSchema = 'PTYSD_PROVIDER_SESSION_READBACK_V1'
$script:ownerLivenessLocalEvidenceReadbackSchema = 'PTYSD_LOCAL_LIVENESS_EVIDENCE_READBACK_V1'
$script:ownerLivenessRecoveryReferencesSchema = 'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1'
$script:ownerLivenessMaximumBytes = 65536
$script:ownerLivenessMaximumAgeSeconds = 30
$script:ownerLivenessNetworkServiceSid = 'S-1-5-20'
$script:ownerLivenessSystemSid = 'S-1-5-18'
$script:ownerLivenessAdministratorsSid = 'S-1-5-32-544'
$script:ownerLivenessCollectorSource = 'system-broker-fixed-owner-liveness-collector'
$script:ownerLivenessExpectedIdentity = [ordered]@{
  project_id = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE'
  provider = 'codex'
  task_id = 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION'
  attempt_id = 'V51-R2-02-ATTEMPT-002'
  attempt_epoch = 2
  owner_generation = 5
  owner_principal_id = 'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125'
  owner_scope = 'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION'
}

function Test-OwnerLivenessValue {
  param([object]$Value,[Parameter(Mandatory)][string]$Pattern,[Parameter(Mandatory)][int]$MaximumLength)
  return ($Value -is [string] -and $Value.Length -gt 0 -and $Value.Length -le $MaximumLength -and $Value -match $Pattern)
}

function Test-OwnerLivenessPositiveInteger {
  param([object]$Value,[Parameter(Mandatory)][int64]$Maximum)
  if (($Value -isnot [int] -and $Value -isnot [long]) -or [int64]$Value -lt 1 -or [int64]$Value -gt $Maximum) { return $false }
  return $true
}

function Test-OwnerLivenessTimestamp {
  param([object]$Value,[Parameter(Mandatory)][DateTimeOffset]$NowUtc)
  if (-not (Test-OwnerLivenessValue $Value '^\d{4}-\d\d-\d\dT[\d:.+-]+Z$' 64)) { return 'INVALID' }
  $observedAt = [DateTimeOffset]::MinValue
  $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
  if (-not [DateTimeOffset]::TryParse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,$styles,[ref]$observedAt)) { return 'INVALID' }
  $ageSeconds = ($NowUtc - $observedAt.ToUniversalTime()).TotalSeconds
  if ($ageSeconds -lt 0) { return 'FUTURE' }
  if ($ageSeconds -gt $script:ownerLivenessMaximumAgeSeconds) { return 'STALE' }
  return 'FRESH'
}

function Get-OwnerLivenessIdentityFingerprint {
  param([Parameter(Mandatory)]$Identity,[Parameter(Mandatory)][string]$OwnerPrincipalId,[Parameter(Mandatory)][string]$OwnerScope)
  $idText = @(
    [string]$Identity.project_id,
    [string]$Identity.provider,
    [string]$Identity.task_id,
    [string]$Identity.attempt_id,
    [Convert]::ToString([int]$Identity.attempt_epoch,[Globalization.CultureInfo]::InvariantCulture),
    [Convert]::ToString([int]$Identity.owner_generation,[Globalization.CultureInfo]::InvariantCulture),
    $OwnerPrincipalId,
    $OwnerScope
  ) -join "`n"
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash((New-Object System.Text.UTF8Encoding($false)).GetBytes($idText))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-OwnerLivenessSnapshotValidation {
  param([Parameter(Mandatory)]$Snapshot,[Parameter(Mandatory)][DateTimeOffset]$NowUtc)
  if ($null -eq $Snapshot -or $Snapshot -is [string] -or $Snapshot -is [array]) { return 'SNAPSHOT_INVALID' }
  if ([string]$Snapshot.schema -cne $script:ownerLivenessSnapshotSchema) { return 'SCHEMA_INVALID' }

  $identity = [ordered]@{
    project_id = [string]$Snapshot.project_id
    provider = [string]$Snapshot.provider
    task_id = [string]$Snapshot.task_id
    attempt_id = [string]$Snapshot.attempt_id
    attempt_epoch = $Snapshot.attempt_epoch
    owner_generation = $Snapshot.owner_generation
    fingerprint = [string]$Snapshot.fingerprint
  }
  if (-not (Test-OwnerLivenessValue $identity.project_id '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
      -not (Test-OwnerLivenessValue $identity.provider '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' 64) -or
      -not (Test-OwnerLivenessValue $identity.task_id '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
      -not (Test-OwnerLivenessValue $identity.attempt_id '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
      -not (Test-OwnerLivenessPositiveInteger $identity.attempt_epoch 2147483647) -or
      -not (Test-OwnerLivenessPositiveInteger $identity.owner_generation 2147483647) -or
      -not (Test-OwnerLivenessValue $identity.fingerprint '^[a-f0-9]{64}$' 64) -or
      -not (Test-OwnerLivenessValue ([string]$Snapshot.owner_principal_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
      -not (Test-OwnerLivenessValue ([string]$Snapshot.owner_scope) '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
      -not (Test-OwnerLivenessValue ([string]$Snapshot.observation_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
      [string]$Snapshot.source -cnotin @('authorized-cross-source-liveness-readback',$script:ownerLivenessCollectorSource)) {
    return 'IDENTITY_INVALID'
  }
  $isFixedCollectorSnapshot = [string]$Snapshot.source -ceq $script:ownerLivenessCollectorSource
  if ($isFixedCollectorSnapshot) {
    if ($null -eq $Snapshot.provider_observation_id) {
      if ($null -ne $Snapshot.owner_session_id -or $null -ne $Snapshot.provider_session_id) { return 'PROVIDER_OBSERVATION_ID_INVALID' }
    } elseif (-not (Test-OwnerLivenessValue ([string]$Snapshot.provider_observation_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        [string]$Snapshot.observation_id -ceq [string]$Snapshot.provider_observation_id -or
        -not (Test-OwnerLivenessValue ([string]$Snapshot.owner_session_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        -not (Test-OwnerLivenessValue ([string]$Snapshot.provider_session_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128)) {
      return 'PROVIDER_OBSERVATION_ID_INVALID'
    }
  } elseif (-not (Test-OwnerLivenessValue ([string]$Snapshot.provider_observation_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
      [string]$Snapshot.observation_id -ceq [string]$Snapshot.provider_observation_id) {
    return 'IDENTITY_INVALID'
  }

  foreach ($key in @('project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','owner_principal_id','owner_scope')) {
    if ($Snapshot.$key -cne $script:ownerLivenessExpectedIdentity[$key]) { return 'TARGET_IDENTITY_MISMATCH' }
  }
  if ($isFixedCollectorSnapshot -and
      $identity.fingerprint -cne (Get-OwnerLivenessIdentityFingerprint -Identity $identity -OwnerPrincipalId ([string]$Snapshot.owner_principal_id) -OwnerScope ([string]$Snapshot.owner_scope))) {
    return 'IDENTITY_FINGERPRINT_MISMATCH'
  }

  $snapshotTime = Test-OwnerLivenessTimestamp $Snapshot.observed_at $NowUtc
  if ($snapshotTime -eq 'INVALID' -or $snapshotTime -eq 'FUTURE') { return 'OBSERVATION_TIME_INVALID' }
  $components = $Snapshot.components
  $componentNames = if ($components -is [System.Collections.IDictionary]) { @($components.Keys | ForEach-Object { [string]$_ } | Sort-Object) } else { @($components.PSObject.Properties.Name | Sort-Object) }
  if ($null -eq $components -or $components -is [array] -or
      ($componentNames -join ',') -cne 'os_process,provider_agent_session,supervisor_heartbeat') {
    return 'COMPONENT_SET_INVALID'
  }

  $requirements = [ordered]@{
    os_process = @{ source='local-os-process-readback'; states=@('ACTIVE','ABSENT','UNKNOWN','UNAVAILABLE') }
    provider_agent_session = @{ source='provider-agent-session-readback'; states=@('ACTIVE','TERMINAL','UNKNOWN','UNAVAILABLE') }
    supervisor_heartbeat = @{ source='host-supervisor-heartbeat-readback'; states=@('ACTIVE','EXPIRED','UNKNOWN','UNAVAILABLE') }
  }
  $observationIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  [void]$observationIds.Add([string]$Snapshot.observation_id)
  if ($null -ne $Snapshot.provider_observation_id) { [void]$observationIds.Add([string]$Snapshot.provider_observation_id) }
  $freshness = @($snapshotTime)
  foreach ($name in @('os_process','provider_agent_session','supervisor_heartbeat')) {
    $component = $components.$name
    if ($null -eq $component -or $component -is [array]) { return 'COMPONENT_INVALID' }
    $componentId = [string]$component.observation_id
    if (-not (Test-OwnerLivenessValue $componentId '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        -not $observationIds.Add($componentId) -or
        $component.provider_observation_id -cne $Snapshot.provider_observation_id -or
        [string]$component.source -cne $requirements[$name].source -or
        [string]$component.state -cnotin $requirements[$name].states) {
      return 'COMPONENT_IDENTITY_INVALID'
    }
    foreach ($key in @('project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint')) {
      if ($component.$key -cne $identity[$key]) { return 'IDENTITY_MISMATCH' }
    }
    $componentTime = Test-OwnerLivenessTimestamp $component.observed_at $NowUtc
    if ($componentTime -eq 'INVALID' -or $componentTime -eq 'FUTURE') { return 'COMPONENT_TIME_INVALID' }
    $freshness += $componentTime

    if ($name -eq 'os_process') {
      if ([string]$component.state -ceq 'ACTIVE') {
        $processStartTime = Test-OwnerLivenessTimestamp $component.process_started_at_utc $NowUtc
        if (-not (Test-OwnerLivenessPositiveInteger $component.process_id 2147483647) -or
            $processStartTime -cin @('INVALID','FUTURE') -or
            -not (Test-OwnerLivenessValue ([string]$component.process_image) '^[A-Za-z0-9_.-]{1,128}$' 128) -or
            -not (Test-OwnerLivenessValue ([string]$component.process_principal) '^[A-Za-z0-9 _\\.-]{1,128}$' 128)) { return 'OS_PROCESS_IDENTITY_INVALID' }
      } elseif ([string]$component.state -ceq 'ABSENT' -and
          ($null -ne $component.process_id -or $null -ne $component.process_started_at_utc)) {
        return 'OS_PROCESS_IDENTITY_INVALID'
      }
      if ($isFixedCollectorSnapshot) {
        if ([string]$component.state -notin @('UNKNOWN','UNAVAILABLE') -or
            [string]$component.identity_link_status -cne 'UNRESOLVED' -or
            $null -ne $component.process_id -or $null -ne $component.process_started_at_utc -or
            $null -eq $component.candidate_processes -or $component.candidate_processes -isnot [array] -or
            $component.candidate_processes.Count -gt 8) { return 'OS_PROCESS_IDENTITY_INVALID' }
        foreach ($candidate in $component.candidate_processes) {
          $candidateStart = Test-OwnerLivenessTimestamp $candidate.process_started_at_utc $NowUtc
          if (-not (Test-OwnerLivenessPositiveInteger $candidate.process_id 2147483647) -or
              -not (Test-OwnerLivenessValue ([string]$candidate.process_image) '^(?:Codex|ChatGPT)\.exe$' 128) -or
              -not (Test-OwnerLivenessValue ([string]$candidate.process_principal) '^[A-Za-z0-9 _\\.-]{1,128}$' 128) -or
              $candidateStart -cin @('INVALID','FUTURE')) { return 'OS_PROCESS_IDENTITY_INVALID' }
        }
      }
    } elseif ($name -eq 'provider_agent_session') {
      if ($isFixedCollectorSnapshot -and $null -eq $Snapshot.provider_observation_id -and
          ([string]$component.state -cne 'UNAVAILABLE' -or
           [string]$component.unavailability_reason -cne 'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED')) {
        return 'PROVIDER_OBSERVATION_ID_INVALID'
      }
      if ($isFixedCollectorSnapshot -and $null -ne $Snapshot.provider_observation_id -and
          ([string]$component.state -cne 'TERMINAL' -or $null -ne $component.unavailability_reason -or
           [string]$component.provider_session_id -cne [string]$Snapshot.provider_session_id)) {
        return 'PROVIDER_OBSERVATION_ID_INVALID'
      }
      if ([string]$component.state -cne 'UNAVAILABLE' -and
          -not (Test-OwnerLivenessValue ([string]$component.provider_session_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128)) {
        return 'PROVIDER_SESSION_IDENTITY_INVALID'
      }
      if ([string]$component.state -ceq 'UNAVAILABLE' -and
          ($null -ne $component.provider_session_id -or $null -ne $component.provider_job_id)) { return 'PROVIDER_SESSION_IDENTITY_INVALID' }
      if ($null -ne $component.provider_job_id -and
          -not (Test-OwnerLivenessValue ([string]$component.provider_job_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128)) {
        return 'PROVIDER_JOB_IDENTITY_INVALID'
      }
    } else {
      $heartbeatTime = Test-OwnerLivenessTimestamp $component.heartbeat_at_utc $NowUtc
      $taskObservation = $component.supervisor_task_observation
      if ($isFixedCollectorSnapshot) {
        if ($null -eq $taskObservation -or [string]$taskObservation.read_status -notin @('PRESENT','UNAVAILABLE')) {
          return 'SUPERVISOR_TASK_OBSERVATION_INVALID'
        }
        if ([string]$taskObservation.read_status -ceq 'PRESENT') {
          $taskObservedAt = Test-OwnerLivenessTimestamp $taskObservation.observed_at $NowUtc
          if ([string]$taskObservation.task_name -cne 'PTYSD-VNext42-Supervisor-Candidate1' -or
              -not (Test-OwnerLivenessValue ([string]$taskObservation.state) '^[A-Za-z0-9._-]{1,64}$' 64) -or
              $taskObservation.enabled -isnot [bool] -or
              -not (Test-OwnerLivenessValue ([string]$taskObservation.principal) '^[A-Za-z0-9 _\\.-]{1,128}$' 128) -or
              $taskObservedAt -cin @('INVALID','FUTURE')) { return 'SUPERVISOR_TASK_OBSERVATION_INVALID' }
          $freshness += $taskObservedAt
        } else {
          $taskObservedAt = Test-OwnerLivenessTimestamp $taskObservation.observed_at $NowUtc
          if ($taskObservedAt -cin @('INVALID','FUTURE') -or
              $null -ne $taskObservation.task_name -or $null -ne $taskObservation.state -or
              $null -ne $taskObservation.enabled -or $null -ne $taskObservation.principal) {
            return 'SUPERVISOR_TASK_OBSERVATION_INVALID'
          }
          $freshness += $taskObservedAt
        }
      }
      if ($isFixedCollectorSnapshot) {
        if ([string]$component.readback_status -ceq 'UNAVAILABLE') {
          if ([string]$component.state -cne 'UNAVAILABLE' -or
              -not (Test-OwnerLivenessValue ([string]$component.unavailability_reason) '^[A-Z0-9_]{1,128}$' 128) -or
              $null -ne $component.supervisor_id -or $null -ne $component.heartbeat_id -or
              $null -ne $component.heartbeat_at_utc -or $null -ne $component.boot_identity -or
              $null -ne $component.process_identity -or $null -ne $component.service_identity -or
              $null -ne $component.task_identity -or $null -ne $component.heartbeat_evidence_ref -or
              $null -ne $component.heartbeat_evidence_digest) {
            return 'SUPERVISOR_HEARTBEAT_IDENTITY_INVALID'
          }
        } elseif ([string]$component.readback_status -ceq 'PRESENT') {
          if ([string]$component.state -cnotin @('ACTIVE','EXPIRED') -or $null -ne $component.unavailability_reason -or
              -not (Test-OwnerLivenessValue ([string]$component.task_identity) '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
              [string]$component.task_identity -cne $identity.task_id -or
              -not (Test-OwnerLivenessValue ([string]$component.boot_identity) '^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$' 256) -or
              -not (Test-OwnerLivenessValue ([string]$component.process_identity) '^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$' 256) -or
              -not (Test-OwnerLivenessValue ([string]$component.service_identity) '^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$' 256) -or
              -not (Test-OwnerLivenessValue ([string]$component.heartbeat_evidence_ref) '^recovery://supervisor-heartbeat/[a-f0-9]{32}$' 80) -or
              -not (Test-OwnerLivenessValue ([string]$component.heartbeat_evidence_digest) '^sha256:[a-f0-9]{64}$' 71)) {
            return 'SUPERVISOR_HEARTBEAT_IDENTITY_INVALID'
          }
        } else { return 'SUPERVISOR_HEARTBEAT_IDENTITY_INVALID' }
      }
      if ([string]$component.state -cne 'UNAVAILABLE' -and
          (-not (Test-OwnerLivenessValue ([string]$component.supervisor_id) '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
           -not (Test-OwnerLivenessValue ([string]$component.heartbeat_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
           $heartbeatTime -cin @('INVALID','FUTURE'))) {
        return 'SUPERVISOR_HEARTBEAT_IDENTITY_INVALID'
      }
    }
  }
  if ($freshness -contains 'STALE') { return 'STALE' }
  return 'VALID'
}

function ConvertTo-SafeOwnerLivenessSnapshot {
  param([Parameter(Mandatory)]$Snapshot)
  $identity = [ordered]@{
    project_id=[string]$Snapshot.project_id
    provider=[string]$Snapshot.provider
    task_id=[string]$Snapshot.task_id
    attempt_id=[string]$Snapshot.attempt_id
    attempt_epoch=[int]$Snapshot.attempt_epoch
    owner_generation=[int]$Snapshot.owner_generation
    fingerprint=[string]$Snapshot.fingerprint
  }
  $components = [ordered]@{}
  foreach ($name in @('os_process','provider_agent_session','supervisor_heartbeat')) {
    $component = $Snapshot.components.$name
    $entry = [ordered]@{
      observation_id=[string]$component.observation_id
      provider_observation_id=if ($null -eq $component.provider_observation_id) { $null } else { [string]$component.provider_observation_id }
    }
    foreach ($key in @('project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint')) { $entry[$key]=$identity[$key] }
    $entry.observed_at=[string]$component.observed_at
    $entry.source=[string]$component.source
    $entry.state=[string]$component.state
    if ($name -eq 'os_process') {
      $entry.process_id=if ($null -eq $component.process_id) { $null } else { [int]$component.process_id }
      $entry.process_image=if ($null -eq $component.process_image) { $null } else { [string]$component.process_image }
      $entry.process_principal=if ($null -eq $component.process_principal) { $null } else { [string]$component.process_principal }
      $entry.process_started_at_utc=if ($null -eq $component.process_started_at_utc) { $null } else { [string]$component.process_started_at_utc }
      $entry.identity_link_status=if ([string]$component.identity_link_status -ceq 'EXACT') { 'EXACT' } else { 'UNRESOLVED' }
      $entry.candidate_processes=@(foreach ($candidate in @($component.candidate_processes | Select-Object -First 8)) {
        [ordered]@{
          process_id=[int]$candidate.process_id
          process_image=[string]$candidate.process_image
          process_principal=[string]$candidate.process_principal
          process_started_at_utc=[string]$candidate.process_started_at_utc
        }
      })
    } elseif ($name -eq 'provider_agent_session') {
      $entry.provider_session_id=if ($null -eq $component.provider_session_id) { $null } else { [string]$component.provider_session_id }
      $entry.provider_job_id=if ($null -eq $component.provider_job_id) { $null } else { [string]$component.provider_job_id }
      $entry.unavailability_reason=if ($null -eq $component.unavailability_reason) { $null } else { [string]$component.unavailability_reason }
    } else {
      $entry.supervisor_id=if ($null -eq $component.supervisor_id) { $null } else { [string]$component.supervisor_id }
      $entry.heartbeat_id=if ($null -eq $component.heartbeat_id) { $null } else { [string]$component.heartbeat_id }
      $entry.heartbeat_at_utc=if ($null -eq $component.heartbeat_at_utc) { $null } else { [string]$component.heartbeat_at_utc }
      $entry.unavailability_reason=if ($null -eq $component.unavailability_reason) { $null } else { [string]$component.unavailability_reason }
      $entry.readback_status=if ($null -eq $component.readback_status) { $null } else { [string]$component.readback_status }
      $entry.boot_identity=if ($null -eq $component.boot_identity) { $null } else { [string]$component.boot_identity }
      $entry.process_identity=if ($null -eq $component.process_identity) { $null } else { [string]$component.process_identity }
      $entry.service_identity=if ($null -eq $component.service_identity) { $null } else { [string]$component.service_identity }
      $entry.task_identity=if ($null -eq $component.task_identity) { $null } else { [string]$component.task_identity }
      $entry.heartbeat_evidence_ref=if ($null -eq $component.heartbeat_evidence_ref) { $null } else { [string]$component.heartbeat_evidence_ref }
      $entry.heartbeat_evidence_digest=if ($null -eq $component.heartbeat_evidence_digest) { $null } else { [string]$component.heartbeat_evidence_digest }
      if ($null -ne $component.supervisor_task_observation) {
        $taskObservation = $component.supervisor_task_observation
        $entry.supervisor_task_observation=[ordered]@{
          read_status=[string]$taskObservation.read_status
          observed_at=if ($null -eq $taskObservation.observed_at) { $null } else { [string]$taskObservation.observed_at }
          task_name=if ($null -eq $taskObservation.task_name) { $null } else { [string]$taskObservation.task_name }
          state=if ($null -eq $taskObservation.state) { $null } else { [string]$taskObservation.state }
          enabled=if ($null -eq $taskObservation.enabled) { $null } else { [bool]$taskObservation.enabled }
          principal=if ($null -eq $taskObservation.principal) { $null } else { [string]$taskObservation.principal }
        }
      }
    }
    $components[$name]=$entry
  }
  $result = [ordered]@{
    schema=$script:ownerLivenessSnapshotSchema
  }
  foreach ($key in $identity.Keys) { $result[$key]=$identity[$key] }
  $result.owner_principal_id=[string]$Snapshot.owner_principal_id
  $result.owner_scope=[string]$Snapshot.owner_scope
  $result.owner_session_id=if ($null -eq $Snapshot.owner_session_id) { $null } else { [string]$Snapshot.owner_session_id }
  $result.provider_session_id=if ($null -eq $Snapshot.provider_session_id) { $null } else { [string]$Snapshot.provider_session_id }
  $result.observation_id=[string]$Snapshot.observation_id
  $result.provider_observation_id=if ($null -eq $Snapshot.provider_observation_id) { $null } else { [string]$Snapshot.provider_observation_id }
  $result.observed_at=[string]$Snapshot.observed_at
  $result.source=[string]$Snapshot.source
  $result.components=$components
  return $result
}

function Test-OwnerLivenessProtectedReadAcl {
  param([Parameter(Mandatory)]$Acl)
  try {
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $script:ownerLivenessSystemSid) { return $false }
    $callerCanRead = $false
    $readMask = [int64]([Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::ReadData -bor
      [Security.AccessControl.FileSystemRights]::ReadAttributes -bor [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes -bor
      [Security.AccessControl.FileSystemRights]::ReadPermissions -bor [Security.AccessControl.FileSystemRights]::Synchronize)
    $writeMask = [int64]([Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::AppendData -bor
      [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
      [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [Security.AccessControl.FileSystemRights]::TakeOwnership)
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
      $sid = [string]$rule.IdentityReference.Value
      $rights = [int64]$rule.FileSystemRights
      if ($sid -ceq $script:ownerLivenessSystemSid -or $sid -ceq $script:ownerLivenessAdministratorsSid) { continue }
      if ($sid -cne $script:ownerLivenessNetworkServiceSid -or ($rights -band $writeMask) -ne 0) { return $false }
      if (($rights -band $readMask) -ne 0) { $callerCanRead = $true }
    }
    return $callerCanRead
  } catch { return $false }
}

function Test-OwnerLivenessProtectedReadFile {
  param([Parameter(Mandatory)][string]$Path)
  try {
    if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    return Test-OwnerLivenessProtectedReadAcl -Acl (Get-Acl -LiteralPath $Path -ErrorAction Stop)
  } catch { return $false }
}

function Test-OwnerLivenessStateDirectoryAcl {
  param([Parameter(Mandatory)]$Acl)
  try {
    $ownerSid = $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($ownerSid -cnotin @($script:ownerLivenessSystemSid,$script:ownerLivenessAdministratorsSid)) { return $false }
    $callerCanRead = $false
    $readMask = [int64]([Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::ReadAndExecute)
    $writeMask = [int64]([Security.AccessControl.FileSystemRights]::CreateFiles -bor [Security.AccessControl.FileSystemRights]::CreateDirectories -bor
      [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
      [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
      [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership)
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
      $sid = [string]$rule.IdentityReference.Value
      if ($sid -ceq $script:ownerLivenessSystemSid -or $sid -ceq $script:ownerLivenessAdministratorsSid) { continue }
      if ($sid -cne $script:ownerLivenessNetworkServiceSid -or ([int64]$rule.FileSystemRights -band $writeMask) -ne 0) { return $false }
      if (([int64]$rule.FileSystemRights -band $readMask) -ne 0) { $callerCanRead = $true }
    }
    return $callerCanRead
  } catch { return $false }
}

function Test-OwnerLivenessStateDirectoryBoundary {
  try {
    if (([IO.Directory]::GetAttributes($state) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    return Test-OwnerLivenessStateDirectoryAcl -Acl (Get-Acl -LiteralPath $state -ErrorAction Stop)
  } catch { return $false }
}

function Get-OwnerLivenessProcessCandidates {
  $observedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  try {
    $items = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='Codex.exe' OR Name='ChatGPT.exe'" -ErrorAction Stop | Select-Object -First 8)
    $records = @()
    foreach ($item in $items) {
      $principal = 'UNKNOWN'
      try {
        $owner = Invoke-CimMethod -InputObject $item -MethodName GetOwner -ErrorAction Stop
        if ([int]$owner.ReturnValue -eq 0 -and [string]::IsNullOrEmpty([string]$owner.Domain) -eq $false -and
            [string]::IsNullOrEmpty([string]$owner.User) -eq $false) {
          $principal = [string]$owner.Domain + '\' + [string]$owner.User
        }
      } catch { }
      try {
        $createdAtValue = $item.CreationDate
        if ($createdAtValue -is [DateTimeOffset]) {
          $createdAtUtc = $createdAtValue.UtcDateTime
        } elseif ($createdAtValue -is [DateTime]) {
          # Get-CimInstance materializes Win32_Process.CreationDate as DateTime.
          # ManagementDateTimeConverter expects a DMTF string and drops this native value.
          $createdAtUtc = $createdAtValue.ToUniversalTime()
        } elseif ($createdAtValue -is [string] -and $createdAtValue -match '^\d{14}\.\d{6}[+-]\d{3}$') {
          $createdAtUtc = [System.Management.ManagementDateTimeConverter]::ToDateTime($createdAtValue).ToUniversalTime()
        } else {
          throw 'OWNER_LIVENESS_PROCESS_START_TIME_INVALID'
        }
        $createdAt = $createdAtUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture)
        $processId = [int64]$item.ProcessId
        if (-not (Test-OwnerLivenessPositiveInteger $processId 2147483647) -or
            -not (Test-OwnerLivenessValue ([string]$item.Name) '^[A-Za-z0-9_.-]{1,128}$' 128) -or
            -not (Test-OwnerLivenessValue $principal '^[A-Za-z0-9 _\\.-]{1,128}$' 128)) { continue }
        $records += [ordered]@{
          process_id=[int]$processId
          process_image=[string]$item.Name
          process_principal=$principal
          process_started_at_utc=$createdAt
        }
      } catch { }
      if ($records.Count -ge 8) { break }
    }
    return [ordered]@{ state='UNKNOWN'; observed_at=$observedAt; records=@($records); identity_link_status='UNRESOLVED' }
  } catch {
    return [ordered]@{ state='UNAVAILABLE'; observed_at=$observedAt; records=@(); identity_link_status='UNRESOLVED' }
  }
}

function Get-OwnerLivenessSupervisorTaskObservation {
  $observedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  try {
    $task = Get-ScheduledTask -TaskName 'PTYSD-VNext42-Supervisor-Candidate1' -ErrorAction Stop
    return [ordered]@{
      read_status='PRESENT'
      observed_at=$observedAt
      task_name='PTYSD-VNext42-Supervisor-Candidate1'
      state=[string]$task.State
      enabled=[bool]$task.Settings.Enabled
      principal=[string]$task.Principal.UserId
    }
  } catch {
    return [ordered]@{ read_status='UNAVAILABLE'; observed_at=$observedAt; task_name=$null; state=$null; enabled=$null; principal=$null }
  }
}

function Test-OwnerLivenessProtectedReadDirectory {
  param([Parameter(Mandatory)][string]$Path)
  try {
    if (([IO.Directory]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    return Test-OwnerLivenessStateDirectoryAcl -Acl (Get-Acl -LiteralPath $Path -ErrorAction Stop)
  } catch { return $false }
}

function Test-OwnerLivenessRecoveryEvidenceObject {
  param([Parameter(Mandatory)][string]$Kind,[Parameter(Mandatory)][string]$Reference,[Parameter(Mandatory)][string]$Digest)
  $match = [regex]::Match($Reference,'^recovery://' + [regex]::Escape($Kind) + '/(?<id>[a-f0-9]{32})$')
  if (-not $match.Success -or $Digest -cnotmatch '^sha256:[a-f0-9]{64}$') { return $false }
  try {
    $evidenceRoot = Join-Path $state 'recovery-evidence'
    $objectsRoot = Join-Path $evidenceRoot 'objects'
    $kindRoot = Join-Path $objectsRoot $Kind
    foreach ($directory in @($evidenceRoot,$objectsRoot,$kindRoot)) {
      if (-not (Test-OwnerLivenessProtectedReadDirectory -Path $directory)) { return $false }
    }
    $evidencePath = Join-Path $kindRoot ($match.Groups['id'].Value + '.json')
    if (-not (Test-OwnerLivenessProtectedReadFile -Path $evidencePath)) { return $false }
    [byte[]]$evidenceBytes = [IO.File]::ReadAllBytes($evidencePath)
    if ($evidenceBytes.Length -lt 1 -or $evidenceBytes.Length -gt 1048576) { return $false }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actualDigest = 'sha256:' + [BitConverter]::ToString($sha.ComputeHash($evidenceBytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return $actualDigest -ceq $Digest
  } catch { return $false }
}

function Get-OwnerLivenessRecoveryEvidenceReadbacks {
  param(
    [Parameter(Mandatory)]$Identity,
    [Parameter(Mandatory)][string]$StateDirectory
  )
  $unavailable = [ordered]@{
    schema=$script:ownerLivenessRecoveryReferencesSchema
    status='UNAVAILABLE'
    reason_code='TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED'
  }
  try {
    $providerPath = Join-Path $StateDirectory 'provider-session-readback.json'
    $localPath = Join-Path $StateDirectory 'local-liveness-evidence-readback.json'
    if (-not (Test-Path -LiteralPath $providerPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    foreach ($path in @($providerPath,$localPath)) {
      if (-not (Test-OwnerLivenessProtectedReadFile -Path $path)) {
        $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_UNAVAILABLE'
        return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
      }
    }
    [byte[]]$providerBytes = [IO.File]::ReadAllBytes($providerPath)
    [byte[]]$localBytes = [IO.File]::ReadAllBytes($localPath)
    if ($providerBytes.Length -lt 1 -or $providerBytes.Length -gt $script:ownerLivenessMaximumBytes -or
        $localBytes.Length -lt 1 -or $localBytes.Length -gt $script:ownerLivenessMaximumBytes) {
      $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_SIZE_INVALID'
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    $provider = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($providerBytes)) -ErrorAction Stop
    $local = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($localBytes)) -ErrorAction Stop
    $providerKeys = @('schema','project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint',
      'owner_principal_id','owner_session_id','provider_session_id','observation_id','provider_job_id','observed_at','state','evidence_ref','evidence_digest')
    $localKeys = @('schema','project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint',
      'owner_principal_id','owner_session_id','provider_session_id','observation_id','provider_observation_id','observed_at','evidence_ref','evidence_digest')
    $providerActual = @($provider.PSObject.Properties.Name)
    $localActual = @($local.PSObject.Properties.Name)
    if ($null -eq $provider -or $provider -is [array] -or $providerActual.Count -ne $providerKeys.Count -or
        $null -eq $local -or $local -is [array] -or $localActual.Count -ne $localKeys.Count) {
      $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_SHAPE_INVALID'
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    foreach ($key in $providerKeys) { if ($providerActual -cnotcontains $key) { $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_SHAPE_INVALID'; return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null } } }
    foreach ($key in $localKeys) { if ($localActual -cnotcontains $key) { $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_SHAPE_INVALID'; return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null } } }
    if ([string]$provider.schema -cne $script:ownerLivenessProviderReadbackSchema -or
        [string]$local.schema -cne $script:ownerLivenessLocalEvidenceReadbackSchema -or
        [string]$provider.state -cne 'TERMINAL' -or
        ($provider.attempt_epoch -isnot [int] -and $provider.attempt_epoch -isnot [long]) -or
        ($provider.owner_generation -isnot [int] -and $provider.owner_generation -isnot [long]) -or
        ($local.attempt_epoch -isnot [int] -and $local.attempt_epoch -isnot [long]) -or
        ($local.owner_generation -isnot [int] -and $local.owner_generation -isnot [long])) {
      $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_SCHEMA_INVALID'
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    foreach ($key in @('project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint')) {
      $expectedValue = if ($Identity -is [System.Collections.IDictionary]) { $Identity[$key] } else { $Identity.$key }
      if ($provider.$key -cne $expectedValue -or $local.$key -cne $expectedValue) {
        $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_IDENTITY_MISMATCH'
        return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
      }
    }
    foreach ($key in @('owner_principal_id','owner_session_id','provider_session_id')) {
      if ($provider.$key -cne $local.$key) {
        $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_IDENTITY_MISMATCH'
        return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
      }
    }
    if ([string]$provider.owner_principal_id -cne [string]$script:ownerLivenessExpectedIdentity.owner_principal_id -or
        -not (Test-OwnerLivenessValue ([string]$provider.owner_session_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        -not (Test-OwnerLivenessValue ([string]$provider.provider_session_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        -not (Test-OwnerLivenessValue ([string]$provider.observation_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        [string]$local.provider_observation_id -cne [string]$provider.observation_id -or
        [string]$local.observation_id -ceq [string]$provider.observation_id -or
        -not (Test-OwnerLivenessValue ([string]$provider.evidence_ref) '^recovery://provider/[a-f0-9]{32}$' 80) -or
        -not (Test-OwnerLivenessValue ([string]$local.evidence_ref) '^recovery://local/[a-f0-9]{32}$' 80) -or
        -not (Test-OwnerLivenessValue ([string]$provider.evidence_digest) '^sha256:[a-f0-9]{64}$' 71) -or
        -not (Test-OwnerLivenessValue ([string]$local.evidence_digest) '^sha256:[a-f0-9]{64}$' 71)) {
      $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_METADATA_INVALID'
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    foreach ($readback in @($provider,$local)) {
      $freshness = Test-OwnerLivenessTimestamp $readback.observed_at ([DateTimeOffset]::UtcNow)
      if ($freshness -ne 'FRESH') {
        $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_STALE'
        return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
      }
    }
    if ($null -ne $provider.provider_job_id -and
        -not (Test-OwnerLivenessValue ([string]$provider.provider_job_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128)) {
      $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_JOB_ID_INVALID'
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    if (-not (Test-OwnerLivenessRecoveryEvidenceObject -Kind 'provider' -Reference ([string]$provider.evidence_ref) -Digest ([string]$provider.evidence_digest)) -or
        -not (Test-OwnerLivenessRecoveryEvidenceObject -Kind 'local' -Reference ([string]$local.evidence_ref) -Digest ([string]$local.evidence_digest))) {
      $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_DURABLE_READBACK_INVALID'
      return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
    }
    return [ordered]@{
      recovery_evidence=[ordered]@{
        schema=$script:ownerLivenessRecoveryReferencesSchema
        status='AVAILABLE'
        provider=[ordered]@{ evidence_ref=[string]$provider.evidence_ref; evidence_digest=[string]$provider.evidence_digest }
        local=[ordered]@{ evidence_ref=[string]$local.evidence_ref; evidence_digest=[string]$local.evidence_digest }
      }
      provider_readback=$provider
      local_readback=$local
    }
  } catch {
    $unavailable.reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_INVALID'
    return [ordered]@{ recovery_evidence=$unavailable; provider_readback=$null; local_readback=$null }
  }
}

function Get-OwnerLivenessSupervisorHeartbeatReadback {
  param([Parameter(Mandatory)]$Identity,[AllowNull()][string]$ProviderObservationId)
  $unavailableAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture)
  $unavailable = [ordered]@{
    readback_status='UNAVAILABLE'; state='UNAVAILABLE'; unavailability_reason='SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED'
    observed_at=$unavailableAt; supervisor_id=$null; heartbeat_id=$null; heartbeat_at_utc=$null
    boot_identity=$null; process_identity=$null; service_identity=$null; task_identity=$null
    heartbeat_evidence_ref=$null; heartbeat_evidence_digest=$null
  }
  try {
    $readbackPath = Join-Path $state 'supervisor-heartbeat-readback.json'
    if (-not (Test-OwnerLivenessProtectedReadFile -Path $readbackPath)) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_MISSING_OR_ACL_INVALID'
      return $unavailable
    }
    [byte[]]$readbackBytes = [IO.File]::ReadAllBytes($readbackPath)
    if ($readbackBytes.Length -lt 1 -or $readbackBytes.Length -gt $script:ownerLivenessMaximumBytes) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_SIZE_INVALID'
      return $unavailable
    }
    $readback = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($readbackBytes)) -ErrorAction Stop
    $readbackProperties = @(
      'schema','project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint',
      'owner_principal_id','owner_session_id','provider_session_id','supervisor_id','heartbeat_id','observed_at',
      'heartbeat_at_utc','boot_identity','process_identity','service_identity','task_identity','evidence_ref','evidence_digest'
    )
    $actualProperties = @($readback.PSObject.Properties.Name)
    if ($null -eq $readback -or $readback -is [array] -or $actualProperties.Count -ne $readbackProperties.Count) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_SHAPE_INVALID'
      return $unavailable
    }
    foreach ($name in $readbackProperties) {
      if ($actualProperties -cnotcontains $name) {
        $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_SHAPE_INVALID'
        return $unavailable
      }
    }
    if ([string]$readback.schema -cne $script:ownerLivenessHeartbeatReadbackSchema -or
        ($readback.attempt_epoch -isnot [int] -and $readback.attempt_epoch -isnot [long]) -or
        ($readback.owner_generation -isnot [int] -and $readback.owner_generation -isnot [long]) -or
        [string]$readback.project_id -cne [string]$Identity.project_id -or
        [string]$readback.provider -cne [string]$Identity.provider -or
        [string]$readback.task_id -cne [string]$Identity.task_id -or
        [string]$readback.attempt_id -cne [string]$Identity.attempt_id -or
        [int]$readback.attempt_epoch -ne [int]$Identity.attempt_epoch -or
        [int]$readback.owner_generation -ne [int]$Identity.owner_generation -or
        [string]$readback.fingerprint -cne [string]$Identity.fingerprint -or
        [string]$readback.owner_principal_id -cne [string]$script:ownerLivenessExpectedIdentity.owner_principal_id -or
        [string]$readback.task_identity -cne [string]$Identity.task_id) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_IDENTITY_MISMATCH'
      return $unavailable
    }
    foreach ($name in @('owner_session_id','provider_session_id','supervisor_id','heartbeat_id','boot_identity','process_identity','service_identity')) {
      if (-not (Test-OwnerLivenessValue ([string]$readback.$name) '^[A-Za-z0-9][A-Za-z0-9._:; -]{0,255}$' 256)) {
        $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_IDENTITY_INVALID'
        return $unavailable
      }
    }
    if (-not (Test-OwnerLivenessValue ([string]$readback.supervisor_id) '^[A-Z0-9][A-Z0-9._-]{0,79}$' 80) -or
        -not (Test-OwnerLivenessValue ([string]$readback.heartbeat_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        -not (Test-OwnerLivenessValue ([string]$readback.evidence_digest) '^sha256:[a-f0-9]{64}$' 71) -or
        -not (Test-OwnerLivenessValue ([string]$readback.evidence_ref) '^recovery://supervisor-heartbeat/[a-f0-9]{32}$' 80)) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_INVALID'
      return $unavailable
    }
    $observedAt = Test-OwnerLivenessTimestamp $readback.observed_at ([DateTimeOffset]::UtcNow)
    $heartbeatAt = Test-OwnerLivenessTimestamp $readback.heartbeat_at_utc ([DateTimeOffset]::UtcNow)
    if ($observedAt -cin @('INVALID','FUTURE') -or $heartbeatAt -cin @('INVALID','FUTURE')) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_TIME_INVALID'
      return $unavailable
    }

    $referenceMatch = [regex]::Match([string]$readback.evidence_ref,'^recovery://supervisor-heartbeat/(?<id>[a-f0-9]{32})$')
    if (-not $referenceMatch.Success) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_REFERENCE_INVALID'
      return $unavailable
    }
    $evidenceRoot = Join-Path $state 'recovery-evidence'
    $objectsRoot = Join-Path $evidenceRoot 'objects'
    $heartbeatRoot = Join-Path $objectsRoot 'supervisor-heartbeat'
    foreach ($directory in @($evidenceRoot,$objectsRoot,$heartbeatRoot)) {
      if (-not (Test-OwnerLivenessProtectedReadDirectory -Path $directory)) {
        $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_DIRECTORY_INVALID'
        return $unavailable
      }
    }
    $evidencePath = Join-Path $heartbeatRoot ($referenceMatch.Groups['id'].Value + '.json')
    if (-not (Test-OwnerLivenessProtectedReadFile -Path $evidencePath)) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_MISSING_OR_ACL_INVALID'
      return $unavailable
    }
    [byte[]]$evidenceBytes = [IO.File]::ReadAllBytes($evidencePath)
    if ($evidenceBytes.Length -lt 1 -or $evidenceBytes.Length -gt 1048576) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_SIZE_INVALID'
      return $unavailable
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actualDigest = 'sha256:' + [BitConverter]::ToString($sha.ComputeHash($evidenceBytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($actualDigest -cne [string]$readback.evidence_digest) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_DIGEST_MISMATCH'
      return $unavailable
    }
    $evidence = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($evidenceBytes)) -ErrorAction Stop
    $evidenceProperties = @($evidence.PSObject.Properties.Name)
    if ($null -eq $evidence -or $evidence -is [array] -or $evidenceProperties.Count -ne 4 -or
        ($evidenceProperties -cnotcontains 'schema') -or ($evidenceProperties -cnotcontains 'issuer_key_id') -or
        ($evidenceProperties -cnotcontains 'payload') -or ($evidenceProperties -cnotcontains 'signature') -or
        [string]$evidence.schema -cne $script:ownerLivenessHeartbeatEvidenceSchema -or
        -not (Test-OwnerLivenessValue ([string]$evidence.issuer_key_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128) -or
        -not (Test-OwnerLivenessValue ([string]$evidence.signature) '^[A-Za-z0-9+/]{86}==$' 88)) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_ENVELOPE_INVALID'
      return $unavailable
    }
    [byte[]]$signatureBytes = [Convert]::FromBase64String([string]$evidence.signature)
    if ($signatureBytes.Length -ne 64 -or [Convert]::ToBase64String($signatureBytes) -cne [string]$evidence.signature) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_SIGNATURE_INVALID'
      return $unavailable
    }
    $payload = $evidence.payload
    $payloadProperties = @(
      'observation_id','provider_observation_id','project_id','provider','task_id','attempt_id','attempt_epoch',
      'owner_generation','fingerprint','observed_at','source','state','owner_principal_id','owner_session_id',
      'provider_session_id','supervisor_id','heartbeat_id','heartbeat_at_utc','boot_identity','process_identity',
      'service_identity','task_identity'
    )
    $actualPayloadProperties = @($payload.PSObject.Properties.Name)
    if ($null -eq $payload -or $payload -is [array] -or $actualPayloadProperties.Count -ne $payloadProperties.Count) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_PAYLOAD_INVALID'
      return $unavailable
    }
    foreach ($name in $payloadProperties) {
      if ($actualPayloadProperties -cnotcontains $name) {
        $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_PAYLOAD_INVALID'
        return $unavailable
      }
    }
    foreach ($name in @('project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint',
        'owner_principal_id','owner_session_id','provider_session_id','supervisor_id','heartbeat_id','observed_at',
        'heartbeat_at_utc','boot_identity','process_identity','service_identity','task_identity')) {
      $readbackName = if ($name -eq 'observation_id') { 'heartbeat_id' } else { $name }
      if ($payload.$name -cne $readback.$readbackName) {
        $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_PAYLOAD_MISMATCH'
        return $unavailable
      }
    }
    if ([string]$payload.observation_id -cne [string]$readback.heartbeat_id -or
        [string]$payload.source -cne 'host-supervisor-heartbeat-readback' -or
        [string]$payload.state -cnotin @('ACTIVE','EXPIRED') -or
        ($ProviderObservationId -and [string]$payload.provider_observation_id -cne $ProviderObservationId) -or
        -not (Test-OwnerLivenessValue ([string]$payload.provider_observation_id) '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' 128)) {
      $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_EVIDENCE_PAYLOAD_MISMATCH'
      return $unavailable
    }
    return [ordered]@{
      readback_status='PRESENT'; state=[string]$payload.state; unavailability_reason=$null
      observed_at=[string]$readback.observed_at; supervisor_id=[string]$readback.supervisor_id
      heartbeat_id=[string]$readback.heartbeat_id; heartbeat_at_utc=[string]$readback.heartbeat_at_utc
      boot_identity=[string]$readback.boot_identity; process_identity=[string]$readback.process_identity
      service_identity=[string]$readback.service_identity; task_identity=[string]$readback.task_identity
      heartbeat_evidence_ref=[string]$readback.evidence_ref; heartbeat_evidence_digest=[string]$readback.evidence_digest
    }
  } catch {
    $unavailable.unavailability_reason='SUPERVISOR_HEARTBEAT_READBACK_INVALID'
    return $unavailable
  }
}

function New-OwnerLivenessBrokerSourceSnapshot {
  param([Parameter(Mandatory)][string]$StateDirectory)
  $processObservation = Get-OwnerLivenessProcessCandidates
  $supervisorTaskObservation = Get-OwnerLivenessSupervisorTaskObservation
  $nowUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  # OWNER_BINDING_SHA256_V1 is a local consistency fingerprint, not provider attestation.
  $identity = [ordered]@{
    project_id=$script:ownerLivenessExpectedIdentity.project_id
    provider=$script:ownerLivenessExpectedIdentity.provider
    task_id=$script:ownerLivenessExpectedIdentity.task_id
    attempt_id=$script:ownerLivenessExpectedIdentity.attempt_id
    attempt_epoch=[int]$script:ownerLivenessExpectedIdentity.attempt_epoch
    owner_generation=[int]$script:ownerLivenessExpectedIdentity.owner_generation
    fingerprint=$null
  }
  $identity.fingerprint=Get-OwnerLivenessIdentityFingerprint -Identity $identity -OwnerPrincipalId $script:ownerLivenessExpectedIdentity.owner_principal_id -OwnerScope $script:ownerLivenessExpectedIdentity.owner_scope
  $observationId = 'broker-observation-' + [Guid]::NewGuid().ToString('N')
  $component = {
    param([string]$Name,[string]$Source,[string]$State,[string]$ObservedAt,[AllowNull()][object]$ProviderObservationId=$null)
    $entry = [ordered]@{
      observation_id=('broker-' + $Name + '-' + [Guid]::NewGuid().ToString('N'))
      provider_observation_id=$ProviderObservationId
    }
    foreach ($key in $identity.Keys) { $entry[$key]=$identity[$key] }
    $entry.observed_at=$ObservedAt
    $entry.source=$Source
    $entry.state=$State
    return $entry
  }
  $process = & $component 'os-process' 'local-os-process-readback' $processObservation.state $processObservation.observed_at
  $process.process_id=$null
  $process.process_image=$null
  $process.process_principal=$null
  $process.process_started_at_utc=$null
  $process.identity_link_status=$processObservation.identity_link_status
  $process.candidate_processes=@($processObservation.records)
  $recoveryReadbacks = Get-OwnerLivenessRecoveryEvidenceReadbacks -Identity $identity -StateDirectory $StateDirectory
  $providerReadback = $recoveryReadbacks.provider_readback
  $providerObservationId = $null
  $ownerSessionId = $null
  $providerSessionId = $null
  if ($null -eq $providerReadback) {
    $provider = & $component 'provider-session' 'provider-agent-session-readback' 'UNAVAILABLE' $nowUtc
    $provider.provider_session_id=$null
    $provider.provider_job_id=$null
    $provider.unavailability_reason='PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED'
  } else {
    $providerObservationId=[string]$providerReadback.observation_id
    $ownerSessionId=[string]$providerReadback.owner_session_id
    $providerSessionId=[string]$providerReadback.provider_session_id
    $provider = & $component 'provider-session' 'provider-agent-session-readback' 'TERMINAL' ([string]$providerReadback.observed_at)
    $provider.provider_observation_id=$providerObservationId
    $provider.provider_session_id=$providerSessionId
    $provider.provider_job_id=if ($null -eq $providerReadback.provider_job_id) { $null } else { [string]$providerReadback.provider_job_id }
    $provider.unavailability_reason=$null
  }
  $process.provider_observation_id=$providerObservationId
  $heartbeatReadback = Get-OwnerLivenessSupervisorHeartbeatReadback -Identity $identity -ProviderObservationId $providerObservationId
  $supervisor = & $component 'supervisor-heartbeat' 'host-supervisor-heartbeat-readback' $heartbeatReadback.state $heartbeatReadback.observed_at $providerObservationId
  $supervisor.readback_status=$heartbeatReadback.readback_status
  $supervisor.supervisor_id=$heartbeatReadback.supervisor_id
  $supervisor.heartbeat_id=$heartbeatReadback.heartbeat_id
  $supervisor.heartbeat_at_utc=$heartbeatReadback.heartbeat_at_utc
  $supervisor.boot_identity=$heartbeatReadback.boot_identity
  $supervisor.process_identity=$heartbeatReadback.process_identity
  $supervisor.service_identity=$heartbeatReadback.service_identity
  $supervisor.task_identity=$heartbeatReadback.task_identity
  $supervisor.heartbeat_evidence_ref=$heartbeatReadback.heartbeat_evidence_ref
  $supervisor.heartbeat_evidence_digest=$heartbeatReadback.heartbeat_evidence_digest
  $supervisor.unavailability_reason=$heartbeatReadback.unavailability_reason
  $supervisor.supervisor_task_observation=$supervisorTaskObservation
  $components = [ordered]@{
    os_process=$process
    provider_agent_session=$provider
    supervisor_heartbeat=$supervisor
  }
  $snapshot = [ordered]@{ schema=$script:ownerLivenessSnapshotSchema }
  foreach ($key in $identity.Keys) { $snapshot[$key]=$identity[$key] }
  $snapshot.owner_principal_id=$script:ownerLivenessExpectedIdentity.owner_principal_id
  $snapshot.owner_scope=$script:ownerLivenessExpectedIdentity.owner_scope
  $snapshot.owner_session_id=$ownerSessionId
  $snapshot.provider_session_id=$providerSessionId
  $snapshot.observation_id=$observationId
  $snapshot.provider_observation_id=$providerObservationId
  $snapshot.observed_at=$nowUtc
  $snapshot.source=$script:ownerLivenessCollectorSource
  $snapshot.components=$components
  $snapshot.recovery_evidence=$recoveryReadbacks.recovery_evidence
  return $snapshot
}

function Get-OwnerLivenessPublicationSource {
  param([Parameter(Mandatory)][string]$StateDirectory)
  try {
    $snapshot = New-OwnerLivenessBrokerSourceSnapshot -StateDirectory $StateDirectory
    $validation = Get-OwnerLivenessSnapshotValidation -Snapshot $snapshot -NowUtc ([DateTimeOffset]::UtcNow)
    if ($validation -eq 'STALE') {
      return [ordered]@{ read_status='STALE'; publisher_status='SOURCE_STALE'; reason='OBSERVATION_STALE'; source_digest=$null; snapshot=$null; snapshot_observed_at_utc=[string]$snapshot.observed_at; recovery_evidence=$snapshot.recovery_evidence }
    }
    if ($validation -cne 'VALID') {
      return [ordered]@{ read_status='INVALID'; publisher_status='SOURCE_INVALID'; reason=$validation; source_digest=$null; snapshot=$null; snapshot_observed_at_utc=[string]$snapshot.observed_at; recovery_evidence=$snapshot.recovery_evidence }
    }
    $raw = ConvertTo-Json -InputObject $snapshot -Depth 12 -Compress
    [byte[]]$bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($raw)
    if ($bytes.Length -gt $script:ownerLivenessMaximumBytes) {
      return [ordered]@{ read_status='INVALID'; publisher_status='SOURCE_INVALID'; reason='SOURCE_TOO_LARGE'; source_digest=$null; snapshot=$null; snapshot_observed_at_utc=$null; recovery_evidence=$snapshot.recovery_evidence }
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $sourceDigest = 'sha256:' + [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return [ordered]@{
      read_status='AVAILABLE'
      publisher_status='PUBLISHED'
      reason=$null
      source_digest=$sourceDigest
      snapshot=ConvertTo-SafeOwnerLivenessSnapshot -Snapshot $snapshot
      snapshot_observed_at_utc=[string]$snapshot.observed_at
      recovery_evidence=$snapshot.recovery_evidence
    }
  } catch {
    return [ordered]@{ read_status='INVALID'; publisher_status='SOURCE_INVALID'; reason='SOURCE_COLLECTION_FAILED'; source_digest=$null; snapshot=$null; snapshot_observed_at_utc=$null; recovery_evidence=[ordered]@{schema=$script:ownerLivenessRecoveryReferencesSchema;status='UNAVAILABLE';reason_code='TRUSTED_SIGNED_EVIDENCE_READBACK_INVALID'} }
  }
}

function Get-OwnerLivenessBrokerHealthStatus {
  param([Parameter(Mandatory)][string]$PublisherStatus)
  if ($PublisherStatus -cin @('PUBLISHED','SOURCE_MISSING','SOURCE_INVALID','SOURCE_STALE')) { return 'READY' }
  return 'DEGRADED'
}

function Set-OwnerLivenessPublishedFileAcl {
  param([Parameter(Mandatory)][string]$Path)
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($script:ownerLivenessSystemSid)))
  foreach ($grant in @(
    @{ sid=$script:ownerLivenessSystemSid; rights=[Security.AccessControl.FileSystemRights]::FullControl },
    @{ sid=$script:ownerLivenessAdministratorsSid; rights=[Security.AccessControl.FileSystemRights]::FullControl },
    @{ sid=$script:ownerLivenessNetworkServiceSid; rights=[Security.AccessControl.FileSystemRights]::Read }
  )) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($grant.sid)),
      $grant.rights,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
}

function Get-OwnerLivenessPublisherIdentitySid {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $identity.User) { return $null }
  return [string]$identity.User.Value
}

function Publish-OwnerLivenessSnapshot {
  if ((Get-OwnerLivenessPublisherIdentitySid) -cne $script:ownerLivenessSystemSid) { throw 'OWNER_LIVENESS_PUBLISHER_SYSTEM_REQUIRED' }
  if (-not (Test-OwnerLivenessStateDirectoryBoundary)) { throw 'OWNER_LIVENESS_STATE_DIRECTORY_BOUNDARY_INVALID' }

  $source = Get-OwnerLivenessPublicationSource -StateDirectory $state
  $envelope = [ordered]@{
    schema=$script:ownerLivenessPublicationSchema
    read_status=$source.read_status
    publisher_status=$source.publisher_status
    reason=$source.reason
    published_at_utc=[DateTime]::UtcNow.ToString('o')
    source_digest=$source.source_digest
    snapshot_observed_at_utc=$source.snapshot_observed_at_utc
    snapshot=$source.snapshot
    recovery_evidence=$source.recovery_evidence
  }
  $targetPath = Join-Path $state 'owner-liveness.json'
  $temporaryPath = $targetPath + '.tmp.' + [Guid]::NewGuid().ToString('N')
  try {
    $json = ConvertTo-Json -InputObject $envelope -Depth 12 -Compress
    [byte[]]$bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
    $fileStream = $null
    try {
      $fileStream = [IO.FileStream]::new($temporaryPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      $fileStream.Write($bytes,0,$bytes.Length)
      # Persist snapshot bytes before the atomic rename makes the completed file visible.
      $fileStream.Flush($true)
    } finally {
      if ($fileStream) { $fileStream.Dispose() }
    }
    Set-OwnerLivenessPublishedFileAcl -Path $temporaryPath
    if (-not (Test-OwnerLivenessProtectedReadFile -Path $temporaryPath)) { throw 'OWNER_LIVENESS_TEMPORARY_ACL_INVALID' }
    if (-not (Test-OwnerLivenessStateDirectoryBoundary)) { throw 'OWNER_LIVENESS_STATE_DIRECTORY_BOUNDARY_INVALID' }
    if ([IO.File]::Exists($targetPath)) {
      # ReplaceFile preserves the destination DACL. Refuse to replace any existing target
      # whose owner, reparse status, or intended-reader ACL is not already trusted.
      if (-not (Test-OwnerLivenessProtectedReadFile -Path $targetPath)) { throw 'OWNER_LIVENESS_EXISTING_TARGET_ACL_INVALID' }
      [IO.File]::Replace($temporaryPath,$targetPath,[System.Management.Automation.Language.NullString]::Value)
    } else {
      [IO.File]::Move($temporaryPath,$targetPath)
    }
    if (-not (Test-OwnerLivenessProtectedReadFile -Path $targetPath)) { throw 'OWNER_LIVENESS_PUBLISHED_ACL_INVALID' }
  } finally {
    if ([IO.File]::Exists($temporaryPath)) { [IO.File]::Delete($temporaryPath) }
  }
  return [string]$source.publisher_status
}
