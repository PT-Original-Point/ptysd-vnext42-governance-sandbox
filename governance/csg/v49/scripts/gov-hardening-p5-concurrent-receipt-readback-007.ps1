Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$requestId='5237c483c10f42f995d52c935a89dc62'
$path=Join-Path 'C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts' ($requestId+'.json')
if(!(Test-Path -LiteralPath $path -PathType Leaf)){
  [ordered]@{schema='v49.p5.concurrent-receipt-readback.v1';request_id=$requestId;present=$false;readback_only=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
  exit 0
}
try{$j=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json -ErrorAction Stop}catch{
  [ordered]@{schema='v49.p5.concurrent-receipt-readback.v1';request_id=$requestId;present=$true;parse_ok=$false;readback_only=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
  exit 0
}
[ordered]@{
  schema='v49.p5.concurrent-receipt-readback.v1'
  request_id=$requestId
  present=$true
  parse_ok=$true
  receipt_schema=$j.schema
  state=$j.state
  project_id=$j.project_id
  operation_id=$j.operation_id
  run_id=$j.run_id
  task_id=$j.task_id
  attempt_id=$j.attempt_id
  attempt_epoch=$j.attempt_epoch
  timed_out=$j.timed_out
  exit_code=$j.exit_code
  side_effect_state=$j.side_effect_state
  script_sha256=$j.script_sha256
  started_at_utc=$j.started_at_utc
  finished_at_utc=$j.finished_at_utc
  stdout_bytes=$j.stdout_bytes
  stderr_bytes=$j.stderr_bytes
  readback_only=$true
  no_stdout_or_stderr_content_output=$true
  no_file_delete=$true
  no_process_kill=$true
  observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 4 -Compress
