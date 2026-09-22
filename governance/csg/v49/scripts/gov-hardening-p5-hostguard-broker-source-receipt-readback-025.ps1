Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$target='GOV-HARDENING-P5-HOSTGUARD-BROKER-SOURCE-READBACK-024'
$dir='C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts'
if(!(Test-Path -LiteralPath $dir -PathType Container)){throw 'EXEC_RECEIPT_DIR_MISSING'}
$matches=@()
foreach($f in @(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 50)){
  $r=$null
  try{$r=Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json -ErrorAction Stop}catch{continue}
  if([string]$r.operation_id -ne $target){continue}
  $safe=$null
  if($r.PSObject.Properties.Name -contains 'stdout' -and -not [string]::IsNullOrWhiteSpace([string]$r.stdout)){
    try{$safe=([string]$r.stdout).Trim() | ConvertFrom-Json -ErrorAction Stop}catch{$safe=$null}
  }
  $matches += [ordered]@{request_id=$f.BaseName;state=$r.state;operation_id=$r.operation_id;attempt_id=$r.attempt_id;attempt_epoch=$r.attempt_epoch;exit_code=$r.exit_code;timed_out=$r.timed_out;side_effect_state=$r.side_effect_state;script_sha256=$r.script_sha256;stdout_bytes=$r.stdout_bytes;stderr_bytes=$r.stderr_bytes;started_at_utc=$r.started_at_utc;finished_at_utc=$r.finished_at_utc;safe_stdout=$safe}
}
[ordered]@{schema='v49.p5.hostguard-broker-source-receipt-reconcile.v1';readback_only=$true;target_operation_id=$target;match_count=$matches.Count;matches=$matches;no_secret_value_output=$true;no_file_mutation=$true;no_process_start=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 12 -Compress
