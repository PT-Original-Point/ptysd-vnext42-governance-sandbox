Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$fixture='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8\mtls-fixture-a30'
$origTemp='C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-temp\280c25cc2543451b9ef1487667b5d443.ps1'
$expected=@{'client-ext.cnf'=56;'server-ext.cnf'=115}
$prePresent=Test-Path -LiteralPath $fixture -PathType Container
if(-not $prePresent){throw 'P5_CLEANUP_FIXTURE_MISSING_PRESTATE'}
$children=@(Get-ChildItem -LiteralPath $fixture -Force -ErrorAction Stop)
if($children.Count -ne 2){throw ('P5_CLEANUP_UNEXPECTED_CHILD_COUNT:'+ $children.Count)}
foreach($i in $children){
  if($i.PSIsContainer){throw ('P5_CLEANUP_UNEXPECTED_DIRECTORY:'+ $i.Name)}
  if(-not $expected.ContainsKey($i.Name)){throw ('P5_CLEANUP_UNEXPECTED_FILE:'+ $i.Name)}
  if([int64]$i.Length -ne [int64]$expected[$i.Name]){throw ('P5_CLEANUP_LENGTH_MISMATCH:'+ $i.Name)}
  if($i.Extension -in @('.key','.crt','.cer','.pem','.json')){throw ('P5_CLEANUP_SENSITIVE_ARTIFACT_PRESENT:'+ $i.Extension)}
}
$origTempPresent=Test-Path -LiteralPath $origTemp -PathType Leaf
$origTempSha=$null
if($origTempPresent){$origTempSha=(Get-FileHash -LiteralPath $origTemp -Algorithm SHA256).Hash.ToLowerInvariant()}
Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction Stop
$postPresent=Test-Path -LiteralPath $fixture
[ordered]@{
  schema='v49.p5.windows-mtls-partial-fixture-cleanup.v1'
  exact_scope=$fixture
  pre_present=$prePresent
  pre_child_count=[int]$children.Count
  pre_files=@($children|Sort-Object Name|ForEach-Object{[ordered]@{name=$_.Name;length=[int64]$_.Length}})
  removed=[bool](-not $postPresent)
  post_present=[bool]$postPresent
  original_temp_script_present=[bool]$origTempPresent
  original_temp_script_sha256=$origTempSha
  expected_original_script_sha256='a5a88f7019ce434399f89fe14d2d971bc81693c185b5c78927f2e76d5c18f4da'
  original_temp_script_hash_matches=[bool]($origTempPresent -and $origTempSha -eq 'a5a88f7019ce434399f89fe14d2d971bc81693c185b5c78927f2e76d5c18f4da')
  no_private_key_content_output=$true
  p4_untouched=$true
  observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 5 -Compress
