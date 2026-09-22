Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='C:\ProgramData\PTYSD\MCP\P5Staging'
$cut=[DateTime]::Parse('2026-09-22T00:43:18.7916502Z').ToUniversalTime()
function ItemMeta([IO.FileSystemInfo]$i,[string]$rel){
  [ordered]@{
    relative_path=$rel
    is_directory=[bool]$i.PSIsContainer
    length=if($i.PSIsContainer){$null}else{[int64]$i.Length}
    extension=if($i.PSIsContainer){$null}else{[string]$i.Extension}
    creation_time_utc=$i.CreationTimeUtc.ToString('o')
    last_write_time_utc=$i.LastWriteTimeUtc.ToString('o')
    changed_since_original_start=[bool]($i.LastWriteTimeUtc -ge $cut -or $i.CreationTimeUtc -ge $cut)
  }
}
$rootPresent=Test-Path -LiteralPath $root -PathType Container
$items=@()
$keyCount=0
$keyChanged=0
if($rootPresent){
  foreach($a in @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue | Select-Object -First 100)){
    $rel1=$a.Name
    if(-not $a.PSIsContainer -and $a.Extension -eq '.key'){
      $keyCount++
      if($a.LastWriteTimeUtc -ge $cut -or $a.CreationTimeUtc -ge $cut){$keyChanged++}
    } else {
      $items += ItemMeta $a $rel1
    }
    if($a.PSIsContainer){
      foreach($b in @(Get-ChildItem -LiteralPath $a.FullName -Force -ErrorAction SilentlyContinue | Select-Object -First 100)){
        $rel2=Join-Path $rel1 $b.Name
        if(-not $b.PSIsContainer -and $b.Extension -eq '.key'){
          $keyCount++
          if($b.LastWriteTimeUtc -ge $cut -or $b.CreationTimeUtc -ge $cut){$keyChanged++}
        } else {
          $items += ItemMeta $b $rel2
        }
      }
    }
  }
}
$changed=@($items | Where-Object {$_.changed_since_original_start})
[ordered]@{
  schema='v49.p5.windows-mtls-staging-two-level-metadata.v1'
  readback_only=$true
  root_present=[bool]$rootPresent
  cutoff_utc=$cut.ToString('o')
  item_count=[int]$items.Count
  changed_item_count=[int]$changed.Count
  private_key_present=[bool]($keyCount -gt 0)
  private_key_count=[int]$keyCount
  private_key_changed_since_original_start=[bool]($keyChanged -gt 0)
  private_key_changed_count=[int]$keyChanged
  items=$items
  no_recursive_scan=$true
  max_depth=2
  no_private_key_content_output=$true
  no_file_content_output=$true
  no_raw_log_output=$true
  no_process_kill=$true
  no_file_delete=$true
  observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 6 -Compress
