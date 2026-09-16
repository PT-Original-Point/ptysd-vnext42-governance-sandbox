[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('status','prepare','start')]
  [string]$Operation,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$RunId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$TaskId,

  [ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')]
  [string]$AttemptId,

  [ValidateRange(0,2147483647)]
  [int]$AttemptEpoch = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$endpoint = 'PTYSD.FactoryMCP.V47'

$common = @{
  ComputerName      = 'localhost'
  ConfigurationName = $endpoint
  ErrorAction       = 'Stop'
}

switch ($Operation) {
  'status' {
    $result = Invoke-Command @common -ScriptBlock {
      Get-PTYSDHostGuardStatus
    }
  }
  'prepare' {
    if (-not $RunId -or -not $TaskId -or -not $AttemptId) { throw 'REQUIRED_ID_MISSING' }
    $result = Invoke-Command @common -ArgumentList @($RunId,$TaskId,$AttemptId,$AttemptEpoch) -ScriptBlock {
      param($r,$t,$a,$e)
      Invoke-PTYSDHostPrepare -RunId $r -TaskId $t -AttemptId $a -AttemptEpoch $e
    }
  }
  'start' {
    if (-not $RunId -or -not $TaskId -or -not $AttemptId) { throw 'REQUIRED_ID_MISSING' }
    $result = Invoke-Command @common -ArgumentList @($RunId,$TaskId,$AttemptId,$AttemptEpoch) -ScriptBlock {
      param($r,$t,$a,$e)
      Start-PTYSDWorkerVm -RunId $r -TaskId $t -AttemptId $a -AttemptEpoch $e
    }
  }
}

$result | ConvertTo-Json -Depth 8 -Compress
