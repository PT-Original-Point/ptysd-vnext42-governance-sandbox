[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$HelperPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$WorkRoot,
  [string]$ExpectedRunAs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $HelperPath)) { throw 'HELPER_PATH_MISSING' }
. $HelperPath

New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
$requestId = [Guid]::NewGuid().ToString('N')
[byte[]]$scriptBytes = [Text.Encoding]::UTF8.GetBytes("Write-Output 'PTYSD_HOST_POWERSHELL_SYSTEM_SMOKE_OK'")
$result = Invoke-PTYSDHostPowerShellExec -ScriptBytes $scriptBytes -TimeoutSeconds 30 -ExecTemp $WorkRoot -RequestId $requestId

if ($result.timed_out -ne $false) { throw 'SELFTEST_TIMED_OUT' }
if ([int]$result.exit_code -ne 0) { throw ('SELFTEST_EXIT_NONZERO:' + [string]$result.exit_code) }
if ([string]$result.stdout -notmatch 'PTYSD_HOST_POWERSHELL_SYSTEM_SMOKE_OK') { throw 'SELFTEST_STDOUT_MISSING' }
if ($ExpectedRunAs -and [string]$result.run_as -ne $ExpectedRunAs) {
  throw ('SELFTEST_RUN_AS_MISMATCH expected=' + $ExpectedRunAs + ' actual=' + [string]$result.run_as)
}
if (-not [string]$result.script_sha256 -or [string]$result.script_sha256 -notmatch '^[0-9a-f]{64}$') {
  throw 'SELFTEST_SCRIPT_HASH_INVALID'
}

$evidence = [ordered]@{
  schema='v48.factory-mcp.host-exec.selftest.v1'
  result='PASS'
  run_as=[string]$result.run_as
  executable=[string]$result.executable
  exit_code=[int]$result.exit_code
  timed_out=[bool]$result.timed_out
  stdout_match=$true
  script_sha256=[string]$result.script_sha256
  recorded_at_utc=[DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText($OutputPath,($evidence|ConvertTo-Json -Depth 6 -Compress),(New-Object Text.UTF8Encoding($false)))
$evidence | ConvertTo-Json -Depth 6 -Compress
