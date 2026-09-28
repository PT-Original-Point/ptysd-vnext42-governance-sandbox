[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$brokerPath = Join-Path $PSScriptRoot '..\broker\hostguard-broker.ps1'
$brokerPath = (Resolve-Path -LiteralPath $brokerPath).Path
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($brokerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('BROKER_PARSE_FAILED:' + $parseErrors[0].Message) }

$functionNames = @(
  'ConvertTo-BoundedReceiptToken',
  'ConvertTo-BoundedReceiptTimestamp',
  'ConvertTo-BoundedReceiptInteger',
  'Get-ReceiptPropertyValue',
  'Get-ReceiptFileSha256',
  'Read-ReceiptSnapshot',
  'ConvertTo-OrphanReceiptStatusRecord',
  'Get-OrphanReceiptStatusView',
  'Reconcile-OrphanedStartedReceipts',
  'Get-HostExecLaneStatus'
)
$functionAsts = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $functionNames -contains $node.Name
}, $true))
if ($functionAsts.Count -ne $functionNames.Count) { throw 'ORPHAN_VIEW_FUNCTIONS_MISSING' }

$maxOrphanStatusRecords = 16
$maxOrphanStatusBytes = 524288
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('ptysd-orphan-view-test-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $tempRoot) { throw 'TEST_TEMP_PATH_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  $execReceipts = $tempRoot
  $functionSource = [string]::Join([Environment]::NewLine, @($functionAsts | ForEach-Object { $_.Extent.Text }))
  Invoke-Expression $functionSource
  $script:receiptSummary = [ordered]@{
    broker_records=0; orphan_count=0; started_count=0; terminal_count=0; recorded_at_utc=$null
    orphan_status_read_status='UNAVAILABLE'; orphan_status_records=@(); orphan_status_complete=$false
  }
  $script:activePowerShellJobs = @{}
  $maxConcurrentPowerShell = 4
  $maxPerRunPowerShell = 1
  $staleGraceSeconds = 5
  function Get-ActivePowerShellEntries { return @() }
  function Get-LatestHostExecReceipt {
    return [pscustomobject]@{
      state='ORPHANED'; request_id=('{0:x32}' -f 1); run_id='V50-R3-001'; task_id='R3-P0-03-READBACK'
      attempt_id='ATTEMPT-001'; attempt_epoch=1; started_at_utc='2026-09-27T06:00:00.000Z'
    }
  }
  $script:receiptSnapshotReadCount = 0
  $script:readReceiptSnapshotImplementation = (Get-Command Read-ReceiptSnapshot -CommandType Function).ScriptBlock
  function Read-ReceiptSnapshot {
    param([Parameter(Mandatory)][string]$Path)
    $script:receiptSnapshotReadCount += 1
    return & $script:readReceiptSnapshotImplementation -Path $Path
  }

  foreach ($number in 1..5) {
    $requestId = '{0:x32}' -f $number
    $operationKey = if (($number % 2) -eq 0) { '{0:x64}' -f $number } else { $null }
    $receipt = [ordered]@{
      state = 'ORPHANED'
      request_id = $requestId
      project_id = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE'
      capability_id = 'CAP-GOV-SYSTEM-V1'
      operation_id = 'OP025'
      control_oid = '209e0ad9040a08965a49109e18f783cfd9c7c7f4'
      checkpoint_digest = ('sha256:' + ('a' * 64))
      authorization_envelope_digest = ('sha256:' + ('b' * 64))
      capability_generation = 4
      run_id = 'V50-R3-001'
      task_id = 'R3-P0-03-READBACK'
      attempt_id = 'ATTEMPT-001'
      attempt_epoch = 1
      started_at_utc = '2026-09-27T06:00:00.000Z'
      finished_at_utc = '2026-09-27T06:01:00.000Z'
      timeout_seconds = 60
      side_effect_state = 'UNKNOWN_AFTER_BROKER_RESTART'
      error_code = 'BROKER_RECEIPT_ORPHANED'
      stdout = 'MUST_NOT_LEAK'
      stderr = 'MUST_NOT_LEAK'
      script = 'MUST_NOT_LEAK'
      receipt_path = 'MUST_NOT_LEAK'
      run_as = 'MUST_NOT_LEAK'
    }
    if ($operationKey) {
      $receipt.operation_key = $operationKey
      $receipt.trusted_caller_sid = 'S-1-5-20'
    }
    $receiptFileName = if ($operationKey) { $operationKey + '.json' } else { $requestId + '.json' }
    $receiptPath = Join-Path $tempRoot $receiptFileName
    [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
  }

  $before = @{}
  foreach ($file in @(Get-ChildItem -LiteralPath $tempRoot -Filter '*.json' -File)) {
    $before[$file.Name] = [ordered]@{
      sha256 = Get-ReceiptFileSha256 -Path $file.FullName
      last_write_utc = $file.LastWriteTimeUtc.Ticks
    }
  }

  Reconcile-OrphanedStartedReceipts
  if ($script:receiptSnapshotReadCount -ne 5) { throw 'INITIAL_ORPHAN_SNAPSHOT_COUNT_UNEXPECTED' }
  $script:receiptSnapshotReadCount = 0
  $view = Get-HostExecLaneStatus
  if ($script:receiptSnapshotReadCount -ne 0) { throw 'STATUS_READ_OPENED_RECEIPT_FILES' }
  if ($view.orphan_records_read_status -ne 'COMPLETE') { throw ('ORPHAN_VIEW_STATUS:' + $view.orphan_records_read_status) }
  if ([int]$view.orphan_records_total_count -ne 5 -or @($view.orphan_records).Count -ne 5 -or [bool]$view.orphan_records_truncated) { throw 'ORPHAN_VIEW_BOUND_FAILED' }
  $first = @($view.orphan_records | Where-Object { $_.request_id -eq ('{0:x32}' -f 1) })[0]
  if (-not $first -or $first.state -ne 'ORPHANED' -or $first.run_id -ne 'V50-R3-001') { throw 'ORPHAN_IDENTITY_MISSING' }
  if ($first.receipt_digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'ORPHAN_RECEIPT_DIGEST_MISSING' }
  if ($first.receipt_digest -ne $before[('{0:x32}' -f 1) + '.json'].sha256) { throw 'ORPHAN_DIGEST_DOES_NOT_BIND_PARSED_RECEIPT' }
  if ($null -ne $first.operation_key -or $null -ne $first.trusted_caller_sid) { throw 'LEGACY_ORPHAN_OPTIONAL_IDENTITY_NOT_NULL' }
  $stable = @($view.orphan_records | Where-Object { $_.request_id -eq ('{0:x32}' -f 2) })[0]
  if (-not $stable -or $stable.operation_key -ne ('{0:x64}' -f 2) -or $stable.trusted_caller_sid -ne 'S-1-5-20') { throw 'STABLE_ORPHAN_IDENTITY_MISSING' }
  foreach ($name in @('stdout','stderr','script','receipt_path','run_as')) {
    if ($first.PSObject.Properties.Name -contains $name) { throw ('SENSITIVE_FIELD_EXPOSED:' + $name) }
  }

  foreach ($file in @(Get-ChildItem -LiteralPath $tempRoot -Filter '*.json' -File)) {
    $previous = $before[$file.Name]
    $currentHash = Get-ReceiptFileSha256 -Path $file.FullName
    if ($currentHash -ne $previous.sha256 -or $file.LastWriteTimeUtc.Ticks -ne $previous.last_write_utc) { throw 'ORPHAN_READ_MUTATED_RECEIPT' }
  }

  $scaleRoot = Join-Path $tempRoot 'scale'
  New-Item -ItemType Directory -Path $scaleRoot | Out-Null
  $execReceipts = $scaleRoot
  foreach ($number in 1..48) {
    $requestId = '{0:x32}' -f $number
    $receipt = [ordered]@{
      state='ORPHANED'; request_id=$requestId; project_id='CHATGPT_GLOBAL_SKILL_GOVERNANCE'
      capability_id='CAP-GOV-SYSTEM-V1'; operation_id='OP025'; control_oid='209e0ad9040a08965a49109e18f783cfd9c7c7f4'
      checkpoint_digest=('sha256:' + ('a' * 64)); authorization_envelope_digest=('sha256:' + ('b' * 64))
      capability_generation=4; run_id='V50-R3-001'; task_id='R3-P0-03-READBACK'; attempt_id='ATTEMPT-001'; attempt_epoch=1
      started_at_utc='2026-09-27T06:00:00.000Z'; finished_at_utc='2026-09-27T06:01:00.000Z'; timeout_seconds=60
      side_effect_state='UNKNOWN_AFTER_BROKER_RESTART'; error_code='BROKER_RECEIPT_ORPHANED'
    }
    $path = Join-Path $scaleRoot ($requestId + '.json')
    [IO.File]::WriteAllText($path, ($receipt | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
  }
  $script:receiptSnapshotReadCount = 0
  Reconcile-OrphanedStartedReceipts
  $reconcileSnapshotReads = $script:receiptSnapshotReadCount
  if ($reconcileSnapshotReads -ne $maxOrphanStatusRecords) { throw 'RECONCILIATION_METADATA_READS_NOT_CAPPED' }
  $script:receiptSnapshotReadCount = 0
  $scaleView = Get-HostExecLaneStatus
  if ($script:receiptSnapshotReadCount -ne 0) { throw 'SCALED_STATUS_READ_OPENED_RECEIPT_FILES' }
  if ($scaleView.orphan_records_read_status -ne 'COMPLETE' -or [int]$scaleView.orphan_records_total_count -ne 48) { throw 'SCALED_ORPHAN_COUNT_NOT_EXACT' }
  if (@($scaleView.orphan_records).Count -ne $maxOrphanStatusRecords -or -not [bool]$scaleView.orphan_records_truncated) { throw 'SCALED_ORPHAN_CACHE_NOT_BOUNDED' }

  $oversizedRoot = Join-Path $tempRoot 'oversized'
  New-Item -ItemType Directory -Path $oversizedRoot | Out-Null
  $execReceipts = $oversizedRoot
  $oversizedRequestId = 'ffffffffffffffffffffffffffffffff'
  $oversizedPath = Join-Path $oversizedRoot ($oversizedRequestId + '.json')
  $oversizedJson = '{"state":"ORPHANED","request_id":"' + $oversizedRequestId + '","padding":"' + ('x' * ($maxOrphanStatusBytes + 1)) + '"}'
  [IO.File]::WriteAllText($oversizedPath, $oversizedJson, (New-Object Text.UTF8Encoding($false)))
  $script:receiptSnapshotReadCount = 0
  Reconcile-OrphanedStartedReceipts
  $script:receiptSnapshotReadCount = 0
  $partialView = Get-HostExecLaneStatus
  if ($script:receiptSnapshotReadCount -ne 0) { throw 'OVERSIZED_STATUS_READ_OPENED_RECEIPT_FILES' }
  if ($partialView.orphan_records_read_status -ne 'PARTIAL' -or -not [bool]$partialView.orphan_records_truncated) { throw 'OVERSIZED_RECEIPT_NOT_FAILED_CLOSED' }

  [ordered]@{
    result='PASS'; initial_total_count=$view.orphan_records_total_count; initial_returned_count=@($view.orphan_records).Count
    scale_total_count=$scaleView.orphan_records_total_count; scale_returned_count=@($scaleView.orphan_records).Count
    reconcile_snapshot_reads=$reconcileSnapshotReads; status_snapshot_reads=0
    receipt_bytes_unchanged=$true; oversized_receipt_fail_closed=$true
  } | ConvertTo-Json -Compress
} finally {
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  if ($resolvedTemp.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemp) -like 'ptysd-orphan-view-test-*') {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  } else {
    throw 'TEST_CLEANUP_PATH_REJECTED'
  }
}
