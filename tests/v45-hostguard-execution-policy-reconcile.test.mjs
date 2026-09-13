import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text=fs.readFileSync('scripts/reconcile-v45-hostguard-jea-execution-policy.ps1','utf8');

test('execution-policy reconciliation is pinned to the exact host VM and endpoint',()=>{
  assert.match(text,/DESKTOP-1B6PD2P/);
  assert.match(text,/PTYSD-WORKER-01/);
  assert.match(text,/881f7819-baa9-4a4e-8cca-8f6f18fb89a9/i);
  assert.match(text,/PTYSD\.HostGuard\.V45/);
});

test('preflight accepts only the observed Restricted JEA configuration and loopback WinRM boundary',()=>{
  assert.match(text,/PSSC_EXECUTION_POLICY_PRESTATE_UNEXPECTED/);
  assert.match(text,/RestrictedRemoteServer/);
  assert.match(text,/NoLanguage/);
  assert.match(text,/RunAsVirtualAccount/);
  assert.match(text,/PTYSDHostGuard/);
  assert.match(text,/Get-WSManInstance -ResourceURI 'winrm\/config\/listener' -Enumerate/);
  assert.match(text,/IP:127\.0\.0\.1/);
  assert.match(text,/FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED/);
  assert.match(text,/WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW/);
});

test('candidate changes only the JEA PSSC execution policy to Bypass',()=>{
  assert.match(text,/New-PSSessionConfigurationFile[^\n]+-SessionType RestrictedRemoteServer[^\n]+-LanguageMode NoLanguage[^\n]+-ExecutionPolicy Bypass/);
  assert.match(text,/PSSC_CANDIDATE_EXECUTION_POLICY_NOT_BYPASS/);
  assert.match(text,/ExecutionPolicyBefore='Restricted'/);
  assert.match(text,/ExecutionPolicyAfter='Bypass'/);
  assert.match(text,/GlobalExecutionPolicyMutation=\$false/);
  assert.equal(text.includes('Set-ExecutionPolicy'),false);
});

test('endpoint replacement preserves explicit caller SDDL and uses one controlled WinRM restart',()=>{
  assert.match(text,/O:NSG:BAD:P\(A;;GA;;;NS\)\(A;;GA;;;BA\)S:P/);
  assert.match(text,/Unregister-PSSessionConfiguration -Name \$Endpoint -Force -NoServiceRestart/);
  assert.match(text,/Register-PSSessionConfiguration -Name \$Endpoint -Path \$candidate -AccessMode Remote -SecurityDescriptorSddl \$Sddl -Force -NoServiceRestart/);
  assert.match(text,/NETWORK_SERVICE_ALLOW_MISSING/);
  assert.match(text,/NETWORK_DENY_REAPPEARED/);
});

test('failure restores backup PSSC and prior Remote endpoint',()=>{
  assert.match(text,/pre-execution-policy-reconcile/);
  assert.match(text,/Register-PSSessionConfiguration -Name \$Endpoint -Path \$BackupPssc -AccessMode Remote -SecurityDescriptorSddl \$Sddl -Force -NoServiceRestart/);
  assert.match(text,/Copy-Item -LiteralPath \$BackupPssc -Destination \$CanonicalPssc -Force/);
  assert.match(text,/ROLLBACK_ERRORS/);
});

test('reconciliation never mutates VM firewall runner membership or global execution policy',()=>{
  for(const forbidden of ['Start-VM','Stop-VM','Restart-VM','Set-NetFirewallRule','New-NetFirewallRule','Remove-NetFirewallRule','Add-LocalGroupMember','Enable-PSRemoting','Set-ExecutionPolicy']) {
    assert.equal(text.includes(forbidden),false,`forbidden ${forbidden}`);
  }
  assert.match(text,/VmMutation=\$false/);
  assert.match(text,/PublicFirewallMutation=\$false/);
  assert.match(text,/RunnerPrivilegeElevation=\$false/);
  assert.match(text,/GlobalExecutionPolicyMutation=\$false/);
});
