import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest=fs.readFileSync('host/v45/PTYSD.HostGuard/PTYSD.HostGuard.psd1','utf8');
const role=fs.readFileSync('host/v45/PTYSD.HostGuard/RoleCapabilities/PTYSDHostGuard.psrc','utf8');
const repair=fs.readFileSync('scripts/reconcile-v45-hostguard-runtime-dependencies.ps1','utf8');

test('HostGuard declares complete internal runtime dependencies',()=>{
  assert.match(manifest,/RequiredModules=@\('Hyper-V','CimCmdlets','NetTCPIP'\)/);
  assert.match(manifest,/FunctionsToExport=@\('Get-PTYSDHostGuardStatus','Invoke-PTYSDHostPrepare','Start-PTYSDWorkerVm'\)/);
});

test('JEA caller surface still exposes only HostGuard functions',()=>{
  assert.match(role,/ModulesToImport=@\('PTYSD\.HostGuard'\)/);
  assert.match(role,/VisibleCmdlets=@\(\)/);
  for(const cmd of ["'Get-VM'","'Get-CimInstance'","'Test-NetConnection'","'Start-VM'","'Stop-VM'"]) assert.equal(role.includes(cmd),false,`caller surface leaked ${cmd}`);
});

test('repair is pinned to exact host VM endpoint and immutable source commit',()=>{
  assert.match(repair,/DESKTOP-1B6PD2P/);assert.match(repair,/PTYSD-WORKER-01/);assert.match(repair,/881f7819-baa9-4a4e-8cca-8f6f18fb89a9/i);assert.match(repair,/PTYSD\.HostGuard\.V45/);
  assert.match(repair,/raw\.githubusercontent\.com\/PT-Original-Point\/ptysd-vnext42-governance-sandbox\/\$SourceCommit\/host\/v45\/PTYSD\.HostGuard\/PTYSD\.HostGuard\.psd1/);
});

test('repair requires prior Hyper-V-only prestate and upgrades exact dependency set',()=>{
  assert.match(repair,/HOSTGUARD_REQUIRED_MODULE_PRESTATE_UNEXPECTED/);assert.match(repair,/ExpectedRequired=@\('Hyper-V','CimCmdlets','NetTCPIP'\)/);assert.match(repair,/CANDIDATE_REQUIRED_MODULES_INVALID/);assert.match(repair,/INSTALLED_REQUIRED_MODULES_INVALID/);assert.match(repair,/Get-Command \$name/);
});

test('repair preserves endpoint and host security boundaries',()=>{
  assert.match(repair,/PSSC_EXECUTION_POLICY_NOT_BYPASS/);assert.match(repair,/RestrictedRemoteServer/);assert.match(repair,/NoLanguage/);assert.match(repair,/Get-LoopbackListenerState/);assert.match(repair,/FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED/);assert.match(repair,/WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW/);assert.match(repair,/Restart-Service WinRM -Force/);
});

test('repair forbids VM firewall runner and global execution-policy mutation',()=>{
  for(const forbidden of ['Start-VM','Stop-VM','Restart-VM','Set-NetFirewallRule','New-NetFirewallRule','Remove-NetFirewallRule','Add-LocalGroupMember','Enable-PSRemoting','Set-ExecutionPolicy']) assert.equal(repair.includes(forbidden),false,`forbidden ${forbidden}`);
  assert.match(repair,/VmMutation=\$false/);assert.match(repair,/PublicFirewallMutation=\$false/);assert.match(repair,/RunnerPrivilegeElevation=\$false/);assert.match(repair,/GlobalExecutionPolicyMutation=\$false/);assert.match(repair,/ROLLBACK_ERRORS/);
});
