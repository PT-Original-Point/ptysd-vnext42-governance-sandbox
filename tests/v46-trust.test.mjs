import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const q=JSON.parse(fs.readFileSync(new URL('../governance/v46/trust-qualification.json',import.meta.url),'utf8'));
const m=JSON.parse(fs.readFileSync(new URL('../governance/v46/trusted-release-manifest.candidate.json',import.meta.url),'utf8'));
test('public current control path is not promotion-qualified',()=>{
  assert.equal(q.observed_visibility,'public');
  assert.equal(q.current_path_promotion_qualified,false);
  assert.equal(q.rulesets_count,0);
  assert.equal(q.branch_protection_absence_claimed,false);
  assert.equal(q.organization_plan,'UNKNOWN');
});
test('unknown entitlement fails closed rather than inventing paid capability',()=>{
  assert.equal(q.private_advanced_protection_entitlement,'UNKNOWN_ACCOUNT_SPECIFIC');
  assert.equal(q.verdict,'BLOCKED_HUMAN_OR_PROVIDER_CAPABILITY');
  assert.equal(q.automatic_visibility_change_allowed,false);
});
test('trusted manifest is candidate-only and candidate cannot rewrite trust anchor',()=>{
  assert.equal(m.status,'CANDIDATE_NOT_ENFORCED');
  assert.equal(m.candidate_code_may_modify_manifest,false);
  assert.equal(m.candidate_code_may_modify_expected_digest,false);
  assert.equal(m.production_allowed,false);
});
