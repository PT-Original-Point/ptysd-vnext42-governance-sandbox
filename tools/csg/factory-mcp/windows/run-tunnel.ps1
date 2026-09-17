[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\PTYSD\MCP'
$exe = Join-Path $root 'tunnel\v0.0.14\tunnel-client.exe'
$profile = Join-Path $root 'config\factory-mcp-tunnel.yaml'
$preflight = Join-Path $root 'FactoryMCP\windows\qualify-tunnel.ps1'
if (-not (Test-Path -LiteralPath $preflight)) { throw 'TUNNEL_PREFLIGHT_MISSING' }
$qualification = & $preflight -Root $root
if (-not $qualification) { throw 'TUNNEL_PREFLIGHT_FAILED' }
$parsed = $qualification | ConvertFrom-Json
if ($parsed.result -ne 'PASS' -or $parsed.doctor -ne 'PASS') { throw 'TUNNEL_PREFLIGHT_NOT_PASS' }
& $exe run --profile-file $profile
exit $LASTEXITCODE
