import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const control=JSON.parse(fs.readFileSync('governance/v45/control.json','utf8'));
const run=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/run.json','utf8'));
const host=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/001-host-channel-qualification.json','utf8'));
const jea=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/002-jea-package-validation.json','utf8'));
const access=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/003-hostguard-provider-readback-blocker.json','utf8'));
const reconcile=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/004-hostguard-access-reconcile-package.json','utf8'));
const preflight=JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/evidence/005-hostguard-access-preflight-failure.json','utf8'));

test('Z4 records the real privilege boundary instead of pretending VM absence',()=>{
  assert.equal(host.runner_executor,'NT AUTHORITY\\NETWORK SERVICE');
  assert.equal(host.runner_hyperv_read,'DENIED_EXPECTED_PRIVILEGE_BOUNDARY');
  assert.equal(host.guest_ssh22_reachable,true);
  assert.equal(host.existing_fixed_hostguard_service,false);
  assert.equal(host.conclusion,'HOSTGUARD_REQUIRED_DO_NOT_ELEVATE_RUNNER');
});

test('JEA HostGuard is installed and fail-closed at the corrected WSMan preflight fix gate',()=>{
  assert.equal(jea.powershell_package_result,'PASS_V45_HOSTGUARD_POWERSHELL51_PACKAGE');
  assert.equal(jea.static_tests_fail,0);
  assert.equal(control.z4_hostguard_package_validation,'PASS');
  assert.equal(control.z4_hostguard_install_required,false);
  assert.equal(control.z4_hostguard_human_install_result,'HOSTGUARD_JEA_INSTALLED');
  assert.equal(control.z4_hostguard_provider_readback,'BLOCKED_CALLER_ACCESS');
  assert.equal(control.z4_hostguard_access_reconcile_required,true);
  assert.equal(control.z4_hostguard_access_reconcile_package_validation,'INVALIDATED_PREFLIGHT_ASSUMPTION');
  assert.equal(control.z4_hostguard_access_preflight_failure,'SIDE_EFFECT_NOT_APPLIED');
  assert.equal(control.wait_reason,'HOSTGUARD_JEA_ACCESS_PREFLIGHT_FIX_REQUIRED');
  assert.equal(run.wait_reason,'HOSTGUARD_JEA_ACCESS_PREFLIGHT_FIX_REQUIRED');
  assert.equal(run.state,'WAITING_RESOURCE');
  assert.equal(run.revision,5);
  assert.ok(run.evidence_refs.includes('evidence/003-hostguard-provider-readback-blocker.json'));
  assert.ok(run.evidence_refs.includes('evidence/004-hostguard-access-reconcile-package.json'));
  assert.ok(run.evidence_refs.includes('evidence/005-hostguard-access-preflight-failure.json'));
  assert.equal(access.classification,'INSTALL_CONFIRMED_FUNCTIONAL_ACCEPTANCE_BLOCKED');
  assert.equal(access.root_cause,'ACCESSMODE_LOCAL_NETWORK_DENY_PRECEDENCE_FOR_NETWORK_SERVICE_LOOPBACK');
  assert.equal(reconcile.provider_smoke_conclusion,'success');
  assert.equal(preflight.side_effect_classification,'SIDE_EFFECT_NOT_APPLIED');
  assert.equal(preflight.failed_before_endpoint_mutation,true);
  assert.equal(preflight.set_pssessionconfiguration_dispatched,false);
  assert.equal(preflight.winrm_restart_dispatched,false);
  assert.equal(preflight.root_cause,'LISTENINGON_IS_WSMAN_LISTENER_RESOURCE_PROPERTY_NOT_A_PROVIDER_CHILD_PATH');
  assert.equal(preflight.next_gate,'HOSTGUARD_JEA_ACCESS_PREFLIGHT_FIX_REQUIRED');
});

test('Z4 remains isolated from business and paid effects',()=>{
  assert.equal(host.business_effects,0);assert.equal(host.production_effects,0);
  assert.equal(jea.business_effects,0);assert.equal(jea.production_effects,0);
  assert.equal(access.business_project_effect,false);assert.equal(access.production_effect,false);
  assert.equal(reconcile.business_project_effect,false);assert.equal(reconcile.production_effect,false);
  assert.equal(preflight.vm_mutation_observed,false);assert.equal(preflight.firewall_mutation_observed,false);
  assert.equal(control.production_allowed,false);
  assert.equal(control.business_project_access_allowed,false);
  assert.equal(control.zero_incremental_paid_cost_required,true);
});
