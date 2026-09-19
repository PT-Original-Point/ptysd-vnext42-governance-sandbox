import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelemetrySpan} from '../../tools/csg/cell-kernel/telemetry-plane.mjs';
import {projectWorklog,buildFactoryProjection,canonicalNextTransition,stableJson,FACTORY_PROJECTION_SCHEMA} from '../../scripts/csg-worklog-projector.mjs';

function cp(seq=59){
  return {schema_version:'csg.checkpoint.v1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',checkpoint_seq:seq,transition_id:`T-${seq}`,previous_checkpoint_ref:null,migration_anchor:null,event:{type:'ATOMIC_ACCEPTED',reason_code:'TEST',subject_id:'V49-09'},mission_anchor:{},policy_anchor:{},controller_contract:'C',verifier_digest:'sha256:'+'a'.repeat(64),lifecycle:'ACTIVE',owner:null,run_ref:null,task_id:'V49-10',attempt_id:'V49-V49-10-ATTEMPT-001',attempt_epoch:1,atomic:{unit_id:'V49-09'},last_accepted:null,remote_wip:null,active_job_refs:[],unresolved_effect_refs:[],blockers:[],last_verified_gate:null,next_legal_transition:{action:'V49_10_DETERMINISTIC_WORKLOG_PROJECTION',unit_id:'V49-10',requires:[],forbidden:[]},stop_requested:false,barrier:'CLEAN',evidence_refs:[],recorded_at:'2026-09-19T03:34:00Z',payload_digest:'sha256:'+seq.toString(16).padStart(64,'0')};
}
function span(sequence,overrides={}){
  return createTelemetrySpan({project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',run_id:'V49-CLOSURE-001',root_task_id:'ROOT-1',task_id:'V49-09',attempt_id:'A-1',attempt_epoch:1,sequence,stage:'factory.verify',state:'PASS',artifact_refs:[{kind:'BUNDLE_OBJECT',path:`evidence/${sequence}.json`,digest:'sha256:'+String(sequence).padStart(64,'0')}],gen_ai:{operation_name:'invoke_agent',provider_name:'openai',request_model:'gpt-test',usage:{input_tokens:10,output_tokens:2}},resources:{latency_ms:5},...overrides});
}

test('checkpoint plus telemetry rebuild is byte deterministic',()=>{
  const h=[cp(58),cp(59)],t=[span(1),span(2)];
  const a=projectWorklog(h,{telemetry:t}),b=projectWorklog(structuredClone(h),{telemetry:structuredClone(t)});
  assert.equal(a.worklog_json,b.worklog_json);assert.equal(a.factory_projection_json,b.factory_projection_json);assert.equal(a.markdown,b.markdown);
});

test('telemetry input order cannot change deterministic projection',()=>{
  const x=cp(),a=buildFactoryProjection(x,[span(1),span(2)]),b=buildFactoryProjection(x,[span(2),span(1)]);
  assert.equal(a.telemetry_digest,b.telemetry_digest);assert.equal(stableJson(a.telemetry_rows),stableJson(b.telemetry_rows));
});

test('duplicate telemetry is bounded and does not duplicate projected work',()=>{
  const x=span(1),p=buildFactoryProjection(cp(),[x,x]);
  assert.equal(p.telemetry_count,1);assert.equal(p.telemetry_duplicate_count,1);assert.equal(p.authority,'PROJECTION_ONLY');
});

test('bounded projection retains correlation, safe metrics and artifact refs',()=>{
  const p=buildFactoryProjection(cp(),[span(1)]),r=p.telemetry_rows[0];
  assert.equal(p.schema,FACTORY_PROJECTION_SCHEMA);assert.equal(r.run_id,'V49-CLOSURE-001');assert.equal(r.task_id,'V49-09');assert.equal(r.attempt_epoch,1);
  assert.equal(r.attributes['gen_ai.request.model'],'gpt-test');assert.equal(r.attributes['factory.resource.latency_ms'],5);assert.equal(r.artifact_refs[0].path,'evidence/1.json');
});

test('projection allowlist cannot rehydrate raw prompt/output from malformed telemetry',()=>{
  const s=span(1);s.attributes.prompt='do not retain';s.attributes['output.value']='raw output';
  const row=buildFactoryProjection(cp(),[s]).telemetry_rows[0];
  assert.equal(Object.hasOwn(row.attributes,'prompt'),false);assert.equal(Object.hasOwn(row.attributes,'output.value'),false);
});

test('cross-project telemetry is rejected instead of leaking into worklog',()=>{
  const s=span(1);s.correlation.project_id='OTHER_PROJECT';
  assert.throws(()=>buildFactoryProjection(cp(),[s]),/TELEMETRY_PROJECT_MISMATCH/);
});

test('projection deletion cannot change canonical recovery decision',()=>{
  const x=cp(),projected=projectWorklog([x],{telemetry:[span(1)]});
  assert.equal(canonicalNextTransition(x,projected).action,'V49_10_DETERMINISTIC_WORKLOG_PROJECTION');
  assert.equal(canonicalNextTransition(x,null).action,'V49_10_DETERMINISTIC_WORKLOG_PROJECTION');
});

test('telemetry projection is hard bounded to 256 rows',()=>{
  const spans=Array.from({length:300},(_,i)=>span(i+1,{attempt_id:`A-${i+1}`}));
  const p=buildFactoryProjection(cp(),spans);assert.equal(p.telemetry_count,256);
});
