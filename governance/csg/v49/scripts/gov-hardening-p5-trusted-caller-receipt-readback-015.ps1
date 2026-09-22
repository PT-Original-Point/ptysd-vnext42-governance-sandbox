Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ids=@('4c4430ebbf9b45adaca43abb470ad52a','ff01ca022c064bf399b91400199af258')
$root='C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts'
function Receipt([string]$id){
 $p=Join-Path $root ($id+'.json')
 if(!(Test-Path -LiteralPath $p -PathType Leaf)){return [ordered]@{request_id=$id;present=$false}}
 try{$j=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json -ErrorAction Stop}catch{return [ordered]@{request_id=$id;present=$true;parse_ok=$false}}
 return [ordered]@{request_id=$id;present=$true;parse_ok=$true;schema=$j.schema;state=$j.state;project_id=$j.project_id;operation_id=$j.operation_id;run_id=$j.run_id;task_id=$j.task_id;attempt_id=$j.attempt_id;attempt_epoch=$j.attempt_epoch;timed_out=$j.timed_out;exit_code=$j.exit_code;side_effect_state=$j.side_effect_state;script_sha256=$j.script_sha256;stdout_bytes=$j.stdout_bytes;stderr_bytes=$j.stderr_bytes;stdout_sha256=$j.stdout_sha256;stderr_sha256=$j.stderr_sha256;started_at_utc=$j.started_at_utc;finished_at_utc=$j.finished_at_utc}
}
$receipts=@()
$receipts += (Receipt $ids[0])
$receipts += (Receipt $ids[1])
$stage='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$dir=Join-Path $stage 'trusted-caller-live-a50'
$js=Join-Path $stage 'trusted-caller-live-a50.mjs'
$procs=@()
try{foreach($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.Name -eq 'node.exe'})){$cmd=[string]$p.CommandLine;if($cmd -match '(?i)(trusted-caller-live-a50|http-main\.mjs)'){$procs+=[ordered]@{pid=[int]$p.ProcessId;matches_canary=[bool]($cmd-match'trusted-caller-live-a50');matches_http=[bool]($cmd-match'http-main\.mjs')}}}}catch{}
[ordered]@{schema='v49.p5.trusted-caller-receipt-reconciliation.v2';readback_only=$true;receipts=$receipts;canary_dir_present=[bool](Test-Path -LiteralPath $dir);canary_js_present=[bool](Test-Path -LiteralPath $js -PathType Leaf);stdout_file_present=[bool](Test-Path -LiteralPath ($js+'.out') -PathType Leaf);stderr_file_present=[bool](Test-Path -LiteralPath ($js+'.err') -PathType Leaf);matching_processes=$procs;no_output_content_read=$true;no_file_delete=$true;no_process_kill=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 7 -Compress
