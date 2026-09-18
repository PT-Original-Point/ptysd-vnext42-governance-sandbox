[CmdletBinding()]
param([string]$Root='C:\ProgramData\PTYSD\MCP')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$runtimeExe=Join-Path $Root 'tunnel\v0.0.14\tunnel-client.exe'
$doctorExe=Join-Path $Root 'tunnel\full\v0.0.14\tunnel-client.exe'
$profile=Join-Path $Root 'config\factory-mcp-tunnel.yaml'
$key=Join-Path $Root 'secrets\control-plane-api-key.txt'
$expectedRuntimeSha='09eac072d392b8d27b7aea8cbc146ab3738934961278b6b69cb23513607a08d7'
$expectedDoctorSha='fcc85a69ec0ad82518e4f8964f60c45e31787957782a0fc9c1b0c44e82d61b9b'
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
if(-not $networkRead){throw 'CONTROL_PLANE_KEY_NETWORK_SERVICE_READ_MISSING'}
if(-not (Test-Path -LiteralPath $runtimeExe)){throw 'TUNNEL_RUNTIME_CLIENT_MISSING'}
if(-not (Test-Path -LiteralPath $doctorExe)){throw 'TUNNEL_DOCTOR_CLIENT_MISSING'}
$runtimeSha=(Get-FileHash -LiteralPath $runtimeExe -Algorithm SHA256).Hash.ToLowerInvariant()
$doctorSha=(Get-FileHash -LiteralPath $doctorExe -Algorithm SHA256).Hash.ToLowerInvariant()
if($runtimeSha -ne $expectedRuntimeSha){throw 'TUNNEL_RUNTIME_CLIENT_SHA256_MISMATCH'}
if($doctorSha -ne $expectedDoctorSha){throw 'TUNNEL_DOCTOR_CLIENT_SHA256_MISMATCH'}
& $doctorExe doctor --profile-file $profile --explain *> $null
if($LASTEXITCODE -ne 0){throw 'TUNNEL_DOCTOR_FAILED'}
[ordered]@{result='PASS';tunnel_id=$idMatches[0].Groups[1].Value;health='LOOPBACK_EPHEMERAL';runtime_exe_sha256=$runtimeSha;doctor_exe_sha256=$doctorSha;key_present=$true;doctor='PASS'} | ConvertTo-Json -Compress