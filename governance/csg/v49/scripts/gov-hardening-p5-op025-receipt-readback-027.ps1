[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ReceiptDirectory = 'C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts'
$OutboxDirectory = 'C:\ProgramData\PTYSD\MCP\FactoryMCP\queue\outbox'
$RuntimePath = 'C:\ProgramData\PTYSD\MCP\tunnel\v0.0.14\tunnel-client.exe'
$ExpectedOperationId = 'GOV-HARDENING-P5-TUNNEL-CLI-CAPABILITY-PROBE-025'
$ExpectedProjectId = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE'
$ExpectedRunId = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-P5'
$ExpectedTaskId = 'GOV-HARDENING-P5'
$ExpectedAttemptId = 'GOV-HARDENING-P5-ATTEMPT-067'
$ExpectedAttemptEpoch = 67
$ExpectedControlOid = '209e0ad9040a08965a49109e18f783cfd9c7c7f4'
$ExpectedCheckpointDigest = 'sha256:7925c06ea87b9cd98cdd8b45fb8fe0766a99abd6cb520a76890749afce02dd2e'
$ExpectedAuthorizationEnvelopeDigest = 'sha256:cb614427a0a1755d002cd035f50d33b18208bab7e5a9d8efc42dfbc7c4d99d14'
$ExpectedCapabilityGeneration = 4
$ExpectedOperationKind = 'HOST_POWERSHELL'
$ExpectedScriptSha256 = '26c8e830f9c57f4bd1f483dfb60c13e8843be739a29dd2d776057f0eb2398b09'
# No independently pinned accepted-source/deployment runtime digest is available in this recovery plan.
$ExpectedRuntimeSha256 = $null
$MaximumReceiptFiles = 1500
$MaximumReceiptBytes = 1048576
$MaximumOutboxBytes = 262144
$MaximumProbeOutputBytes = 65536
$MaximumRuntimeBytes = 536870912

function Get-Field {
  param([object]$Object,[string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Skip-StrictJsonWhitespace {
  while ($script:StrictJsonIndex -lt $script:StrictJsonText.Length) {
    $code = [int][char]$script:StrictJsonText[$script:StrictJsonIndex]
    if ($code -notin @(9,10,13,32)) { break }
    $script:StrictJsonIndex++
  }
}

function Read-StrictJsonString {
  if ($script:StrictJsonIndex -ge $script:StrictJsonText.Length -or $script:StrictJsonText[$script:StrictJsonIndex] -ne '"') { throw 'JSON_STRING_REQUIRED' }
  $start = $script:StrictJsonIndex
  $script:StrictJsonIndex++
  $closed = $false
  while ($script:StrictJsonIndex -lt $script:StrictJsonText.Length) {
    $ch = $script:StrictJsonText[$script:StrictJsonIndex]
    $code = [int][char]$ch
    if ($ch -eq '"') { $script:StrictJsonIndex++; $closed = $true; break }
    if ($code -lt 32) { throw 'JSON_CONTROL_IN_STRING' }
    if ($ch -eq '\') {
      $script:StrictJsonIndex++
      if ($script:StrictJsonIndex -ge $script:StrictJsonText.Length) { throw 'JSON_ESCAPE_TRUNCATED' }
      $escape = $script:StrictJsonText[$script:StrictJsonIndex]
      if ($escape -eq 'u') {
        if ($script:StrictJsonIndex + 4 -ge $script:StrictJsonText.Length) { throw 'JSON_UNICODE_ESCAPE_TRUNCATED' }
        $hex = $script:StrictJsonText.Substring($script:StrictJsonIndex + 1,4)
        if ($hex -notmatch '^[0-9a-fA-F]{4}$') { throw 'JSON_UNICODE_ESCAPE_INVALID' }
        $script:StrictJsonIndex += 5
        continue
      }
      if ($escape -notin @('"','\','/','b','f','n','r','t')) { throw 'JSON_ESCAPE_INVALID' }
    }
    $script:StrictJsonIndex++
  }
  if (-not $closed) { throw 'JSON_STRING_UNTERMINATED' }
  $raw = $script:StrictJsonText.Substring($start,$script:StrictJsonIndex - $start)
  try { return [string](ConvertFrom-Json -InputObject $raw -ErrorAction Stop) } catch { throw 'JSON_STRING_INVALID' }
}

function Read-StrictJsonObject {
  param([int]$Depth)
  $script:StrictJsonIndex++
  $keys = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  Skip-StrictJsonWhitespace
  if ($script:StrictJsonIndex -lt $script:StrictJsonText.Length -and $script:StrictJsonText[$script:StrictJsonIndex] -eq '}') { $script:StrictJsonIndex++; return }
  while ($true) {
    Skip-StrictJsonWhitespace
    $key = Read-StrictJsonString
    if (-not $keys.Add($key)) { throw 'JSON_DUPLICATE_KEY' }
    Skip-StrictJsonWhitespace
    if ($script:StrictJsonIndex -ge $script:StrictJsonText.Length -or $script:StrictJsonText[$script:StrictJsonIndex] -ne ':') { throw 'JSON_COLON_REQUIRED' }
    $script:StrictJsonIndex++
    Read-StrictJsonValue -Depth ($Depth + 1)
    Skip-StrictJsonWhitespace
    if ($script:StrictJsonIndex -lt $script:StrictJsonText.Length -and $script:StrictJsonText[$script:StrictJsonIndex] -eq '}') { $script:StrictJsonIndex++; return }
    if ($script:StrictJsonIndex -ge $script:StrictJsonText.Length -or $script:StrictJsonText[$script:StrictJsonIndex] -ne ',') { throw 'JSON_OBJECT_SEPARATOR_REQUIRED' }
    $script:StrictJsonIndex++
  }
}

function Read-StrictJsonArray {
  param([int]$Depth)
  $script:StrictJsonIndex++
  Skip-StrictJsonWhitespace
  if ($script:StrictJsonIndex -lt $script:StrictJsonText.Length -and $script:StrictJsonText[$script:StrictJsonIndex] -eq ']') { $script:StrictJsonIndex++; return }
  while ($true) {
    Read-StrictJsonValue -Depth ($Depth + 1)
    Skip-StrictJsonWhitespace
    if ($script:StrictJsonIndex -lt $script:StrictJsonText.Length -and $script:StrictJsonText[$script:StrictJsonIndex] -eq ']') { $script:StrictJsonIndex++; return }
    if ($script:StrictJsonIndex -ge $script:StrictJsonText.Length -or $script:StrictJsonText[$script:StrictJsonIndex] -ne ',') { throw 'JSON_ARRAY_SEPARATOR_REQUIRED' }
    $script:StrictJsonIndex++
  }
}

function Read-StrictJsonValue {
  param([int]$Depth)
  if ($Depth -gt 64) { throw 'JSON_TOO_DEEP' }
  Skip-StrictJsonWhitespace
  if ($script:StrictJsonIndex -ge $script:StrictJsonText.Length) { throw 'JSON_VALUE_REQUIRED' }
  $ch = $script:StrictJsonText[$script:StrictJsonIndex]
  if ($ch -eq '{') { Read-StrictJsonObject -Depth $Depth; return }
  if ($ch -eq '[') { Read-StrictJsonArray -Depth $Depth; return }
  if ($ch -eq '"') { [void](Read-StrictJsonString); return }
  $start = $script:StrictJsonIndex
  while ($script:StrictJsonIndex -lt $script:StrictJsonText.Length) {
    $code = [int][char]$script:StrictJsonText[$script:StrictJsonIndex]
    if ($code -in @(9,10,13,32,44,93,125)) { break }
    $script:StrictJsonIndex++
  }
  $token = $script:StrictJsonText.Substring($start,$script:StrictJsonIndex - $start)
  if ($token -notin @('true','false','null') -and $token -notmatch '^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$') { throw 'JSON_TOKEN_INVALID' }
}

function Assert-StrictJsonText {
  param([Parameter(Mandatory)][string]$Text)
  $script:StrictJsonText = $Text
  $script:StrictJsonIndex = 0
  Read-StrictJsonValue -Depth 0
  Skip-StrictJsonWhitespace
  if ($script:StrictJsonIndex -ne $script:StrictJsonText.Length) { throw 'JSON_TRAILING_DATA' }
}

function Read-BoundedUtf8Text {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][long]$MaximumBytes)
  $attributes = [System.IO.File]::GetAttributes($Path)
  if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT_REJECTED' }
  $stream = New-Object System.IO.FileStream($Path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)
  $memory = New-Object System.IO.MemoryStream
  try {
    if ($stream.Length -gt $MaximumBytes) { throw 'JSON_FILE_TOO_LARGE' }
    $buffer = New-Object byte[] 8192
    while (($read = $stream.Read($buffer,0,$buffer.Length)) -gt 0) {
      if (($memory.Length + $read) -gt $MaximumBytes) { throw 'JSON_FILE_TOO_LARGE' }
      $memory.Write($buffer,0,$read)
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false,$true)
    return $utf8.GetString($memory.ToArray())
  } finally {
    $memory.Dispose()
    $stream.Dispose()
  }
}

function Read-BoundedJsonObject {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][long]$MaximumBytes)
  $text = Read-BoundedUtf8Text -Path $Path -MaximumBytes $MaximumBytes
  Assert-StrictJsonText -Text $text
  $value = ConvertFrom-Json -InputObject $text -ErrorAction Stop
  if ($null -eq $value -or $value -is [string] -or $value -is [System.Array] -or $value -is [ValueType]) { throw 'JSON_OBJECT_REQUIRED' }
  return $value
}

function Get-SafeMetadata {
  param([object]$Receipt)
  $metadata = [ordered]@{}
  $invalidIdentityMetadataFields = New-Object System.Collections.Generic.List[string]
  $optionalIdentityMetadataFields = @('schema','schema_version','operation_kind','operation_class')
  foreach ($name in @('schema','schema_version','request_id','state','project_id','capability_id','operation_id','operation_kind','operation_class','control_oid','checkpoint_digest','authorization_envelope_digest','run_id','task_id','attempt_id','script_sha256','side_effect_state','started_at_utc','finished_at_utc')) {
    $property = $Receipt.PSObject.Properties[$name]
    if ($null -eq $property) { $metadata[$name] = $null; continue }
    $value = $property.Value
    if ($null -eq $value) {
      $metadata[$name] = $null
      if ($optionalIdentityMetadataFields -contains $name) { $invalidIdentityMetadataFields.Add($name) }
      continue
    }
    if ($value -isnot [string]) {
      $metadata[$name] = $null
      if ($optionalIdentityMetadataFields -contains $name) { $invalidIdentityMetadataFields.Add($name) }
      continue
    }
    $text = [string]$value
    if ($text.Length -le 256 -and $text -match '^[A-Za-z0-9._:/+-]+$') {
      $metadata[$name] = $text
    } else {
      $metadata[$name] = $null
      if ($optionalIdentityMetadataFields -contains $name) { $invalidIdentityMetadataFields.Add($name) }
    }
  }
  $metadata['invalid_identity_metadata_fields'] = @($invalidIdentityMetadataFields.ToArray())
  foreach ($name in @('attempt_epoch','capability_generation','timeout_seconds','exit_code','stdout_bytes','stderr_bytes')) {
    $value = Get-Field $Receipt $name
    if ($null -ne $value -and $value -is [ValueType] -and [long]$value -eq $value -and [long]$value -ge 0 -and [long]$value -le 2147483647) { $metadata[$name] = [long]$value } else { $metadata[$name] = $null }
  }
  $value = Get-Field $Receipt 'timed_out'
  if ($value -is [bool]) { $metadata['timed_out'] = [bool]$value } else { $metadata['timed_out'] = $null }
  foreach ($name in @('stdout_sha256','stderr_sha256')) {
    $value = [string](Get-Field $Receipt $name)
    if ($value -match '^(?:sha256:)?[0-9a-fA-F]{64}$') { $metadata[$name] = $value.ToLowerInvariant().Replace('sha256:','') } else { $metadata[$name] = $null }
  }
  return $metadata
}

function Get-ExpectedProbeSummary {
  param([object]$Outbox)
  $stdout = Get-Field $Outbox 'stdout'
  if ($stdout -isnot [string]) {
    $result = Get-Field $Outbox 'result'
    $stdout = Get-Field $result 'stdout'
  }
  if ($stdout -isnot [string] -or [System.Text.Encoding]::UTF8.GetByteCount($stdout) -gt $MaximumProbeOutputBytes) { return $null }
  try { Assert-StrictJsonText -Text $stdout; $probe = ConvertFrom-Json -InputObject $stdout -ErrorAction Stop } catch { return $null }
  if ((Get-Field $probe 'schema') -cne 'v49.p5.tunnel-cli-capability-probe.v2') { return $null }
  $summary = [ordered]@{ schema = 'v49.p5.tunnel-cli-capability-probe.v2' }
  foreach ($name in @('readback_only','native_http_mtls_supported','admin_tunnel_create_supported','no_help_text_output','no_secret_value_output','no_file_mutation')) {
    $value = Get-Field $probe $name
    if ($value -isnot [bool]) { return $null }
    $summary[$name] = [bool]$value
  }
  $runtimeHash = [string](Get-Field $probe 'runtime_sha256')
  if ($runtimeHash -notmatch '^[0-9a-fA-F]{64}$') { return $null }
  $summary['runtime_sha256'] = $runtimeHash.ToLowerInvariant()
  return $summary
}

$historicalOutcome = 'NO_RECEIPT_FOUND'
$currentTargetState = 'NOT_VERIFIED'
$runtimePresent = $false
$runtimeSha256 = $null
$reconciliationRequired = $false
$scanComplete = $true
$scanIssueCount = 0
$receiptFiles = New-Object System.Collections.Generic.List[System.IO.FileInfo]
$receiptMatches = New-Object System.Collections.Generic.List[object]
$candidateReceiptIssueCount = 0
$outboxResults = New-Object System.Collections.Generic.List[object]

try {
  if (-not [System.IO.Directory]::Exists($ReceiptDirectory)) { throw 'RECEIPT_DIRECTORY_MISSING' }
  foreach ($filePath in [System.IO.Directory]::EnumerateFiles($ReceiptDirectory,'*.json',[System.IO.SearchOption]::TopDirectoryOnly)) {
    if ($receiptFiles.Count -ge $MaximumReceiptFiles) { $scanComplete = $false; break }
    $receiptFiles.Add((New-Object System.IO.FileInfo($filePath)))
  }
  foreach ($file in $receiptFiles) {
    try {
      $attributes = [System.IO.File]::GetAttributes($file.FullName)
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $scanIssueCount++; continue }
      if ($file.Length -gt $MaximumReceiptBytes) { $scanIssueCount++; continue }
      $text = Read-BoundedUtf8Text -Path $file.FullName -MaximumBytes $MaximumReceiptBytes
      if ($text.IndexOf($ExpectedOperationId,[System.StringComparison]::Ordinal) -lt 0) { continue }
      try { Assert-StrictJsonText -Text $text; $receipt = ConvertFrom-Json -InputObject $text -ErrorAction Stop } catch { $scanIssueCount++; $candidateReceiptIssueCount++; continue }
      if ($null -eq $receipt -or $receipt -is [System.Array]) { $scanIssueCount++; $candidateReceiptIssueCount++; continue }
      $observedOperationId = Get-Field $receipt 'operation_id'
      if ($null -eq $observedOperationId) { $scanIssueCount++; $candidateReceiptIssueCount++; continue }
      if ($observedOperationId -cne $ExpectedOperationId) { continue }
      $receiptMatches.Add((Get-SafeMetadata $receipt))
    } catch { $scanIssueCount++ }
  }
} catch {
  $scanComplete = $false
  $scanIssueCount++
}

if ($receiptMatches.Count -gt 1) {
  $historicalOutcome = 'AMBIGUOUS'
  $reconciliationRequired = $true
} elseif ($receiptMatches.Count -eq 1) {
  $meta = $receiptMatches[0]
  $receiptScriptHash = ([string]$meta.script_sha256).Replace('sha256:','')
  $identityOk = $meta.project_id -ceq $ExpectedProjectId -and $meta.operation_id -ceq $ExpectedOperationId -and $meta.run_id -ceq $ExpectedRunId -and $meta.task_id -ceq $ExpectedTaskId -and $meta.attempt_id -ceq $ExpectedAttemptId -and $meta.attempt_epoch -eq $ExpectedAttemptEpoch -and $meta.control_oid -ceq $ExpectedControlOid -and $meta.checkpoint_digest -ceq $ExpectedCheckpointDigest -and $meta.authorization_envelope_digest -ceq $ExpectedAuthorizationEnvelopeDigest -and $meta.capability_generation -eq $ExpectedCapabilityGeneration -and $receiptScriptHash -ieq $ExpectedScriptSha256
  if (@($meta.invalid_identity_metadata_fields).Count -gt 0) { $identityOk = $false }
  if ($null -ne $meta.schema -and $meta.schema -notmatch '(?i)receipt') { $identityOk = $false }
  if ($null -ne $meta.schema_version -and [string]::IsNullOrWhiteSpace($meta.schema_version)) { $identityOk = $false }
  if ($null -ne $meta.operation_kind -and $meta.operation_kind -cne $ExpectedOperationKind) { $identityOk = $false }
  if ($null -ne $meta.operation_class -and $meta.operation_class -cne $ExpectedOperationKind) { $identityOk = $false }
  if (-not $identityOk) {
    $historicalOutcome = 'MALFORMED_EVIDENCE'
    $reconciliationRequired = $true
  } else {
    $requestId = [string]$meta.request_id
    if ($requestId -notmatch '^[0-9a-fA-F]{32}$') {
      $historicalOutcome = 'MALFORMED_EVIDENCE'
      $reconciliationRequired = $true
    } else {
      $outboxPath = Join-Path $OutboxDirectory ($requestId.ToLowerInvariant() + '.json')
      $outboxFound = $false
      $probeSummary = $null
      if ([System.IO.File]::Exists($outboxPath)) {
        try {
          $outbox = Read-BoundedJsonObject -Path $outboxPath -MaximumBytes $MaximumOutboxBytes
          $outboxFound = ((Get-Field $outbox 'request_id') -ceq $requestId)
          if ($outboxFound) { $probeSummary = Get-ExpectedProbeSummary $outbox }
          if (-not $outboxFound) { $scanIssueCount++ }
        } catch { $scanIssueCount++ }
      }
      $outboxResults.Add([ordered]@{request_id=$requestId.ToLowerInvariant();present=$outboxFound;expected_boolean_summary=$probeSummary})
      if ($meta.timed_out -eq $true -or $meta.state -match '^(?i:TIMED[_ -]?OUT)$') {
        $historicalOutcome = 'PROVEN_TIMED_OUT'
      } elseif ($meta.state -match '^(?i:ORPHANED)$') {
        $historicalOutcome = 'PROVEN_ORPHANED'
      } elseif (($meta.exit_code -is [long] -and $meta.exit_code -ne 0) -or $meta.state -match '^(?i:FAILED|REJECTED)$') {
        $historicalOutcome = 'PROVEN_FAILED'
      } elseif ($meta.exit_code -eq 0 -and $meta.timed_out -eq $false -and $meta.state -match '^(?i:COMPLETED|SUCCEEDED|SUCCEEDED_WITH_WARNINGS)$') {
        $historicalOutcome = 'PROVEN_COMPLETED'
      } else {
        $historicalOutcome = 'MALFORMED_EVIDENCE'
        $reconciliationRequired = $true
      }
      if (-not $outboxFound -or $null -eq $probeSummary) { $reconciliationRequired = $true }
    }
  }
}

if (-not $scanComplete -or $scanIssueCount -gt 0) {
  if ($historicalOutcome -eq 'NO_RECEIPT_FOUND') { $historicalOutcome = 'MALFORMED_EVIDENCE' }
  $reconciliationRequired = $true
}
if ($candidateReceiptIssueCount -gt 0) {
  $historicalOutcome = 'MALFORMED_EVIDENCE'
  $reconciliationRequired = $true
}

try {
  if ([System.IO.File]::Exists($RuntimePath)) {
    $runtimePresent = $true
    $runtimeItem = Get-Item -LiteralPath $RuntimePath -ErrorAction Stop
    if (($runtimeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $runtimeItem.Length -gt $MaximumRuntimeBytes) { throw 'RUNTIME_FILE_OUT_OF_BOUNDS' }
    $runtimeSha256 = (Get-FileHash -LiteralPath $RuntimePath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    if ($ExpectedRuntimeSha256 -is [string] -and $ExpectedRuntimeSha256 -match '^[0-9a-f]{64}$' -and $runtimeSha256 -ceq $ExpectedRuntimeSha256.ToLowerInvariant()) { $currentTargetState = 'VERIFIED' }
  }
} catch {
  $currentTargetState = 'NOT_VERIFIED'
}

$metadataOutput = @($receiptMatches.ToArray() | Sort-Object { $_.request_id })
$outboxMetadataOutput = $outboxResults.ToArray()
[ordered]@{
  schema = 'v49.p5.op025.recovery-readback.v1'
  historical_operation_id = $ExpectedOperationId
  historical_execution_outcome = $historicalOutcome
  current_target_state = $currentTargetState
  runtime_present = [bool]$runtimePresent
  runtime_sha256 = $runtimeSha256
  runtime_expected_sha256_pinned = [bool]($ExpectedRuntimeSha256 -is [string] -and $ExpectedRuntimeSha256 -match '^[0-9a-f]{64}$')
  matching_receipt_count = $receiptMatches.Count
  matching_receipts = $metadataOutput
  matching_outbox = $outboxMetadataOutput
  receipt_scan = [ordered]@{complete=[bool]$scanComplete;bounded_file_limit=$MaximumReceiptFiles;files_examined=$receiptFiles.Count;scan_issue_count=$scanIssueCount}
  reconciliation_required = [bool]$reconciliationRequired
  op025_redispatch_performed = $false
  live_cli_probe_performed = $false
  no_raw_stdout_or_stderr_output = $true
  no_secret_value_output = $true
  no_file_mutation = $true
  observed_at_utc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 12 -Compress
