import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text=fs.readFileSync('scripts/reconcile-v45-hostguard-jea-access.ps1','utf8');

test('reconciliation is pinned to the exact HostGuard host, VM and endpoint',()=>{
  assert.match(text,/DESKTOP-1B6PD2P/);
  assert.match(text,/PTYSD-WORKER-01/);
  assert.match(text,/881f7819-baa9-4a4e-8cca-8f6f18fb89a9/i);
  assert.match(text,/PTYSD\.HostGuard\.V45/);
});

test('reconciliation reads listener through the WSMan resource API, not a nonexistent ListeningOn child path',()=>{
  assert.match(text,/Get-WSManInstance -ResourceURI 'winrm\/config\/listener' -Enumerate/);
  assert.match(text,/\$listener\.ListeningOn/);
  assert.equal(text.includes("$listener.PSPath+'\\ListeningOn'"),false);
  assert.equal(text.includes('Get-Item -Path ($listener.PSPath'),false);
});

test('reconciliation requires loopback-only WSMan listener and blocked inbound firewall',()=>{
  assert.match(text,/IP:127\.0\.0\.1/);
  assert.match(text,/WINRM_LISTENING_ON_NOT_LOOPBACK_ONLY/);
  assert.match(text,/127\.0\.0\.1','::1'/);
  assert.match(text,/WINRM_LISTENER_PORT_INVALID/);
  assert.match(text,/FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED/);
  assert.match(text,/WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW/);
});

test('reconciliation removes only AccessMode Local network deny while preserving explicit SDDL',()=>{
  assert.match(text,/AccessMode Remote/);
  assert.match(text,/NETWORK AccessDenied/);
  assert.match(text,/NETWORK SERVICE AccessAllowed/);
  assert.match(text,/O:NSG:BAD:P\(A;;GA;;;NS\)\(A;;GA;;;BA\)S:P/);
  assert.match(text,/NETWORK_DENY_STILL_PRESENT/);
});

test('failure rolls endpoint access mode back to Local',()=>{
  const remote=text.indexOf('AccessMode Remote');
  const local=text.lastIndexOf('AccessMode Local');
  assert.ok(remote>=0);
  assert.ok(local>remote);
  assert.match(text,/ROLLBACK_ERRORS/);
});

test('reconciliation never mutates VM, firewall rules or runner group membership',()=>{
  for(const forbidden of ['Start-VM','Stop-VM','Restart-VM','Set-NetFirewallRule','New-NetFirewallRule','Remove-NetFirewallRule','Add-LocalGroupMember','Enable-PSRemoting']) {
    assert.equal(text.includes(forbidden),false,`forbidden ${forbidden}`);
  }
  assert.match(text,/VmMutation=\$false/);
  assert.match(text,/PublicFirewallMutation=\$false/);
  assert.match(text,/RunnerPrivilegeElevation=\$false/);
});
