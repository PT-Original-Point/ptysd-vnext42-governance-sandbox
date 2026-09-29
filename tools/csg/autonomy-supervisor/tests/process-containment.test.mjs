import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('Windows job object terminates a descendant holding inherited output pipes after its root exits', {skip: process.platform !== 'win32'}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v51-process-job-'));
  const source = fileURLToPath(new URL('../lib/BoundedPipeCapture.cs', import.meta.url));
  const childPidFile = path.join(root, 'child.pid');
  const psQuote = value => value.replace(/'/g, "''");
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = `if ([Console]::ReadLine() -cne 'GO') { throw 'START_GATE_MISSING' }; $child=Start-Process -FilePath '${psQuote(powershell)}' -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -NoNewWindow -PassThru; [IO.File]::WriteAllText('${psQuote(childPidFile)}',$child.Id.ToString())`;
  const encodedCommand = Buffer.from(`$ErrorActionPreference='Stop';${command};exit 0`, 'utf16le').toString('base64');
  const ps = `
$ErrorActionPreference='Stop'
Add-Type -Path '${psQuote(source)}'
$psi=New-Object Diagnostics.ProcessStartInfo
$psi.FileName='${psQuote(powershell)}'
$psi.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}'
$psi.UseShellExecute=$false
$psi.CreateNoWindow=$true
$psi.RedirectStandardInput=$true
$psi.RedirectStandardOutput=$true
$psi.RedirectStandardError=$true
$process=New-Object Diagnostics.Process
$process.StartInfo=$psi
$job=$null
try{
  if(-not $process.Start()){throw 'ROOT_START_FAILED'}
  $stdout=$process.StandardOutput.ReadToEndAsync()
  $stderr=$process.StandardError.ReadToEndAsync()
  $job=[Ptysd.AutonomySupervisor.KillOnCloseProcessJob]::Assign($process)
  $process.StandardInput.WriteLine('GO')
  $process.StandardInput.Flush()
  if(-not $process.WaitForExit(10000)){throw 'ROOT_DID_NOT_EXIT'}
  if(-not (Test-Path -LiteralPath '${psQuote(childPidFile)}')){throw 'CHILD_PID_NOT_RECORDED'}
  $childPid=[int](Get-Content -LiteralPath '${psQuote(childPidFile)}' -Raw)
  $activeBefore=[int]$job.ActiveProcessCount
  if($activeBefore -lt 1){throw 'EXPECTED_ORPHANED_CHILD_IN_JOB'}
  $childProcess=Get-Process -Id $childPid -ErrorAction SilentlyContinue
  if(-not $childProcess){throw 'INHERITED_PIPE_CHILD_NOT_ALIVE'}
  $job.Terminate(125)
  if(-not $childProcess.WaitForExit(5000)){throw 'CHILD_PROCESS_EXIT_NOT_PROVEN'}
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while([int]$job.ActiveProcessCount -gt 0 -and $clock.Elapsed.TotalSeconds -lt 5){Start-Sleep -Milliseconds 25}
  if([int]$job.ActiveProcessCount -ne 0){throw 'JOB_CHILD_CLEANUP_NOT_PROVEN'}
  if(-not $childProcess.HasExited){throw 'CHILD_PROCESS_REMAINS_AFTER_JOB_TERMINATE'}
  if(-not $stdout.Wait(5000)){throw 'STDOUT_PIPE_REMAINS_OPEN'}
  if(-not $stderr.Wait(5000)){throw 'STDERR_PIPE_REMAINS_OPEN'}
  Write-Output 'PROCESS_JOB_CONTAINMENT_PASS'
}finally{
  if($job){if([int]$job.ActiveProcessCount -gt 0){try{$job.Terminate(125)}catch{}};$job.Dispose()}
  if($process){if(-not $process.HasExited){try{$process.Kill()}catch{}};$process.Dispose()}
}
`;
  try {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const run = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /PROCESS_JOB_CONTAINMENT_PASS/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
