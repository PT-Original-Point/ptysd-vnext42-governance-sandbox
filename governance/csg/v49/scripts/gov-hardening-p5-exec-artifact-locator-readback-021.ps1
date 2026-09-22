Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='C:\ProgramData\PTYSD\MCP'
$ids=@('24d877f9bd1c4b48b2e6c1b4ad992a1c','d62db2941ff44d1f9ced2f45309422db')
$artifacts=@()
foreach($id in $ids){
  foreach($f in @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -like ('*'+$id+'*')} | Select-Object -First 20)){
    $artifacts += [ordered]@{request_id=$id;path=$f.FullName.Substring($root.Length).TrimStart('\');length=$f.Length;last_write_utc=$f.LastWriteTimeUtc.ToString('o')}
  }
}
$sourceHits=@()
$candidates=@(Get-ChildItem -LiteralPath $root -Recurse -File -Include '*.ps1','*.mjs' -ErrorAction SilentlyContinue | Select-Object -First 400)
foreach($f in $candidates){
  try{
    $m=@(Select-String -LiteralPath $f.FullName -Pattern 'exec-receipts','stderr_bytes','RedirectStandardError','stderr_path','stdout_path' -SimpleMatch -ErrorAction Stop | Select-Object -First 8)
    foreach($x in $m){if($sourceHits.Count -lt 40){$sourceHits += [ordered]@{path=$f.FullName.Substring($root.Length).TrimStart('\');line=$x.LineNumber;text=([string]$x.Line).Trim()}}
  }catch{}
}
[ordered]@{schema='v49.p5.exec-artifact-locator.v1';readback_only=$true;artifacts=$artifacts;source_hits=$sourceHits;no_file_mutation=$true;no_secret_value_output=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
