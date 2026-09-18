Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PTYSDHostExecSha256Hex {
  param([Parameter(Mandatory)][byte[]]$Bytes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function ConvertTo-PTYSDHostExecBoundedUtf8 {
  param(
    [AllowEmptyString()][string]$Text,
    [Parameter(Mandatory)][ValidateRange(1,1048576)][int]$Limit
  )
  if ($null -eq $Text) { $Text = '' }
  [byte[]]$all = [Text.Encoding]::UTF8.GetBytes($Text)
  $count = $all.Length
  $take = [Math]::Min($count,$Limit)
  if ($take -gt 0) {
    [byte[]]$view = New-Object byte[] $take
    [Array]::Copy($all,0,$view,0,$take)
  } else {
    [byte[]]$view = @()
  }
  [ordered]@{
    text = [Text.Encoding]::UTF8.GetString($view)
    bytes = $count
    truncated = ($count -gt $Limit)
    sha256 = Get-PTYSDHostExecSha256Hex -Bytes $all
  }
}

function Invoke-PTYSDHostPowerShellExec {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][byte[]]$ScriptBytes,
    [Parameter(Mandatory)][ValidateRange(1,300)][int]$TimeoutSeconds,
    [Parameter(Mandatory)][string]$ExecTemp,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{32}$')][string]$RequestId,
    [ValidateRange(1024,1048576)][int]$MaxOutputBytes = 131072
  )

  if ($ScriptBytes.Length -lt 1 -or $ScriptBytes.Length -gt 32768) {
    throw 'POWERSHELL_SCRIPT_SIZE_INVALID'
  }

  $decoded = [Text.Encoding]::UTF8.GetString($ScriptBytes)
  if ([Text.Encoding]::UTF8.GetByteCount($decoded) -ne $ScriptBytes.Length) {
    throw 'POWERSHELL_SCRIPT_UTF8_INVALID'
  }

  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $powerShellExe)) {
    throw 'POWERSHELL_EXECUTABLE_MISSING'
  }

  if (-not (Test-Path -LiteralPath $ExecTemp)) {
    New-Item -ItemType Directory -Path $ExecTemp -Force | Out-Null
  }

  $scriptPath = Join-Path $ExecTemp ($RequestId + '.ps1')
  $startedAt = [DateTime]::UtcNow
  $timedOut = $false
  $exitCode = -1
  $process = $null
  $stdoutTask = $null
  $stderrTask = $null
  $stdoutText = ''
  $stderrText = ''

  try {
    [IO.File]::WriteAllBytes($scriptPath,$ScriptBytes)

    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $powerShellExe
    $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $ExecTemp

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $psi

    try {
      if (-not $process.Start()) { throw 'START_RETURNED_FALSE' }
    } catch {
      throw 'POWERSHELL_EXEC_LAUNCH_FAILED'
    }

    try {
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      $exited = $process.WaitForExit($TimeoutSeconds * 1000)
    } catch {
      throw 'POWERSHELL_EXEC_WAIT_FAILED'
    }

    if (-not $exited) {
      $timedOut = $true
      try {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      } catch {
        try { $process.Kill() } catch {}
      }
      try { [void]$process.WaitForExit(5000) } catch {}
    }

    if (-not $timedOut) {
      try {
        $exitCode = [int]$process.ExitCode
      } catch {
        throw 'POWERSHELL_EXEC_EXITCODE_FAILED'
      }
    }

    try {
      if ($stdoutTask) { $stdoutText = [string]$stdoutTask.GetAwaiter().GetResult() }
      if ($stderrTask) { $stderrText = [string]$stderrTask.GetAwaiter().GetResult() }
    } catch {
      throw 'POWERSHELL_EXEC_CAPTURE_FAILED'
    }

    $stdout = ConvertTo-PTYSDHostExecBoundedUtf8 -Text $stdoutText -Limit $MaxOutputBytes
    $stderr = ConvertTo-PTYSDHostExecBoundedUtf8 -Text $stderrText -Limit $MaxOutputBytes
    $finishedAt = [DateTime]::UtcNow

    return [ordered]@{
      schema='v48.factory-mcp.host-exec.raw-result.v2'
      run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name
      executable=$powerShellExe
      script_sha256=Get-PTYSDHostExecSha256Hex -Bytes $ScriptBytes
      timeout_seconds=$TimeoutSeconds
      exit_code=$exitCode
      timed_out=$timedOut
      stdout=$stdout.text
      stderr=$stderr.text
      stdout_bytes=$stdout.bytes
      stderr_bytes=$stderr.bytes
      stdout_sha256=$stdout.sha256
      stderr_sha256=$stderr.sha256
      stdout_truncated=$stdout.truncated
      stderr_truncated=$stderr.truncated
      started_at_utc=$startedAt.ToString('o')
      finished_at_utc=$finishedAt.ToString('o')
    }
  } finally {
    if ($process) { try { $process.Dispose() } catch {} }
    Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
  }
}

