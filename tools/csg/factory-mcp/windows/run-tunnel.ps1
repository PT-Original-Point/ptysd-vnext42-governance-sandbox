[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = 'C:\ProgramData\PTYSD\MCP'
$exe = Join-Path $root 'tunnel\v0.0.14\tunnel-client.exe'
$profile = Join-Path $root 'config\factory-mcp-tunnel.yaml'
$preflight = Join-Path $root 'FactoryMCP\windows\qualify-tunnel.ps1'
$healthUrlFile = Join-Path $root 'state\tunnel-health-url.txt'
$pidFile = Join-Path $root 'state\tunnel-client.pid'
$supervisorState = Join-Path $root 'state\tunnel-supervisor.json'

function Write-SupervisorState {
  param(
    [Parameter(Mandatory)][string]$State,
    [int]$Attempt = 0,
    [Nullable[int]]$ExitCode = $null,
    [string]$ErrorCode = $null,
    [int]$DelaySeconds = 0
  )
  $payload = [ordered]@{
    schema = 'v49.factory-mcp.tunnel-supervisor.v1'
    state = $State
    attempt = $Attempt
    exit_code = $ExitCode
    error_code = $ErrorCode
    delay_seconds = $DelaySeconds
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
  }
  $tmp = $supervisorState + '.tmp.' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp, ($payload | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $supervisorState -Force
}

if (-not (Test-Path -LiteralPath $preflight)) { throw 'TUNNEL_PREFLIGHT_MISSING' }
if (-not (Test-Path -LiteralPath $exe)) { throw 'TUNNEL_RUNTIME_CLIENT_MISSING' }

$attempt = 0
while ($true) {
  $runStarted = $null
  $exitCode = $null
  $errorCode = $null
  try {
    $qualification = & $preflight -Root $root
    if (-not $qualification) { throw 'TUNNEL_PREFLIGHT_FAILED' }
    $parsed = $qualification | ConvertFrom-Json -ErrorAction Stop
    if ($parsed.result -ne 'PASS' -or $parsed.doctor -ne 'PASS') { throw 'TUNNEL_PREFLIGHT_NOT_PASS' }

    Remove-Item -LiteralPath $healthUrlFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue

    Write-SupervisorState -State 'STARTING' -Attempt $attempt
    $runStarted = [DateTime]::UtcNow
    & $exe run --profile-file $profile
    $exitCode = [int]$LASTEXITCODE
    $runtimeSeconds = ([DateTime]::UtcNow - $runStarted).TotalSeconds
    if ($runtimeSeconds -ge 60) { $attempt = 0 }
    $errorCode = if ($exitCode -eq 0) { 'TUNNEL_CLIENT_EXITED' } else { 'TUNNEL_CLIENT_NONZERO_EXIT' }
  } catch {
    $safe = [string]$_.Exception.Message
    if ($safe.Length -gt 160) { $safe = $safe.Substring(0,160) }
    $errorCode = if ($safe) { $safe } else { 'TUNNEL_SUPERVISOR_ERROR' }
  }

  $attempt++
  $baseDelay = [Math]::Min(60, [int][Math]::Pow(2, [Math]::Min($attempt + 1, 5)))
  $jitter = Get-Random -Minimum 0 -Maximum 4
  $delaySeconds = [int][Math]::Min(60, $baseDelay + $jitter)
  Write-SupervisorState -State 'BACKOFF' -Attempt $attempt -ExitCode $exitCode -ErrorCode $errorCode -DelaySeconds $delaySeconds
  Start-Sleep -Seconds $delaySeconds
}
