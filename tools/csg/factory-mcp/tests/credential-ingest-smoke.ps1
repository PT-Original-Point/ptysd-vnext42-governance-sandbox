[CmdletBinding()]param()
Set-StrictMode -Version Latest; $ErrorActionPreference='Stop'
$import=Join-Path (Split-Path $PSScriptRoot -Parent) 'windows\import-tunnel-credentials.ps1'
$tid='tunnel_0123456789abcdef0123456789abcdef'; $dummy='test-runtime-key-material-0123456789'
function New-TestRoot([bool]$FailQualifier=$false){
  $r=Join-Path $env:TEMP ('ptysd-ingest-'+[guid]::NewGuid().ToString('N'))
  $w=Join-Path $r 'FactoryMCP\windows'; New-Item -ItemType Directory -Force -Path $w,(Join-Path $r 'config'),(Join-Path $r 'secrets') | Out-Null
  $key=Join-Path $r 'secrets\control-plane-api-key.txt'
  @" 
config_version: 1
control_plane:
  tunnel_id: tunnel_REPLACE_WITH_32_HEX
  api_key: file:$key
health:
  listen_addr: 127.0.0.1:0
"@.TrimStart() | Set-Content -LiteralPath (Join-Path $w 'factory-mcp-tunnel.template.yaml') -Encoding utf8
  if($FailQualifier){"param([string]`$Root); throw 'MOCK_QUALIFIER_FAIL'" | Set-Content -LiteralPath (Join-Path $w 'qualify-tunnel.ps1') -Encoding ascii}
  else {@'
param([string]$Root)
if(-not (Test-Path (Join-Path $Root 'config\factory-mcp-tunnel.yaml'))){throw 'MOCK_PROFILE_MISSING'}
if(-not (Test-Path (Join-Path $Root 'secrets\control-plane-api-key.txt'))){throw 'MOCK_KEY_MISSING'}
'{"result":"PASS","doctor":"PASS"}'
'@ | Set-Content -LiteralPath (Join-Path $w 'qualify-tunnel.ps1') -Encoding ascii}
  return $r
}
$r=New-TestRoot; try {
  $secure=ConvertTo-SecureString $dummy -AsPlainText -Force
  $out=& $import -Root $r -TunnelId $tid -RuntimeApiKey $secure | ConvertFrom-Json
  if($out.result -ne 'PASS' -or $out.doctor -ne 'PASS'){throw 'INGEST_PASS_RESULT_INVALID'}
  $kp=Join-Path $r 'secrets\control-plane-api-key.txt'; $pp=Join-Path $r 'config\factory-mcp-tunnel.yaml'
  if((Get-Content $kp -Raw) -ne $dummy){throw 'INGEST_KEY_MISMATCH'}
  $profile=Get-Content $pp -Raw; if($profile -match [regex]::Escape($dummy)){throw 'INGEST_SECRET_LEAKED_TO_PROFILE'}
  if($profile -notmatch [regex]::Escape($tid)){throw 'INGEST_TUNNEL_ID_MISSING'}
} finally {Remove-Item $r -Recurse -Force -ErrorAction SilentlyContinue}
$r=New-TestRoot; try {
  $short=ConvertTo-SecureString 'short' -AsPlainText -Force
  try{& $import -Root $r -TunnelId $tid -RuntimeApiKey $short | Out-Null; throw 'SHORT_KEY_ACCEPTED'}catch{if($_.Exception.Message -ne 'CONTROL_PLANE_KEY_TOO_SHORT'){throw}}
  if(Test-Path (Join-Path $r 'secrets\control-plane-api-key.txt')){throw 'SHORT_KEY_RESIDUE'}
} finally {Remove-Item $r -Recurse -Force -ErrorAction SilentlyContinue}
$r=New-TestRoot $true; try {
  $secure=ConvertTo-SecureString $dummy -AsPlainText -Force
  try{& $import -Root $r -TunnelId $tid -RuntimeApiKey $secure | Out-Null; throw 'QUALIFIER_FAILURE_ACCEPTED'}catch{if($_.Exception.Message -ne 'MOCK_QUALIFIER_FAIL'){throw}}
  if((Test-Path (Join-Path $r 'secrets\control-plane-api-key.txt')) -or (Test-Path (Join-Path $r 'config\factory-mcp-tunnel.yaml'))){throw 'QUALIFIER_FAILURE_NOT_ROLLED_BACK'}
} finally {Remove-Item $r -Recurse -Force -ErrorAction SilentlyContinue}
Write-Output 'CREDENTIAL_INGEST_SMOKE=PASS'