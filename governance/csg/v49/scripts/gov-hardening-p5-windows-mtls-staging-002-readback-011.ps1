Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$requestId='95052d4a578c46aebf04156aa2d6af79'
$root='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$fixture=Join-Path $root 'mtls-fixture-a42'
$harness=Join-Path $root 'tools\csg\factory-mcp\tests\windows-mtls-staging.mjs'
$receipt=Join-Path 'C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts' ($requestId+'.json')
function Get-ReceiptMeta([string]$p){
  if(!(Test-Path -LiteralPath $p -PathType Leaf)){return [ordered]@{present=$false}}
  try{$j=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json -ErrorAction Stop}catch{return [ordered]@{present=$true;parse_ok=$false}}
  return [ordered]@{present=$true;parse_ok=$true;schema=$j.schema;request_id=$j.request_id;state=$j.state;project_id=$j.project_id;operation_id=$j.operation_id;run_id=$j.run_id;task_id=$j.task_id;attempt_id=$j.attempt_id;attempt_epoch=$j.attempt_epoch;timed_out=$j.timed_out;exit_code=$j.exit_code;side_effect_state=$j.side_effect_state;script_sha256=$j.script_sha256;started_at_utc=$j.started_at_utc;finished_at_utc=$j.finished_at_utc;stdout_bytes=$j.stdout_bytes;stderr_bytes=$j.stderr_bytes}
}
function Get-ItemMeta([string]$p){
  if(!(Test-Path -LiteralPath $p)){return [ordered]@{present=$false}}
  $i=Get-Item -LiteralPath $p -Force
  return [ordered]@{present=$true;is_directory=[bool]$i.PSIsContainer;length=if($i.PSIsContainer){$null}else{[int64]$i.Length};creation_time_utc=$i.CreationTimeUtc.ToString('o');last_write_time_utc=$i.LastWriteTimeUtc.ToString('o')}
}
$fixtureItems=@();$privateKeyCount=0;$certLikeCount=0
if(Test-Path -LiteralPath $fixture -PathType Container){
  foreach($i in @(Get-ChildItem -LiteralPath $fixture -Force -ErrorAction SilentlyContinue|Select-Object -First 100)){
    if(-not $i.PSIsContainer -and $i.Extension -eq '.key'){$privateKeyCount++;continue}
    if(-not $i.PSIsContainer -and $i.Extension -in @('.crt','.cer','.pem')){$certLikeCount++}
    $fixtureItems += [ordered]@{name=$i.Name;is_directory=[bool]$i.PSIsContainer;length=if($i.PSIsContainer){$null}else{[int64]$i.Length};extension=if($i.PSIsContainer){$null}else{[string]$i.Extension};creation_time_utc=$i.CreationTimeUtc.ToString('o');last_write_time_utc=$i.LastWriteTimeUtc.ToString('o')}
  }
}
$tempRoot='C:\Windows\Temp'
$tempMatches=@()
if(Test-Path -LiteralPath $tempRoot -PathType Container){
  $tempMatches=@(Get-ChildItem -LiteralPath $tempRoot -Force -ErrorAction SilentlyContinue|Where-Object{$_.Name -like 'ptysd-http-mtls-*' -or $_.Name -like 'p5-mtls-*'}|Select-Object -First 50|ForEach-Object{[ordered]@{name=$_.Name;is_directory=[bool]$_.PSIsContainer;creation_time_utc=$_.CreationTimeUtc.ToString('o');last_write_time_utc=$_.LastWriteTimeUtc.ToString('o')}})
}
$proc=@()
try{
 foreach($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.Name -in @('node.exe','openssl.exe')})){
   $cmd=[string]$p.CommandLine
   if($cmd -match '(?i)(windows-mtls-staging\.mjs|http-mtls-integration\.mjs|http-main\.mjs|mtls-fixture-a42|p5-mtls)'){
     $proc += [ordered]@{name=$p.Name;pid=[int]$p.ProcessId;creation_date=if($p.CreationDate){([DateTime]$p.CreationDate).ToUniversalTime().ToString('o')}else{$null};command_matches_harness=[bool]($cmd -match '(?i)windows-mtls-staging\.mjs');command_matches_http=[bool]($cmd -match '(?i)(http-mtls-integration\.mjs|http-main\.mjs)')}
   }
 }
}catch{}
$listeners=@();$pids=@($proc|Where-Object{$_.name -eq 'node.exe'}|ForEach-Object{$_.pid})
if($pids.Count){try{$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$pids -contains [int]$_.OwningProcess}|Select-Object -First 20|ForEach-Object{[ordered]@{address=$_.LocalAddress;port=[int]$_.LocalPort;pid=[int]$_.OwningProcess}})}catch{}}
[ordered]@{
 schema='v49.p5.windows-mtls-staging-timeout-readback.v2'
 readback_only=$true
 request_id=$requestId
 receipt=Get-ReceiptMeta $receipt
 stage_root=Get-ItemMeta $root
 fixture=Get-ItemMeta $fixture
 fixture_item_count=[int]$fixtureItems.Count
 fixture_private_key_count=[int]$privateKeyCount
 fixture_certificate_like_count=[int]$certLikeCount
 fixture_items=$fixtureItems
 harness=Get-ItemMeta $harness
 windows_temp_matches=$tempMatches
 matching_processes=$proc
 listeners=$listeners
 no_private_key_name_or_content_output=$true
 no_file_content_output=$true
 no_recursive_scan=$true
 no_file_delete=$true
 no_process_kill=$true
 observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 7 -Compress
