import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest=fs.readFileSync('host/v45/PTYSD.HostGuard/PTYSD.HostGuard.psd1','utf8');
const role=fs.readFileSync('host/v45/PTYSD.HostGuard/RoleCapabilities/PTYSDHostGuard.psrc','utf8');
const repair=fs.readFileSync('scripts/reconcile-v45-hostguard-hyperv-dependency.ps1','utf8');

test('HostGuard retains Hyper-V as an internal required dependency after later dependency expansion',()=>{
  assert.match(manifest,/RequiredModules=@\('Hyper-V'(?:,'[^']+')*\)/);
  assert.match(manifest,/FunctionsToExport=@\('Get-PTYSDHostGuardStatus','Invoke-PTYSDHostPrepare','Start-PTYSDWorkerVm'\)/);
});

test('JEA caller surface does not expose Hyper-V cmdlets',()=>{
  assert.match(role,/ModulesToImport=@\('PTYSD\.HostGuard'\)/);
  assert.match(role,/VisibleCmdlets=@\(\)/);
  assert.equal(role.includes("'Get-VM'"),false);
  assert.equal(role.includes("'Start-VM'"),false);
  assert.equal(role.includes("'Stop-VM'"),false);
});

test('repair is pinned to exact host VM endpoint and immutable source commit',()=>{
  assert.match(repair,/DESKTOP-1B6PD2P/);
  assert.match(repair,/PTYSD-WORKER-01/);
  assert.match(repair,/881f7819-baa9-4a4e-8cca-8f6f18fb89a9/i);
  assert.match(repair,/PTYSD\.HostGuard\.V45/);
  assert.match(repair,/raw\.githubusercontent\.com\/PT-Original-Point\/ptysd-vnext42-governance-sandbox\/\$SourceCommit\/host\/v45\/PTYSD\.HostGuard\/PTYSD\.HostGuard\.psd1/);
});

test('repair only changes the HostGuard manifest dependency and preserves network boundary',()=>{
  assert.match(repair,/pre-hyperv-dependency-reconcile/);
  assert.match(repair,/CANDIDATE_REQUIRED_MODULE_INVALID/);
  assert.match(repair,/INSTALLED_REQUIRED_MODULE_INVALID/);
  assert.match(repair,/Get-LoopbackListenerState/);
  assert.match(repair,/FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED/);
  assert.match(repair,/WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW/);
  assert.match(repair,/Get-Command Get-VM/);
  assert.match(repair,/Restart-Service WinRM -Force/);
});

test('repair forbids VM firewall runner and global execution-policy mutation',()=>{
  for(const forbidden of ['Start-VM','Stop-VM','Restart-VM','Set-NetFirewallRule','New-NetFirewallRule','Remove-NetFirewallRule','Add-LocalGroupMember','Enable-PSRemoting','Set-ExecutionPolicy']) assert.equal(repair.includes(forbidden),false,`forbidden ${forbidden}`);
  assert.match(repair,/VmMutation=\$false/);
  assert.match(repair,/PublicFirewallMutation=\$false/);
  assert.match(repair,/RunnerPrivilegeElevation=\$false/);
  assert.match(repair,/GlobalExecutionPolicyMutation=\$false/);
  assert.match(repair,/ROLLBACK_ERRORS/);
});
