import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEMETRY_SCHEMA,TELEMETRY_VERSION,FACTORY_SPAN_NAMES,
  redactTelemetryAttributes,createTelemetrySpan,exportTelemetrySpan,classifyTelemetryBatch,
} from '../telemetry-plane.mjs';

const base=(overrides={})=>({
  project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  run_id:'V49-CLOSURE-001',
  root_task_id:'ROOT-V49-09',
  task_id:'V49-09',
  attempt_id:'V49-V49-09-ATTEMPT-001',
  attempt_epoch:1,
  sequence:1,
  stage:'factory.worker.build',
  state:'PASS',
  started_at:'2026-09-19T03:20:00Z',
  completed_at:'2026-09-19T03:20:01Z',
  artifact_refs:[{kind:'BUNDLE_OBJECT',path:'artifacts/proof.json',digest:'sha256:'+'a'.repeat(64)}],
  ...overrides,
});

test('V49-09 span schema carries exact project/run/root/task/attempt/epoch correlation',()=>{
  const span=createTelemetrySpan(base());
  assert.equal(span.schema,TELEMETRY_SCHEMA);
  assert.equal(span.telemetry_version,TELEMETRY_VERSION);
  assert.equal(span.authority,'OBSERVABILITY_ONLY');
  assert.deepEqual(span.correlation,{
    project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    run_id:'V49-CLOSURE-001',
    root_task_id:'ROOT-V49-09',
    task_id:'V49-09',
    attempt_id:'V49-V49-09-ATTEMPT-001',
    attempt_epoch:1,
  });
  assert.equal(span.attributes['openinference.span.kind'],'AGENT');
  assert.equal(span.attributes['factory.telemetry.sequence'],1);
});

test('OTel GenAI and OpenInference attributes are bounded and omit raw prompt/output payload',()=>{
  const span=createTelemetrySpan(base({
    gen_ai:{operation_name:'invoke_agent',provider_name:'openai',request_model:'gpt-test',usage:{input_tokens:123,output_tokens:45}},
    extra_attributes:{
      'safe.dimension':'builder',
      'prompt':'TOP SECRET PROMPT',
      'output.value':'raw model output',
      'credentials.api_key':'sk-should-not-appear',
    },
  }));
  assert.equal(span.attributes['gen_ai.operation.name'],'invoke_agent');
  assert.equal(span.attributes['gen_ai.provider.name'],'openai');
  assert.equal(span.attributes['gen_ai.request.model'],'gpt-test');
  assert.equal(span.attributes['gen_ai.usage.input_tokens'],123);
  assert.equal(span.attributes['gen_ai.usage.output_tokens'],45);
  assert.equal(span.attributes['safe.dimension'],'builder');
  assert.equal(Object.hasOwn(span.attributes,'prompt'),false);
  assert.equal(Object.hasOwn(span.attributes,'output.value'),false);
  assert.equal(Object.hasOwn(span.attributes,'credentials.api_key'),false);
  assert.deepEqual(span.redacted_keys,['credentials.api_key','output.value','prompt']);
});

test('credential-like values are redacted even under otherwise safe keys',()=>{
  const out=redactTelemetryAttributes({'safe.note':'Bearer abcdefghijklmnopqrstuvwxyz0123456789','safe.count':1});
  assert.deepEqual(out.attributes,{'safe.count':1});
  assert.deepEqual(out.redacted_keys,['safe.note']);
});

test('artifact refs preserve full evidence out of telemetry attributes',()=>{
  const span=createTelemetrySpan(base());
  assert.equal(span.artifact_refs.length,1);
  assert.equal(span.artifact_refs[0].path,'artifacts/proof.json');
  assert.match(span.artifact_refs[0].digest,/^sha256:[0-9a-f]{64}$/);
});

test('F26 sink outage degrades observability and never mutates canonical state',async()=>{
  const span=createTelemetrySpan(base());
  const canonical={checkpoint_seq:58,next:'V49-09',unresolved_effect_refs:[]};
  const before=structuredClone(canonical);
  const missing=await exportTelemetrySpan(span);
  assert.equal(missing.status,'OBSERVABILITY_DEGRADED');
  assert.equal(missing.reason,'SINK_UNAVAILABLE');
  const failed=await exportTelemetrySpan(span,{sink:async()=>{throw new Error('collector down');}});
  assert.equal(failed.status,'OBSERVABILITY_DEGRADED');
  assert.equal(failed.reason,'SINK_ERROR');
  assert.deepEqual(canonical,before);
});

test('successful export returns receipt without conferring authority',async()=>{
  const span=createTelemetrySpan(base());
  let observed;
  const receipt=await exportTelemetrySpan(span,{sink:async value=>{observed=value;return {accepted:true};}});
  assert.equal(receipt.status,'EXPORTED');
  assert.equal(receipt.event_id,span.event_id);
  assert.equal(observed.authority,'OBSERVABILITY_ONLY');
});

test('F27 duplicate and out-of-order spans are bounded observability degradation only',()=>{
  const one=createTelemetrySpan(base({sequence:1}));
  const three=createTelemetrySpan(base({sequence:3,state:'RUNNING'}));
  const two=createTelemetrySpan(base({sequence:2,state:'RUNNING'}));
  const out=classifyTelemetryBatch([one,three,one,two]);
  assert.equal(out.status,'OBSERVABILITY_DEGRADED');
  assert.equal(out.duplicate_count,1);
  assert.equal(out.out_of_order_count,1);
  assert.equal(out.unique_count,3);
  assert.equal(out.canonical_authority_changed,false);
});

test('same exact event produces deterministic event id',()=>{
  assert.equal(createTelemetrySpan(base()).event_id,createTelemetrySpan(base()).event_id);
});

test('invalid correlation and unknown stages fail closed',()=>{
  assert.throws(()=>createTelemetrySpan(base({project_id:'bad project'})),/INVALID_PROJECT_ID/);
  assert.throws(()=>createTelemetrySpan(base({stage:'factory.unknown'})),/UNKNOWN_FACTORY_STAGE/);
});

test('all V4.9 standard factory span names are accepted',()=>{
  for(const [i,stage] of FACTORY_SPAN_NAMES.entries()){
    const span=createTelemetrySpan(base({sequence:i+1,stage}));
    assert.equal(span.stage,stage);
  }
});
