import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc=JSON.parse(fs.readFileSync(new URL('../governance/v46/model-profiles.json',import.meta.url),'utf8'));
const p=doc.profiles[0];
function admit({model,dataClass,minutesAfterObserved=0}){
  if(model!==p.opencode_model_id) return 'WAITING_RESOURCE_WRONG_MODEL';
  if(!p.exact_model_allowlist.includes(model)) return 'WAITING_RESOURCE_NOT_ALLOWLISTED';
  if(!p.allowed_data_classes.includes(dataClass)) return 'WAITING_RESOURCE_DATA_POLICY';
  if(minutesAfterObserved>=p.profile_freshness_ttl_minutes) return 'WAITING_RESOURCE_PROFILE_EXPIRED';
  const c=p.live_catalog_cost;
  if([c.input,c.output,c.cache_read,c.cache_write].some(x=>x!==0)) return 'WAITING_RESOURCE_NONZERO_COST';
  if(p.paid_fallback_allowed||p.model_fallback_allowed) return 'WAITING_RESOURCE_FALLBACK_ENABLED';
  if(p.live_catalog_status!=='active') return 'WAITING_RESOURCE_MODEL_INACTIVE';
  return 'ADMIT_SYNTHETIC_OR_PUBLIC_ONLY';
}
test('exact free active profile admits public/synthetic only while fresh',()=>{
  assert.equal(admit({model:p.opencode_model_id,dataClass:'PUBLIC',minutesAfterObserved:30}),'ADMIT_SYNTHETIC_OR_PUBLIC_ONLY');
  assert.equal(admit({model:p.opencode_model_id,dataClass:'SYNTHETIC',minutesAfterObserved:30}),'ADMIT_SYNTHETIC_OR_PUBLIC_ONLY');
});
test('private or confidential data fails closed',()=>{
  for(const c of ['PRIVATE','CONFIDENTIAL','PERSONAL','SECRET','BUSINESS_RESTRICTED']) assert.equal(admit({model:p.opencode_model_id,dataClass:c}), 'WAITING_RESOURCE_DATA_POLICY');
});
test('wrong model and expired profile fail closed without paid fallback',()=>{
  assert.equal(admit({model:'opencode/some-paid-model',dataClass:'SYNTHETIC'}),'WAITING_RESOURCE_WRONG_MODEL');
  assert.equal(admit({model:p.opencode_model_id,dataClass:'SYNTHETIC',minutesAfterObserved:60}),'WAITING_RESOURCE_PROFILE_EXPIRED');
  assert.equal(p.paid_fallback_allowed,false); assert.equal(p.model_fallback_allowed,false);
});
test('training exception and formal prerequisite blocker are explicit',()=>{
  assert.match(p.privacy_training,/TRAIN_FUTURE_META_MODELS/);
  assert.equal(p.provider_region,'US');
  assert.equal(doc.formal_r1_g6_status,'BLOCKED_PREREQUISITES_WP46_04_WP46_06A');
  assert.equal(doc.production_allowed,false);
});
