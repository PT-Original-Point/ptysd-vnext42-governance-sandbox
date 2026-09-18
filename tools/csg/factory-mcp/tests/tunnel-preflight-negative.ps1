[CmdletBinding()]param()
Set-StrictMode -Version Latest; $ErrorActionPreference='Stop'
$script=Join-Path (Split-Path $PSScriptRoot -Parent) 'windows\qualify-tunnel.ps1'
function Expect-Fail([string]$Name,[string]$Expected,[scriptblock]$Arrange){
  $root=Join-Path $env:TEMP ('ptysd-preflight-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'config'),(Join-Path $root 'secrets') | Out-Null
  try { & $Arrange $root; try { & $script -Root $root | Out-Null; throw ('EXPECTED_FAILURE_NOT_RAISED:'+ $Name) } catch { if($_.Exception.Message -ne $Expected){throw ('WRONG_FAILURE:'+ $Name+':'+$_.Exception.Message)} } }
  finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
Expect-Fail 'missing-profile' 'TUNNEL_PROFILE_MISSING' { param($r) }
Expect-Fail 'placeholder-id' 'TUNNEL_ID_INVALID' { param($r) @'
config_version: 1
control_plane:
  tunnel_id: tunnel_REPLACE_WITH_32_HEX
'@ | Set-Content -LiteralPath (Join-Path $r 'config\factory-mcp-tunnel.yaml') -Encoding utf8 }
Expect-Fail 'wrong-key-path' 'API_KEY_PATH_MISMATCH' { param($r) @'
control_plane:
  tunnel_id: tunnel_0123456789abcdef0123456789abcdef
  api_key: file:C:\wrong\key.txt
health:
  listen_addr: 127.0.0.1:0
'@ | Set-Content -LiteralPath (Join-Path $r 'config\factory-mcp-tunnel.yaml') -Encoding utf8 }
Expect-Fail 'public-health' 'HEALTH_LISTENER_NOT_LOOPBACK_EPHEMERAL' { param($r) $k=Join-Path $r 'secrets\control-plane-api-key.txt'; @"
control_plane:
  tunnel_id: tunnel_0123456789abcdef0123456789abcdef
  api_key: file:$k
health:
  listen_addr: 0.0.0.0:8080
"@ | Set-Content -LiteralPath (Join-Path $r 'config\factory-mcp-tunnel.yaml') -Encoding utf8 }
Expect-Fail 'missing-key' 'CONTROL_PLANE_KEY_MISSING' { param($r) $k=Join-Path $r 'secrets\control-plane-api-key.txt'; @"
control_plane:
  tunnel_id: tunnel_0123456789abcdef0123456789abcdef
  api_key: file:$k
health:
  listen_addr: 127.0.0.1:0
"@ | Set-Content -LiteralPath (Join-Path $r 'config\factory-mcp-tunnel.yaml') -Encoding utf8 }
Write-Output 'TUNNEL_PREFLIGHT_NEGATIVE=PASS'
Expect-Fail 'short-key' 'CONTROL_PLANE_KEY_TOO_SHORT' { param($r) $k=Join-Path $r 'secrets\control-plane-api-key.txt'; 'short' | Set-Content -LiteralPath $k -Encoding ascii; @"
control_plane:
  tunnel_id: tunnel_0123456789abcdef0123456789abcdef
  api_key: file:$k
health:
  listen_addr: 127.0.0.1:0
"@ | Set-Content -LiteralPath (Join-Path $r 'config\factory-mcp-tunnel.yaml') -Encoding utf8 }
Write-Output 'TUNNEL_PREFLIGHT_SHORT_KEY=PASS'
