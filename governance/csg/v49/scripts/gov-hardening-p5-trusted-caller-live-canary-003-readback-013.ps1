Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$requestId='4c4430ebbf9b45adaca43abb470ad52a'
$receiptPath=Join-Path 'C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts' ($requestId+'.json')
$root='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$canaryDir=Join-Path $root 'trusted-caller-live-a50'
$canaryJs=Join-Path $root 'trusted-caller-live-a50.mjs'
$outPath=$canaryJs+'.out'
$errPath=$canaryJs+'.err'
function P($o,[string]$n){if($null-eq$o){return $null};if($o.PSObject.Properties.Name -contains $n){return $o.$n};return $null}
$r=$null
if(Test-Path -LiteralPath $receiptPath -PathType Leaf){try{$r=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{}}
$procs=@()
try{foreach($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.Name -eq 'node.exe'})){$cmd=[string]$p.CommandLine;if($cmd -match '(?i)(trusted-caller-live-a50|http-main\.mjs)'){$procs+=[ordered]@{pid=[int]$p.ProcessId;matches_canary=[bool]($cmd-match'trusted-caller-live-a50');matches_http=[bool]($cmd-match'http-main\.mjs');created=if($p.CreationDate){([DateTime]$p.CreationDate).ToUniversalTime().ToString('o')}else{$null}}}}}catch{}
[ordered]@{
 schema='v49.p5.trusted-caller-canary-receipt-readback.v1'
 readback_only=$true
 request_id=$requestId
 receipt=[ordered]@{
  present=[bool](Test-Path -LiteralPath $receiptPath -PathType Leaf)
  schema=P $r 'schema'
  state=P $r 'state'
  project_id=P $r 'project_id'
  operation_id=P $r 'operation_id'
  run_id=P $r 'run_id'
  task_id=P $r 'task_id'
  attempt_id=P $r 'attempt_id'
  attempt_epoch=P $r 'attempt_epoch'
  timed_out=P $r 'timed_out'
  exit_code=P $r 'exit_code'
  side_effect_state=P $r 'side_effect_state'
  script_sha256=P $r 'script_sha256'
  stdout_bytes=P $r 'stdout_bytes'
  stderr_bytes=P $r 'stderr_bytes'
  stdout_sha256=P $r 'stdout_sha256'
  stderr_sha256=P $r 'stderr_sha256'
  started_at_utc=P $r 'started_at_utc'
  finished_at_utc=P $r 'finished_at_utc'
 }
 canary_dir_present=[bool](Test-Path -LiteralPath $canaryDir)
 canary_js_present=[bool](Test-Path -LiteralPath $canaryJs -PathType Leaf)
 stdout_file_present=[bool](Test-Path -LiteralPath $outPath -PathType Leaf)
 stderr_file_present=[bool](Test-Path -LiteralPath $errPath -PathType Leaf)
 matching_processes=$procs
 no_output_content_read=$true
 no_file_delete=$true
 no_process_kill=$true
 observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 7 -Compress
