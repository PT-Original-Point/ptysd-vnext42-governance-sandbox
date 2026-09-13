import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const control=JSON.parse(fs.readFileSync('governance/v45/control.json','utf8'));
const run=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/run.json','utf8'));
const host=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/001-host-channel-qualification.json','utf8'));
const jea=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/002-jea-package-validation.json','utf8'));

test('Z4 records the real privilege boundary instead of pretending VM absence',()=>{
  assert.equal(host.runner_executor,'NT AUTHORITY\\NETWORK SERVICE');
  assert.equal(host.runner_hyperv_read,'DENIED_EXPECTED_PRIVILEGE_BOUNDARY');
  assert.equal(host.guest_ssh22_reachable,true);
  assert.equal(host.existing_fixed_hostguard_service,false);
  assert.equal(host.conclusion,'HOSTGUARD_REQUIRED_DO_NOT_ELEVATE_RUNNER');
});

test('JEA HostGuard candidate is validated but not falsely claimed installed',()=>{
  assert.equal(jea.powershell_package_result,'PASS_V45_HOSTGUARD_POWERSHELL51_PACKAGE');
  assert.equal(jea.static_tests_fail,0);
  assert.equal(jea.hostguard_endpoint_preexisting,false);
  assert.equal(control.z4_hostguard_package_validation,'PASS');
  assert.equal(control.z4_hostguard_install_required,true);
  assert.equal(control.wait_reason,'HOSTGUARD_JEA_ADMIN_INSTALL_REQUIRED');
  assert.equal(run.wait_reason,'HOSTGUARD_JEA_ADMIN_INSTALL_REQUIRED');
  assert.equal(run.state,'WAITING_RESOURCE');
  assert.equal(run.revision,2);
});

test('Z4 remains isolated from business and paid effects',()=>{
  assert.equal(host.business_effects,0);assert.equal(host.production_effects,0);
  assert.equal(jea.business_effects,0);assert.equal(jea.production_effects,0);
  assert.equal(control.production_allowed,false);
  assert.equal(control.business_project_access_allowed,false);
  assert.equal(control.zero_incremental_paid_cost_required,true);
});
