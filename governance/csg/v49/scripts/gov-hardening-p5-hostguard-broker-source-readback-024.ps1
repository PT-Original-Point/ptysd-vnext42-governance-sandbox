Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$base='C:\ProgramData\PTYSD\MCP\FactoryMCP'
$path=Join-Path $base 'broker\hostguard-broker.ps1'
if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'BROKER_SOURCE_MISSING'}
$hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
$lines=@(Get-Content -LiteralPath $path)
$start=620
$end=[Math]::Min(730,$lines.Count)
$selected=@()
for($i=$start;$i -le $end;$i++){ $selected += [ordered]@{line=$i;text=[string]$lines[$i-1]} }
[ordered]@{schema='v49.p5.hostguard-broker-source-readback.v1';readback_only=$true;source_path='broker\hostguard-broker.ps1';source_sha256=$hash;total_lines=$lines.Count;selected_start=$start;selected_end=$end;lines=$selected;no_secret_file_read=$true;no_file_mutation=$true;no_process_start=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
