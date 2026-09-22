Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$requestId='95052d4a578c46aebf04156aa2d6af79'
$root='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$factory=Join-Path $root 'tools\csg\factory-mcp'
$harness=Join-Path $factory 'tests\windows-mtls-staging.mjs'
$fixture=Join-Path $root 'mtls-fixture-a42'
$receiptPath=Join-Path 'C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts' ($requestId+'.json')
$git='C:\Program Files\Git\cmd\git.exe'
$receipt=$null
if(Test-Path -LiteralPath $receiptPath -PathType Leaf){try{$receipt=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{}}
$receiptSafe=[ordered]@{present=[bool](Test-Path -LiteralPath $receiptPath -PathType Leaf);state=$receipt.state;operation_id=$receipt.operation_id;attempt_id=$receipt.attempt_id;attempt_epoch=$receipt.attempt_epoch;timed_out=$receipt.timed_out;exit_code=$receipt.exit_code;side_effect_state=$receipt.side_effect_state;script_sha256=$receipt.script_sha256;started_at_utc=$receipt.started_at_utc;finished_at_utc=$receipt.finished_at_utc;stdout_bytes=$receipt.stdout_bytes;stderr_bytes=$receipt.stderr_bytes;stdout_sha256=$receipt.stdout_sha256;stderr_sha256=$receipt.stderr_sha256}
$harnessBlob=$null
if((Test-Path -LiteralPath $harness -PathType Leaf) -and (Test-Path -LiteralPath $git -PathType Leaf)){$harnessBlob=(& $git hash-object -- $harness 2>$null).Trim()}
$items=@();$keyCount=0;$certCount=0
if(Test-Path -LiteralPath $fixture -PathType Container){
 foreach($i in @(Get-ChildItem -LiteralPath $fixture -Force -ErrorAction SilentlyContinue|Select-Object -First 100)){
  if(-not $i.PSIsContainer -and $i.Extension -eq '.key'){$keyCount++;continue}
  if(-not $i.PSIsContainer -and $i.Extension -in @('.crt','.cer','.pem')){$certCount++}
  $items += [ordered]@{name=$i.Name;is_directory=[bool]$i.PSIsContainer;length=if($i.PSIsContainer){$null}else{[int64]$i.Length};extension=if($i.PSIsContainer){$null}else{$i.Extension};creation_time_utc=$i.CreationTimeUtc.ToString('o');last_write_time_utc=$i.LastWriteTimeUtc.ToString('o')}
 }
}
$tempDirs=@()
foreach($base in @('C:\Windows\Temp',$env:TEMP)){
 if(!$base -or !(Test-Path -LiteralPath $base -PathType Container)){continue}
 foreach($d in @(Get-ChildItem -LiteralPath $base -Force -Directory -Filter 'ptysd-http-mtls-*' -ErrorAction SilentlyContinue|Select-Object -First 20)){
  $tempDirs += [ordered]@{path=$d.FullName;creation_time_utc=$d.CreationTimeUtc.ToString('o');last_write_time_utc=$d.LastWriteTimeUtc.ToString('o');child_count=@(Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue).Count;key_count=@(Get-ChildItem -LiteralPath $d.FullName -Force -File -Filter *.key -ErrorAction SilentlyContinue).Count}
 }
}
$procs=@()
try{foreach($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.Name -in @('node.exe','openssl.exe')})){$cmd=[string]$p.CommandLine;if($cmd -match '(?i)(windows-mtls-staging|http-main|mtls-fixture-a42|p5-mtls)'){$procs += [ordered]@{name=$p.Name;pid=[int]$p.ProcessId;creation_date=if($p.CreationDate){([DateTime]$p.CreationDate).ToUniversalTime().ToString('o')}else{$null};command_line_match=$true}}}}catch{}
[ordered]@{schema='v49.p5.windows-mtls-staging-timeout-readback.v2';request_id=$requestId;readback_only=$true;receipt=$receiptSafe;harness_present=[bool](Test-Path -LiteralPath $harness -PathType Leaf);harness_git_blob=$harnessBlob;fixture_present=[bool](Test-Path -LiteralPath $fixture -PathType Container);fixture_item_count=[int]$items.Count;private_key_present=[bool]($keyCount -gt 0);private_key_count=[int]$keyCount;certificate_like_count=[int]$certCount;fixture_items=$items;temp_dirs=$tempDirs;matching_processes=$procs;no_private_key_name_or_content_output=$true;no_file_content_output=$true;no_process_kill=$true;no_file_delete=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 7 -Compress
