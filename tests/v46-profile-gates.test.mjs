import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluatePolicyRequest} from '../tools/csg/cell-kernel/production-kernel.mjs';
import {evaluateAdvisorPermit} from '../tools/csg/cell-kernel/advisor-guard.mjs';
import './v46-model-profile-guard.test.mjs';
import './v46-research-contract.test.mjs';
import './csg/v48-host-powershell-governance.test.mjs';

const registry=JSON.parse(fs.readFileSync(new URL('../governance/v46/model-profiles.json',import.meta.url),'utf8'));
test('registry keeps one exact zero-cost PUBLIC/SYNTHETIC profile without secret material',()=>{
  assert.equal(registry.schema,'factory.model_profiles.v1');assert.equal(registry.profiles.length,1);
  const p=registry.profiles[0];assert.equal(p.profile_id,registry.selected_profile_id);assert.equal(p.opencode_model_id,'opencode/muse-spark-1.3-contributor-free');
  assert.equal(p.endpoint,'https://opencode.ai/zen/v1/responses');assert.equal(p.live_cost.input,0);assert.equal(p.live_cost.output,0);
  assert.equal(p.paid_fallback_allowed,false);assert.deepEqual(p.allowed_data_classes,['PUBLIC','SYNTHETIC']);assert.equal(p.secret_material_recorded,false);
});
test('all cost-bearing channel classes keep paid fallback disabled',()=>{
  assert.deepEqual(new Set(registry.channel_inventory.map(x=>x.channel)),new Set(['research','search','eval','model','ci','storage']));
  for(const c of registry.channel_inventory){assert.equal(c.incremental_paid_cost_allowed,false);assert.equal(c.paid_fallback_allowed,false);}
});
test('advisor paid routes and exhausted quota never dispatch',()=>{
  const base={trigger_codes:['T1'],root_task_id:'ROOT',calls_used:0,quota_state:'AVAILABLE',route:'SUBSCRIPTION_AUTHORIZED',incremental_usd:0,zen_paid_fallback:false};
  assert.equal(evaluateAdvisorPermit({...base,route:'API_KEY_PAID_ROUTE'}).dispatch_allowed,false);
  assert.equal(evaluateAdvisorPermit({...base,zen_paid_fallback:true}).dispatch_allowed,false);
  assert.equal(evaluateAdvisorPermit({...base,quota_state:'UNKNOWN'}).state,'CONSERVE');
  assert.equal(evaluateAdvisorPermit({...base,quota_state:'RATE_LIMIT_429'}).state,'WAITING_ADVISOR_RESOURCE');
});
test('generic policy still denies raw provider credentials',()=>{
  const identity={project_id:'P',run_id:'R',task_id:'T',attempt_id:'A',attempt_epoch:1};
  const capability={schema:'v48.cell-capability.v1',...identity,owned_paths:['src'],read_paths:['docs'],forbidden_paths:['governance'],resource_limits:{provider_calls:0,network_mode:'DENY'},data_class:['PUBLIC'],model_profile_id:'NONE_X',model_profile_revision:'N/A',execution_authorized:false};
  const request={effect_class:'READ_ONLY',path:'docs/x',resource_usage:{provider_calls:0,network_mode:'DENY'},data_class:'PUBLIC',paid_fallback_allowed:false,incremental_usd:0,permission_decision:'ALLOW',interactive:false,ambient_env:{},secret_refs:[],git_argv:[],dispatch_requested:false,provider_write_credential:'x'};
  const x=evaluatePolicyRequest({identity,capability,request,now:'2026-09-18T00:00:00Z'});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('RAW_SECRET_OR_PROVIDER_WRITE_CREDENTIAL_FORBIDDEN'));
});
