[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\PTYSD\MCP'
$exe = Join-Path $root 'tunnel\v0.0.14\tunnel-client.exe'
$profile = Join-Path $root 'config\factory-mcp-tunnel.yaml'
if (-not (Test-Path -LiteralPath $exe)) { throw 'TUNNEL_CLIENT_MISSING' }
if (-not (Test-Path -LiteralPath $profile)) { throw 'TUNNEL_PROFILE_MISSING' }
& $exe run --profile-file $profile
exit $LASTEXITCODE
