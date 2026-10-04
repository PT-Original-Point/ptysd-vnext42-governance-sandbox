Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PTYSDHostExecSha256Hex {
  param([Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Bytes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function New-PTYSDHostExecStreamState {
  param([Parameter(Mandatory)]$Reader,[Parameter(Mandatory)][int]$Limit)
  $buffer = New-Object byte[] 16384
  return @{
    reader=$Reader
    total=0
    prefix=(New-Object IO.MemoryStream)
    sha=[Security.Cryptography.SHA256]::Create()
    done=$false
    faulted=$false
    buffer=$buffer
    task=$Reader.BaseStream.ReadAsync($buffer,0,$buffer.Length)
  }
}

function Step-PTYSDHostExecStreamState {
  param([Parameter(Mandatory)]$State,[int]$Limit)
  if ($State.done -or $null -eq $State.task) { return $false }
  if (-not $State.task.IsCompleted) { return $false }
  try {
    $n = $State.task.GetAwaiter().GetResult()
  } catch {
    $State.faulted = $true
    $State.done = $true
    return $true
  }
  if ($n -le 0) {
    $State.done = $true
  } else {
    $State.total += $n
    [void]$State.sha.TransformBlock($State.buffer,0,$n,$null,0)
    if ($State.prefix.Length -lt $Limit) {
      $keep = [Math]::Min($n,$Limit - $State.prefix.Length)
      $State.prefix.Write($State.buffer,0,$keep)
    }
    $State.task = $State.reader.BaseStream.ReadAsync($State.buffer,0,$State.buffer.Length)
  }
  return $true
}

function Complete-PTYSDHostExecStreamState {
  param([Parameter(Mandatory)]$State)
  try { [void]$State.sha.TransformFinalBlock([byte[]]@(),0,0) } catch {}
  $hash = [BitConverter]::ToString($State.sha.Hash).Replace('-','').ToLowerInvariant()
  $State.sha.Dispose()
  return [ordered]@{
    total=$State.total
    prefix=$State.prefix.ToArray()
    sha256=$hash
    stream_complete=([bool]$State.done -and -not $State.faulted)
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

    # Start bounded streaming capture immediately: drains must run concurrently
    # with the process wait or a full stdout/stderr pipe can deadlock the child.
    $stdoutState = New-PTYSDHostExecStreamState -Reader $process.StandardOutput -Limit $MaxOutputBytes
    $stderrState = New-PTYSDHostExecStreamState -Reader $process.StandardError -Limit $MaxOutputBytes
    $execDeadlineUtc = [DateTime]::UtcNow.AddMilliseconds($TimeoutSeconds * 1000)
    while ($true) {
      [void](Step-PTYSDHostExecStreamState -State $stdoutState -Limit $MaxOutputBytes)
      [void](Step-PTYSDHostExecStreamState -State $stderrState -Limit $MaxOutputBytes)
      try { $exitConfirmed = $process.WaitForExit(20) } catch { throw 'POWERSHELL_EXEC_WAIT_FAILED' }
      if ($exitConfirmed) { break }
      if ([DateTime]::UtcNow -ge $execDeadlineUtc) {
        $timedOut = $true
        try {
          & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
        } catch {
          try { $process.Kill() } catch {}
        }
        try { [void]$process.WaitForExit(5000) } catch {}
        break
      }
    }

    # Confirmed-exit path still must drain remaining buffered bytes; descendants
    # retaining inherited pipes are bounded by an explicit capture deadline that
    # is checked on EVERY iteration, including while data keeps flowing.
    $drainMs = if ($timedOut) { 5000 } else { 10000 }
    $captureDeadlineUtc = [DateTime]::UtcNow.AddMilliseconds($drainMs)
    $captureTruncated = $false
    while (-not ($stdoutState.done -and $stderrState.done)) {
      [void](Step-PTYSDHostExecStreamState -State $stdoutState -Limit $MaxOutputBytes)
      [void](Step-PTYSDHostExecStreamState -State $stderrState -Limit $MaxOutputBytes)
      if ([DateTime]::UtcNow -ge $captureDeadlineUtc) { $captureTruncated = $true; break }
      Start-Sleep -Milliseconds 20
    }

    if ($exitConfirmed -and -not $timedOut) {
      try {
        $exitCode = [int]$process.ExitCode
      } catch {
        throw 'POWERSHELL_EXEC_EXITCODE_FAILED'
      }
    }

    $stdout = Complete-PTYSDHostExecStreamState -State $stdoutState
    $stderr = Complete-PTYSDHostExecStreamState -State $stderrState
    $streamComplete = ([bool]$stdoutState.done -and -not $stdoutState.faulted -and
      [bool]$stderrState.done -and -not $stderrState.faulted)
    $captureOutcome = if ($captureTruncated) { 'CAPTURE_DEADLINE_EXCEEDED' } elseif ($streamComplete) { 'COMPLETED' } else { 'INCOMPLETE' }
    if ($captureTruncated) {
      $cleanupEffect = 'UNCONFIRMED_DESCENDANT_RETAINED_PIPES'
      try {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F *> $null
      } catch {}
    } elseif ($timedOut) {
      $cleanupEffect = 'TREE_CLEANUP_REQUESTED'
    } else {
      $cleanupEffect = 'NONE_REQUIRED'
    }
    if (-not $streamComplete) {
      # The reported byte counts/hashes describe only captured bytes and are
      # explicitly marked as not a complete full-stream digest.
      $captureOutcome = if ($captureTruncated) { 'CAPTURE_DEADLINE_EXCEEDED' } else { 'INCOMPLETE' }
    }
    $finishedAt = [DateTime]::UtcNow

    return [ordered]@{
      schema='v48.factory-mcp.host-exec.raw-result.v2'
      run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name
      executable=$powerShellExe
      script_sha256=Get-PTYSDHostExecSha256Hex -Bytes $ScriptBytes
      timeout_seconds=$TimeoutSeconds
      exit_code=$exitCode
      timed_out=$timedOut
      stdout=[Text.Encoding]::UTF8.GetString($stdout.prefix)
      stderr=[Text.Encoding]::UTF8.GetString($stderr.prefix)
      stdout_bytes=$stdout.total
      stderr_bytes=$stderr.total
      stdout_sha256=$stdout.sha256
      stderr_sha256=$stderr.sha256
      stdout_truncated=($stdout.total -gt $MaxOutputBytes)
      stderr_truncated=($stderr.total -gt $MaxOutputBytes)
      stdout_stream_complete=[bool]$stdoutState.done
      stderr_stream_complete=[bool]$stderrState.done
      # When the stream is not complete, byte counts and hashes describe only
      # the captured bytes, never a full-stream total.
      stdout_hash_scope=if ([bool]$stdoutState.done -and -not $stdoutState.faulted) { 'FULL_STREAM' } else { 'CAPTURED_BYTES_ONLY' }
      stderr_hash_scope=if ([bool]$stderrState.done -and -not $stderrState.faulted) { 'FULL_STREAM' } else { 'CAPTURED_BYTES_ONLY' }
      capture_outcome=$captureOutcome
      cleanup_effect=$cleanupEffect
      started_at_utc=$startedAt.ToString('o')
      finished_at_utc=$finishedAt.ToString('o')
    }
  } finally {
    if ($process) { try { $process.Dispose() } catch {} }
    Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
  }
}
