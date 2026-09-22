Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$fixture='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8\mtls-fixture-a30'
$cut=[DateTime]::Parse('2026-09-22T00:43:18.7916502Z').ToUniversalTime()
$present=Test-Path -LiteralPath $fixture -PathType Container
$items=@()
$keyCount=0
$keyChanged=0
$certCount=0
$jsonCount=0
if($present){
  foreach($i in @(Get-ChildItem -LiteralPath $fixture -Force -ErrorAction SilentlyContinue | Select-Object -First 100)){
    $changed=[bool]($i.LastWriteTimeUtc -ge $cut -or $i.CreationTimeUtc -ge $cut)
    if(-not $i.PSIsContainer -and $i.Extension -eq '.key'){
      $keyCount++
      if($changed){$keyChanged++}
      continue
    }
    if(-not $i.PSIsContainer -and $i.Extension -in @('.crt','.cer','.pem')){$certCount++}
    if(-not $i.PSIsContainer -and $i.Extension -eq '.json'){$jsonCount++}
    $items += [ordered]@{
      name=$i.Name
      is_directory=[bool]$i.PSIsContainer
      length=if($i.PSIsContainer){$null}else{[int64]$i.Length}
      extension=if($i.PSIsContainer){$null}else{[string]$i.Extension}
      creation_time_utc=$i.CreationTimeUtc.ToString('o')
      last_write_time_utc=$i.LastWriteTimeUtc.ToString('o')
      changed_since_original_start=$changed
    }
  }
}
[ordered]@{
  schema='v49.p5.windows-mtls-fixture-metadata.v1'
  readback_only=$true
  fixture_present=[bool]$present
  cutoff_utc=$cut.ToString('o')
  item_count=[int]$items.Count
  private_key_present=[bool]($keyCount -gt 0)
  private_key_count=[int]$keyCount
  private_key_changed_since_original_start=[bool]($keyChanged -gt 0)
  private_key_changed_count=[int]$keyChanged
  certificate_like_count=[int]$certCount
  json_count=[int]$jsonCount
  items=$items
  no_recursive_scan=$true
  max_depth_from_fixture=1
  no_private_key_name_or_content_output=$true
  no_file_content_output=$true
  no_raw_log_output=$true
  no_process_kill=$true
  no_file_delete=$true
  observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 5 -Compress
