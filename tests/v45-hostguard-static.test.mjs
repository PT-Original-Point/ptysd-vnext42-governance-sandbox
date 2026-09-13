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
  for(const forbidden of ['Enable-PSRemoting','Set-NetFirewallRule','Add-LocalGroupMember','Invoke-Expression','-Address \'*\'']) assert.equal(installText.includes(forbidden),false,`forbidden ${forbidden}`);
});

test('normal runner is not promoted to Hyper-V Administrators',()=>{
  assert.equal(installText.includes("Add-LocalGroupMember -Group 'Hyper-V Administrators'"),false);
  assert.match(installText,/RunAsVirtualAccount/);
  assert.match(installText,/RunAsVirtualAccountGroups/);
});
