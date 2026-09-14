import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync(new URL('../governance/v46/authority-readback.json',import.meta.url),'utf8'));
const p=JSON.parse(fs.readFileSync(new URL('../governance/v46/minimal-execution-policy.candidate.json',import.meta.url),'utf8'));
test('missing canonical bodies block publication even when revision/hash projections exist',()=>{
  assert.equal(a.mission_observation.canonical_body_available,false);
  assert.equal(a.policy_observation.canonical_body_available,false);
  assert.equal(a.mission_observation.hash_recomputed,false);
  assert.equal(a.policy_observation.hash_recomputed,false);
  assert.equal(a.publication_allowed,false);
});
test('human V4.6 adoption is not silently widened to Mission or Policy publication',()=>{
  assert.equal(a.v46_adoption.human_approved,true);
  assert.equal(a.v46_adoption.scope,'CONSTRUCTION_SPEC_ONLY_NOT_MISSION_OR_POLICY_PUBLICATION');
  assert.equal(p.status,'CANDIDATE_NOT_PUBLISHED');
  assert.equal(p.publication_allowed,false);
});
test('minimal policy candidate preserves hard V4.6 boundaries',()=>{
  assert.equal(p.architecture,'A_LEAN_BOUNDED_FACTORY');
  assert.equal(p.coding_parallelism_active,1);
  assert.equal(p.zero_incremental_paid_cost_required,true);
  assert.equal(p.paid_fallback_allowed,false);
  assert.equal(p.provider_write_credentials_on_worker_allowed,false);
  assert.equal(p.business_project_access_allowed,false);
  assert.equal(p.production_allowed,false);
  assert.match(p.control_ref_update,/NO_FORCE/);
});
