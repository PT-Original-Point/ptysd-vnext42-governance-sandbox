[CmdletBinding()]
param(
  [string]$Root='C:\ProgramData\PTYSD\MCP',
  [Parameter(Mandatory=$true)][string]$TunnelId,
  [Security.SecureString]$RuntimeApiKey
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($TunnelId -notmatch '^tunnel_[0-9a-f]{32}$'){throw 'TUNNEL_ID_INVALID'}
$template=Join-Path $Root 'FactoryMCP\windows\factory-mcp-tunnel.template.yaml'
$qualify=Join-Path $Root 'FactoryMCP\windows\qualify-tunnel.ps1'
$profile=Join-Path $Root 'config\factory-mcp-tunnel.yaml'
$key=Join-Path $Root 'secrets\control-plane-api-key.txt'
$task='PTYSD-FactoryMCP-Tunnel-V47'
$defaultRoot=[IO.Path]::GetFullPath('C:\ProgramData\PTYSD\MCP')
if([IO.Path]::GetFullPath($Root).Equals($defaultRoot,[StringComparison]::OrdinalIgnoreCase)){
  $t=Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  if(-not $t){throw 'TUNNEL_TASK_MISSING'}
  if($t.State.ToString() -ne 'Disabled'){throw 'TUNNEL_TASK_NOT_DISABLED'}
}
if(Test-Path -LiteralPath $profile){throw 'TUNNEL_PROFILE_ALREADY_EXISTS'}
if(Test-Path -LiteralPath $key){throw 'CONTROL_PLANE_KEY_ALREADY_EXISTS'}
if(-not (Test-Path -LiteralPath $template)){throw 'TUNNEL_TEMPLATE_MISSING'}
if(-not (Test-Path -LiteralPath $qualify)){throw 'TUNNEL_QUALIFIER_MISSING'}
if(-not $RuntimeApiKey){$RuntimeApiKey=Read-Host 'Runtime API key' -AsSecureString}
if(-not $RuntimeApiKey){throw 'CONTROL_PLANE_KEY_REQUIRED'}
$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($RuntimeApiKey)
$plain=$null; $keyTmp=$null; $profileTmp=$null; $committed=$false
try {
  $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if([string]::IsNullOrWhiteSpace($plain) -or $plain.Length -lt 16){throw 'CONTROL_PLANE_KEY_TOO_SHORT'}
  New-Item -ItemType Directory -Force -Path (Split-Path $profile -Parent),(Split-Path $key -Parent) | Out-Null
  $enc=New-Object Text.UTF8Encoding($false)
  $tag=[guid]::NewGuid().ToString('N')
  $keyTmp=$key+'.'+$tag+'.tmp'; $profileTmp=$profile+'.'+$tag+'.tmp'
  [IO.File]::WriteAllText($keyTmp,$plain,$enc)
  & icacls.exe $keyTmp /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' 'NT AUTHORITY\NETWORK SERVICE:R' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'CONTROL_PLANE_KEY_ACL_SET_FAILED'}
  $raw=Get-Content -LiteralPath $template -Raw
  if(([regex]::Matches($raw,'tunnel_REPLACE_WITH_32_HEX')).Count -ne 1){throw 'TUNNEL_TEMPLATE_PLACEHOLDER_INVALID'}
  $rendered=$raw.Replace('tunnel_REPLACE_WITH_32_HEX',$TunnelId)
  if($rendered -match [regex]::Escape($plain)){throw 'SECRET_RENDERED_IN_PROFILE'}
  [IO.File]::WriteAllText($profileTmp,$rendered,$enc)
  & icacls.exe $profileTmp /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' 'NT AUTHORITY\NETWORK SERVICE:R' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'TUNNEL_PROFILE_ACL_SET_FAILED'}
  Move-Item -LiteralPath $keyTmp -Destination $key -Force; $keyTmp=$null
  Move-Item -LiteralPath $profileTmp -Destination $profile -Force; $profileTmp=$null
  $qualification=& $qualify -Root $Root
  if(-not $qualification){throw 'TUNNEL_PREFLIGHT_FAILED'}
  $parsed=$qualification | ConvertFrom-Json
  if($parsed.result -ne 'PASS' -or $parsed.doctor -ne 'PASS'){throw 'TUNNEL_PREFLIGHT_NOT_PASS'}
  if([IO.Path]::GetFullPath($Root).Equals($defaultRoot,[StringComparison]::OrdinalIgnoreCase)){
    $post=Get-ScheduledTask -TaskName $task
    if($post.State.ToString() -ne 'Disabled'){throw 'TUNNEL_TASK_STATE_CHANGED'}
  }
  $committed=$true
  [ordered]@{result='PASS';tunnel_id=$TunnelId;profile_present=$true;key_present=$true;doctor='PASS';tunnel_task='Disabled'} | ConvertTo-Json -Compress
} catch {
  if(-not $committed){
    Remove-Item -LiteralPath $profile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $key -Force -ErrorAction SilentlyContinue
  }
  throw
} finally {
  if($keyTmp){Remove-Item -LiteralPath $keyTmp -Force -ErrorAction SilentlyContinue}
  if($profileTmp){Remove-Item -LiteralPath $profileTmp -Force -ErrorAction SilentlyContinue}
  $plain=$null
  if($bstr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
}