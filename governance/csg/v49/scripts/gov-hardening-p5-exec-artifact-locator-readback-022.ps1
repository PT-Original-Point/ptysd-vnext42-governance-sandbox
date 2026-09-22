Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$base='C:\ProgramData\PTYSD\MCP\FactoryMCP'
$state=Join-Path $base 'state'
$ids=@('24d877f9bd1c4b48b2e6c1b4ad992a1c','d62db2941ff44d1f9ced2f45309422db')
$artifacts=@()
$stateFiles=@(Get-ChildItem -LiteralPath $state -Recurse -File -ErrorAction SilentlyContinue)
foreach($id in $ids){
  $found=@($stateFiles | Where-Object {$_.Name -like ('*'+$id+'*')} | Select-Object -First 20)
  foreach($f in $found){
    $artifacts += [ordered]@{request_id=$id;path=$f.FullName.Substring($base.Length).TrimStart('\');length=$f.Length;last_write_utc=$f.LastWriteTimeUtc.ToString('o')}
  }
}
$sourceHits=@()
$sourceFiles=@(Get-ChildItem -LiteralPath $base -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Extension -in @('.ps1','.mjs')} | Select-Object -First 400)
foreach($f in $sourceFiles){
  $matches=@(Select-String -LiteralPath $f.FullName -Pattern 'exec-receipts','stderr_bytes','RedirectStandardError','stderr_path','stdout_path' -SimpleMatch -ErrorAction SilentlyContinue | Select-Object -First 8)
  foreach($x in $matches){
    if($sourceHits.Count -ge 40){break}
    $sourceHits += [ordered]@{path=$f.FullName.Substring($base.Length).TrimStart('\');line=$x.LineNumber;text=([string]$x.Line).Trim()}
  }
  if($sourceHits.Count -ge 40){break}
}
[ordered]@{schema='v49.p5.exec-artifact-locator.v2';readback_only=$true;artifacts=$artifacts;source_hits=$sourceHits;no_file_mutation=$true;no_secret_value_output=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
