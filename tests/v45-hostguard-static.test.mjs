import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleText=fs.readFileSync('host/v45/PTYSD.HostGuard/PTYSD.HostGuard.psm1','utf8');
const roleText=fs.readFileSync('host/v45/PTYSD.HostGuard/RoleCapabilities/PTYSDHostGuard.psrc','utf8');
const installText=fs.readFileSync('scripts/install-v45-hostguard-jea.ps1','utf8');

const exactFunctions=['Get-PTYSDHostGuardStatus','Invoke-PTYSDHostPrepare','Start-PTYSDWorkerVm'];

test('HostGuard pins one host and one VM identity',()=>{
  assert.match(moduleText,/DESKTOP-1B6PD2P/);
  assert.match(moduleText,/PTYSD-WORKER-01/);
  assert.match(moduleText,/881f7819-baa9-4a4e-8cca-8f6f18fb89a9/i);
  assert.match(moduleText,/VM_ID_MISMATCH/);
  assert.match(moduleText,/HOST_ID_MISMATCH/);
});

test('JEA role exposes only fixed HostGuard functions',()=>{
  for(const f of exactFunctions) assert.match(roleText,new RegExp(f));
  assert.match(roleText,/VisibleCmdlets\s*=\s*@\(\)/);
  assert.match(roleText,/VisibleExternalCommands\s*=\s*@\(\)/);
  assert.match(roleText,/VisibleProviders\s*=\s*@\(\)/);
});

test('installer preserves privilege separation and local-only remoting',()=>{
  assert.match(installText,/AccessMode Local/);
  assert.match(installText,/IP:127\.0\.0\.1/);
  assert.match(installText,/S-1-5-32-578/);
  assert.match(installText,/S-1-5-20/);
  for(const forbidden of ['Enable-PSRemoting','Set-NetFirewallRule','New-NetFirewallRule','Add-LocalGroupMember','Invoke-Expression']) {
    assert.equal(installText.includes(forbidden),false,`forbidden ${forbidden}`);
  }
});

test('normal runner is not promoted to Hyper-V Administrators',()=>{
  assert.equal(installText.includes("Add-LocalGroupMember -Group 'Hyper-V Administrators'"),false);
  assert.match(installText,/RunAsVirtualAccount/);
  assert.match(installText,/RunAsVirtualAccountGroups/);
});

test('staged module wildcard copy expands by Path and never LiteralPath',()=>{
  assert.ok(installText.includes("Copy-Item -Path (Join-Path $stage '*') -Destination $ModuleTarget -Recurse -Force"));
  assert.equal(installText.includes("Copy-Item -LiteralPath (Join-Path $stage '*')"),false);
});

test('installer accepts only the observed dormant default wildcard listener prestate',()=>{
  assert.match(installText,/DORMANT_DEFAULT_WILDCARD/);
  assert.match(installText,/PSChildName -eq '\*\+HTTP'/);
  assert.match(installText,/\[int\]\$lp\.Port -ne 5985/);
  assert.match(installText,/\[string\]\$lp\.uriprefix -ne 'wsman'/);
  assert.match(installText,/EXISTING_WINRM_LISTENER_NOT_DORMANT/);
  assert.match(installText,/WINRM_PORT_ALREADY_LISTENING_MANUAL_REVIEW/);
  assert.match(installText,/FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED/);
  assert.match(installText,/WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW/);
});

test('listener transition creates loopback before removing wildcard and validates loopback-only state',()=>{
  const createLoopback=installText.indexOf("New-Item -Path WSMan:\\localhost\\Listener -Transport HTTP -Address 'IP:127.0.0.1'");
  const removeWildcard=installText.indexOf("Remove-WSManInstance -ResourceURI 'winrm/config/listener' -SelectorSet @{Address='*';Transport='HTTP'}");
  assert.ok(createLoopback>=0,'loopback listener create missing');
  assert.ok(removeWildcard>createLoopback,'wildcard must be removed only after loopback exists');
  assert.match(installText,/LOOPBACK_ONLY_LISTENER_VALIDATION_FAILED/);
  assert.match(installText,/FINAL_LISTENER_VALIDATION_FAILED/);
  assert.match(installText,/WINRM_FIREWALL_RULE_APPEARED_UNEXPECTEDLY/);
  assert.match(installText,/FINAL_WINRM_FIREWALL_RULE_UNEXPECTED/);
});

test('wildcard prestate is backed up and rollback reconstructs it without firewall mutation',()=>{
  assert.match(installText,/reg\.exe.*export/s);
  assert.match(installText,/preinstall-winrm-listener\.reg/);
  assert.match(installText,/preinstall-winrm-prestate\.json/);
  assert.match(installText,/\$preListenerAddress='\*'/);
  assert.match(installText,/New-Item -Path WSMan:\\localhost\\Listener -Transport HTTP -Address \$preListenerAddress -Force/);
  assert.match(installText,/ROLLBACK_ERRORS/);
  assert.match(installText,/Stop-Service WinRM/);
  assert.match(installText,/Set-Service WinRM -StartupType Manual/);
});
