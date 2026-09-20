import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const broker = fs.readFileSync(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');

test('host PowerShell has bounded multi-run lanes instead of one global lane', () => {
  for (const token of [
    '$script:activePowerShellJobs = @{}',
    '$maxConcurrentPowerShell = 4',
    '$maxPerRunPowerShell = 1',
    'Get-ActivePowerShellEntries',
    'POWERSHELL_CAPACITY_EXHAUSTED',
    'POWERSHELL_RUN_BUSY',
    'Complete-ActivePowerShellJobs',
    'active_count',
    'stale_count',
    'max_per_run',
  ]) assert.ok(broker.includes(token), `missing multi-project token: ${token}`);
  assert.equal(broker.includes('$script:activePowerShellJob = $null'), false);
  assert.equal(broker.includes("throw 'POWERSHELL_BUSY'"), false);
});

test('stale detection is observable but ordinary broker does not gain a kill surface', () => {
  assert.ok(broker.includes('$staleGraceSeconds = 15'));
  assert.ok(broker.includes('age_seconds'));
  assert.ok(broker.includes('stale = [bool]$stale'));
  assert.equal(broker.includes('Stop-Process'), false);
  assert.equal(broker.includes('taskkill.exe'), false);
  assert.equal(broker.includes('New-Service'), false);
  assert.equal(broker.includes('Register-ScheduledTask'), false);
});

test('public Factory MCP surface stays exactly four tools', () => {
  const names = [...index.matchAll(/server\.registerTool\(\s*\n\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ['factory_status','host_powershell','worker_prepare','worker_start']);
  assert.equal(index.includes("'host_exec_status'"), false);
});
