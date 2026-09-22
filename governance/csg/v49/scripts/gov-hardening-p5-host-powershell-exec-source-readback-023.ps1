Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$path='C:\ProgramData\PTYSD\MCP\FactoryMCP\broker\host-powershell-exec.ps1'
if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'HOST_POWERSHELL_EXEC_SOURCE_MISSING'}
$all=@(Get-Content -LiteralPath $path)
$start=55
$end=[Math]::Min(170,$all.Count)
$selected=@()
for($i=$start;$i -le $end;$i++){
  $selected += [ordered]@{line=$i;text=[string]$all[$i-1]}
}
[ordered]@{
 schema='v49.p5.host-powershell-exec-source-readback.v1'
 readback_only=$true
 source_path='broker\host-powershell-exec.ps1'
 source_sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
 total_lines=$all.Count
 selected_start=$start
 selected_end=$end
 lines=$selected
 no_secret_file_read=$true
 no_file_mutation=$true
 no_process_start=$true
 observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 6 -Compress
