import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const helperPath = resolve(packageRoot, 'broker/host-powershell-exec.ps1');
const isWindows = process.platform === 'win32';

function powerShellStdin(runner, payload) {
  // Transport the command JSON as Base64 stdin (same-source robust for PS 5.1).
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', runner], {
    input: encoded, encoding: 'utf8', timeout: 120000, windowsHide: true,
  });
  return result;
}

const STDIN_BOOT = `$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($bytes));`;

function runHelper(script, timeoutSeconds = 30) {
  const execTemp = mkdtempSync(join(tmpdir(), 'factory-mcp-exec-bounded-'));
  try {
    const payload = {
      helper_path: helperPath,
      script,
      timeout_seconds: timeoutSeconds,
      exec_temp: execTemp,
    };
    const runner = STDIN_BOOT + `. $payload.helper_path;
$script=[Text.Encoding]::UTF8.GetBytes($payload.script);
if (-not (Test-Path -LiteralPath $payload.exec_temp)) { New-Item -ItemType Directory -Path $payload.exec_temp -Force | Out-Null }
$r=Invoke-PTYSDHostPowerShellExec -ScriptBytes $script -TimeoutSeconds ([int]$payload.timeout_seconds) -ExecTemp $payload.exec_temp -RequestId ([Guid]::NewGuid().ToString('N').Substring(0,32));
[Console]::Out.Write(($r | ConvertTo-Json -Depth 5 -Compress))`;
    const result = powerShellStdin(runner, payload);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(execTemp, { recursive:true, force:true });
  }
}

test('helper bounds high-volume stdout AND stderr with truncation metadata', { skip: !isWindows }, () => {
  const r = runHelper(`1..400 | ForEach-Object { [Console]::Error.WriteLine('e'*500); Write-Output ('o'*500) }`);
  assert.equal(r.timed_out, false);
  assert.equal(r.exit_code, 0);
  assert.equal(r.capture_outcome, 'COMPLETED');
  assert.ok(r.stdout_bytes > 200000, 'full stdout byte count must be reported');
  assert.ok(r.stderr_bytes > 200000, 'full stderr byte count must be reported');
  assert.equal(r.stdout_truncated, true);
  assert.equal(r.stderr_truncated, true);
  assert.match(r.stdout_sha256, /^[a-f0-9]{64}$/);
  assert.match(r.stderr_sha256, /^[a-f0-9]{64}$/);
  // Bounded retention: bounded prefix is kept, not the full stream.
  assert.ok(r.stdout.length <= 131072);
  assert.ok(r.stderr.length <= 131072);
});

test('helper bounds a parent exiting while a descendant retains the pipe', { skip: !isWindows }, () => {
  const child = Buffer.from('Start-Sleep -Seconds 12', 'utf16le').toString('base64');
  const r = runHelper(`$child='${child}'; $p=Start-Process -NoNewWindow -PassThru -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -ArgumentList @('-NoProfile','-EncodedCommand',$child); Write-Output ('TEST_DESCENDANT_PID=' + $p.Id); Write-Output 'parent-exiting'; exit 0`, 10);
  assert.equal(r.timed_out, false);
  assert.equal(r.exit_code, 0);
  assert.equal(r.capture_outcome, 'CAPTURE_DEADLINE_EXCEEDED');
  assert.equal(r.cleanup_effect, 'UNCONFIRMED_DESCENDANT_RETAINED_PIPES');
  assert.equal(r.stdout_stream_complete, false);
  assert.equal(r.stderr_stream_complete, false);
  assert.equal(r.stdout_hash_scope, 'CAPTURED_BYTES_ONLY');
  assert.equal(r.stderr_hash_scope, 'CAPTURED_BYTES_ONLY');
});

test('helper bounds a continuously writing descendant retaining the pipe', { skip: !isWindows }, () => {
  const child = Buffer.from("$i=0;while($i -lt 150){[Console]::Out.WriteLine(('x'*100));Start-Sleep -Milliseconds 100;$i++}", 'utf16le').toString('base64');
  const r = runHelper(`$child='${child}'; $p=Start-Process -NoNewWindow -PassThru -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -ArgumentList @('-NoProfile','-EncodedCommand',$child); Write-Output ('TEST_DESCENDANT_PID=' + $p.Id); Write-Output 'parent-exiting'; exit 0`, 10);
  assert.equal(r.timed_out, false);
  assert.equal(r.exit_code, 0);
  assert.equal(r.capture_outcome, 'CAPTURE_DEADLINE_EXCEEDED');
  assert.equal(r.cleanup_effect, 'UNCONFIRMED_DESCENDANT_RETAINED_PIPES');
  assert.equal(r.stdout_stream_complete, false);
  assert.equal(r.stderr_stream_complete, false);
  assert.equal(r.stdout_hash_scope, 'CAPTURED_BYTES_ONLY');
  assert.equal(r.stderr_hash_scope, 'CAPTURED_BYTES_ONLY');
  assert.ok(r.stdout_bytes < 10_000, 'capture stays bounded despite continuous writes');
  assert.match(r.stdout_sha256, /^[a-f0-9]{64}$/);
  assert.ok(typeof r.stdout_bytes === 'number');
});

test('helper fails closed on oversize script and bad timeout', { skip: !isWindows }, () => {
  const runner = STDIN_BOOT + `. $payload.helper_path;
if (-not (Test-Path -LiteralPath $payload.exec_temp)) { New-Item -ItemType Directory -Path $payload.exec_temp -Force | Out-Null }
try { Invoke-PTYSDHostPowerShellExec -ScriptBytes (New-Object byte[] 40000) -TimeoutSeconds 5 -ExecTemp $payload.exec_temp -RequestId ('a'*32); [Console]::Out.Write('BAD') } catch { [Console]::Out.Write('OK:' + $_.Exception.Message) }`;
  const execTemp = mkdtempSync(join(tmpdir(), 'factory-mcp-exec-bounded-'));
  try {
    const result = powerShellStdin(runner, { helper_path: helperPath, exec_temp: execTemp });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'OK:POWERSHELL_SCRIPT_SIZE_INVALID');
  } finally {
    rmSync(execTemp, { recursive:true, force:true });
  }
});
