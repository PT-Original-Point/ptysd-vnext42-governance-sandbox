[CmdletBinding()]
param([string]$Root='C:\ProgramData\PTYSD\MCP')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$exe=Join-Path $Root 'tunnel\v0.0.14\tunnel-client.exe'
$profile=Join-Path $Root 'config\factory-mcp-tunnel.yaml'
$key=Join-Path $Root 'secrets\control-plane-api-key.txt'
$expectedExeSha='09eac072d392b8d27b7aea8cbc146ab3738934961278b6b69cb23513607a08d7'
if(-not (Test-Path -LiteralPath $profile)){throw 'TUNNEL_PROFILE_MISSING'}
$raw=Get-Content -LiteralPath $profile -Raw
$idMatches=[regex]::Matches($raw,'(?m)^\s*tunnel_id:\s*(tunnel_[0-9a-f]{32})\s*$')
if($idMatches.Count -ne 1){throw 'TUNNEL_ID_INVALID'}
if($idMatches[0].Groups[1].Value -eq 'tunnel_00000000000000000000000000000000'){throw 'TUNNEL_ID_PLACEHOLDER'}
$keyMatches=[regex]::Matches($raw,'(?m)^\s*api_key:\s*file:(.+?)\s*$')
if($keyMatches.Count -ne 1){throw 'API_KEY_FILE_REFERENCE_REQUIRED'}
$profileKey=$keyMatches[0].Groups[1].Value.Trim('"','''')
if(-not [IO.Path]::GetFullPath($profileKey).Equals([IO.Path]::GetFullPath($key),[StringComparison]::OrdinalIgnoreCase)){throw 'API_KEY_PATH_MISMATCH'}
if(-not [regex]::IsMatch($raw,'(?m)^\s*listen_addr:\s*127\.0\.0\.1:0\s*$')){throw 'HEALTH_LISTENER_NOT_LOOPBACK_EPHEMERAL'}
if(-not (Test-Path -LiteralPath $key)){throw 'CONTROL_PLANE_KEY_MISSING'}
if((Get-Item -LiteralPath $key).Length -lt 16){throw 'CONTROL_PLANE_KEY_TOO_SHORT'}
$allowed=@('S-1-5-18','S-1-5-20','S-1-5-32-544'); $networkRead=$false
foreach($rule in (Get-Acl -LiteralPath $key).Access){
  if($rule.AccessControlType -ne 'Allow'){continue}
  $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if($sid -notin $allowed){throw ('CONTROL_PLANE_KEY_ACL_TOO_BROAD:'+ $sid)}
  if($sid -eq 'S-1-5-20' -and (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0)){$networkRead=$true}
}
if(-not $networkRead){throw 'CONTROL_PLANE_KEY_NETWORK_SERVICE_READ_MISSING'}if(-not (Test-Path -LiteralPath $exe)){throw 'TUNNEL_CLIENT_MISSING'}
$exeSha=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if($exeSha -ne $expectedExeSha){throw 'TUNNEL_CLIENT_SHA256_MISMATCH'}
& $exe doctor --profile-file $profile --explain *> $null
if($LASTEXITCODE -ne 0){throw 'TUNNEL_DOCTOR_FAILED'}
[ordered]@{result='PASS';tunnel_id=$idMatches[0].Groups[1].Value;health='LOOPBACK_EPHEMERAL';exe_sha256=$exeSha;key_present=$true;doctor='PASS'} | ConvertTo-Json -Compress
