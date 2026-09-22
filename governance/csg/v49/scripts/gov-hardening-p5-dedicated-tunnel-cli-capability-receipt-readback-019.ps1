Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$target='GOV-HARDENING-P5-DEDICATED-TUNNEL-CLI-CAPABILITY-READBACK-018'
$dir='C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts'
if(!(Test-Path -LiteralPath $dir -PathType Container)){throw 'EXEC_RECEIPT_DIR_MISSING'}
function P($o,[string]$n){if($null-eq $o){return $null};if($o.PSObject.Properties.Name -contains $n){return $o.$n};return $null}
$matches=@()
$recent=@()
foreach($f in @(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 20)){
  $r=$null
  try{$r=Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json -ErrorAction Stop}catch{continue}
  $op=[string](P $r 'operation_id')
  if($recent.Count -lt 6){$recent += [ordered]@{request_id=$f.BaseName;operation_id=$op;state=P $r 'state';exit_code=P $r 'exit_code';timed_out=P $r 'timed_out';finished_at_utc=P $r 'finished_at_utc'}}
  if($op -ne $target){continue}
  $stdout=[string](P $r 'stdout')
  $safe=$null
  if(-not [string]::IsNullOrWhiteSpace($stdout)){try{$safe=$stdout.Trim() | ConvertFrom-Json -ErrorAction Stop}catch{$safe=[ordered]@{json_parse=$false;stdout_sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}}
  $matches += [ordered]@{request_id=$f.BaseName;state=P $r 'state';operation_id=$op;attempt_id=P $r 'attempt_id';attempt_epoch=P $r 'attempt_epoch';exit_code=P $r 'exit_code';timed_out=P $r 'timed_out';side_effect_state=P $r 'side_effect_state';script_sha256=P $r 'script_sha256';stdout_bytes=P $r 'stdout_bytes';stderr_bytes=P $r 'stderr_bytes';started_at_utc=P $r 'started_at_utc';finished_at_utc=P $r 'finished_at_utc';safe_stdout=$safe}
}
[ordered]@{schema='v49.p5.tunnel-cli-capability-receipt-reconcile.v1';readback_only=$true;target_operation_id=$target;match_count=$matches.Count;matches=$matches;recent_receipts=$recent;no_secret_value_output=$true;no_file_mutation=$true;no_process_start=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 10 -Compress
