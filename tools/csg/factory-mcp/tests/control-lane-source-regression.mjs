import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const broker = fs.readFileSync(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');

test('long host PowerShell is detached from the broker control loop', () => {
  for (const token of [
    'Start-BrokerPowerShell',
    'Start-Job -ScriptBlock',
    'Complete-ActivePowerShellJob',
    "state='STARTED'",
    "state = 'ORPHANED_UNKNOWN'",
    "throw 'POWERSHELL_BUSY'",
    'host_exec_lane',
  ]) assert.ok(broker.includes(token), `missing control-lane token: ${token}`);
});

test('broker keeps exactly one in-memory execution lane and no new daemon/store', () => {
  assert.ok(broker.includes('$script:activePowerShellJob = $null'));
  assert.ok(broker.includes('$script:activePowerShellContext = $null'));
  assert.equal(broker.includes('Start-Process'), false);
  assert.equal(broker.includes('New-Service'), false);
  assert.equal(broker.includes('Register-ScheduledTask'), false);
});

test('public Factory MCP surface stays exactly four tools', () => {
  const names = [...index.matchAll(/server\.registerTool\(\s*\n\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ['factory_status','host_powershell','worker_prepare','worker_start']);
  assert.equal(index.includes("'host_exec_status'"), false);
});
