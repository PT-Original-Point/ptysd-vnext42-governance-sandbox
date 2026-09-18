import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePolicyRequest} from '../tools/csg/cell-kernel/production-kernel.mjs';

const identity={project_id:'P',run_id:'R',task_id:'T',attempt_id:'A',attempt_epoch:1};
const cap={schema:'v48.cell-capability.v1',...identity,owned_paths:['src'],read_paths:['docs'],forbidden_paths:['governance'],resource_limits:{cpu_millis:1000,memory_mib:512,pids:32,disk_mib:128,provider_calls:0,network_mode:'DENY'},data_class:['PUBLIC','SYNTHETIC'],model_profile_id:'M1',model_profile_revision:'R1',execution_authorized:false};
const req=()=>({effect_class:'READ_ONLY',path:'docs/x',resource_usage:{provider_calls:0,network_mode:'DENY'},data_class:'SYNTHETIC',model_profile_id:'M1',model_profile_revision:'R1',paid_fallback_allowed:false,incremental_usd:0,permission_decision:'ALLOW',interactive:false,ambient_env:{},secret_refs:[],git_argv:[],dispatch_requested:true});
const profile=()=>({project_id:'P',profile_id:'M1',revision:'R1',data_classes:['PUBLIC','SYNTHETIC'],paid_fallback_allowed:false,incremental_usd:0,entitlement:'PASS_CURRENT_REAL_INFERENCE',expires_at:'2026-09-19T00:00:00Z'});
const run=(q={},p=profile())=>evaluatePolicyRequest({identity,capability:cap,request:{...req(),...q},model_profile:p,credential_profile:{project_id:'P',allowed_secret_refs:[],raw_secret_values_present:false},now:'2026-09-18T00:00:00Z'});

test('inactive model route never dispatches even when policy allows read-only evaluation',()=>{const x=run();assert.equal(x.allow,true);assert.equal(x.dispatch_allowed,false);});
test('wrong model profile identity rejects before provider call',()=>{const x=run({}, {...profile(),profile_id:'OTHER'});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('MODEL_PROFILE_BINDING_MISMATCH'));});
test('changed cost rejects before provider call',()=>{const x=run({}, {...profile(),incremental_usd:0.01});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('MODEL_PROFILE_COST_POLICY'));});
test('private or confidential data rejects before provider call',()=>{for(const d of ['PRIVATE','CONFIDENTIAL','PERSONAL','SECRET']){const x=run({data_class:d});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('DATA_CLASS_WIDEN'));}});
test('expired or unknown entitlement rejects before provider call',()=>{let x=run({}, {...profile(),entitlement:'UNKNOWN'});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('MODEL_PROFILE_ENTITLEMENT_UNKNOWN'));x=evaluatePolicyRequest({identity,capability:cap,request:req(),model_profile:{...profile(),expires_at:'2026-09-17T00:00:00Z'},credential_profile:{project_id:'P',allowed_secret_refs:[],raw_secret_values_present:false},now:'2026-09-18T00:00:00Z'});assert.ok(x.reason_codes.includes('MODEL_PROFILE_EXPIRED'));});
test('paid fallback remains hard denied',()=>{const x=run({paid_fallback_allowed:true,incremental_usd:1});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('PAID_FALLBACK_FORBIDDEN'));});
