import {createHash} from 'node:crypto';

export const TELEMETRY_SCHEMA='factory.telemetry.span.v1';
export const TELEMETRY_VERSION='v49-otel-openinference.v1';
export const OTEL_GENAI_REFERENCE={
  repository:'open-telemetry/semantic-conventions-genai',
  commit:'c88d504ab3d9879f8e50d3cc87e69775e11db234',
};
export const OPENINFERENCE_REFERENCE={
  repository:'Arize-ai/openinference',
  commit:'a719562e20437d433a2e4cfb599256e22ec04531',
};

export const FACTORY_SPAN_NAMES=Object.freeze([
  'factory.intent',
  'factory.research',
  'factory.decision',
  'factory.spec',
  'factory.task.compile',
  'factory.worker.build',
  'factory.review',
  'factory.repair',
  'factory.integrate',
  'factory.verify',
  'factory.provider.effect',
  'factory.delivery',
  'factory.notify',
  'factory.recovery',
  'factory.rsi.evaluate',
]);

const SPAN_KIND_BY_STAGE=Object.freeze({
  'factory.worker.build':'AGENT',
  'factory.repair':'AGENT',
  'factory.review':'EVALUATOR',
  'factory.verify':'EVALUATOR',
  'factory.rsi.evaluate':'EVALUATOR',
  'factory.provider.effect':'TOOL',
  'factory.notify':'TOOL',
});
const OPENINFERENCE_KINDS=new Set(['LLM','AGENT','CHAIN','TOOL','RETRIEVER','RERANKER','EMBEDDING','GUARDRAIL','EVALUATOR','PROMPT']);
const GENAI_OPERATIONS=new Set(['chat','generate_content','text_completion','invoke_agent','invoke_workflow','plan','execute_tool','retrieval','embeddings','create_agent']);
const SAFE_USAGE_FIELDS=new Set(['input_tokens','output_tokens','cached_input_tokens','reasoning_tokens']);
const RESOURCE_FIELDS=new Set(['latency_ms','cpu_ms','memory_mib','disk_mib','api_calls','queue_wait_ms','wall_time_ms']);
const SENSITIVE_KEY=/(^|[._-])(secret|credential|password|authorization|cookie|bearer|api[_-]?key|access[_-]?token|refresh[_-]?token|prompt|completion|messages?|raw|diff|patch|stdout|stderr|request[_-]?body|response[_-]?body|input[._-]?value|output[._-]?value|tool[_-]?arguments?)([._-]|$)/i;
const SENSITIVE_VALUE=/(BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{16,})/i;
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_RE=/^sha256:[0-9a-f]{64}$/;
const COMMIT_RE=/^[0-9a-f]{40,64}$/;

function fail(code){const e=new Error(code);e.code=code;throw e;}
function reqId(value,name){
  if(typeof value!=='string'||!ID_RE.test(value)) fail(`INVALID_${name}`);
  return value;
}
function reqEpoch(value){
  if(!Number.isSafeInteger(value)||value<0) fail('INVALID_ATTEMPT_EPOCH');
  return value;
}
function reqSequence(value){
  if(!Number.isSafeInteger(value)||value<1) fail('INVALID_TELEMETRY_SEQUENCE');
  return value;
}
function reqIso(value,name){
  if(value===undefined||value===null) return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) fail(`INVALID_${name}`);
  return value;
}
function boundedString(value,name,max=512){
  if(value===undefined||value===null) return null;
  if(typeof value!=='string'||value.length<1||value.length>max) fail(`INVALID_${name}`);
  return value;
}
function stable(v){
  if(Array.isArray(v)) return v.map(stable);
  if(v&&typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
  return v;
}
function digest(v){return `sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`; }
function clone(v){return v===undefined?undefined:structuredClone(v);}
function safeScalar(v){return typeof v==='string'||typeof v==='number'||typeof v==='boolean';}

export function redactTelemetryAttributes(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)) fail('TELEMETRY_ATTRIBUTES_OBJECT_REQUIRED');
  const attributes={};
  const redacted_keys=[];
  for(const [key,value] of Object.entries(input)){
    if(typeof key!=='string'||key.length<1||key.length>160) fail('INVALID_TELEMETRY_ATTRIBUTE_KEY');
    if(SENSITIVE_KEY.test(key)){
      redacted_keys.push(key);
      continue;
    }
    if(!safeScalar(value)) fail(`TELEMETRY_ATTRIBUTE_SCALAR_REQUIRED:${key}`);
    if(typeof value==='string'){
      if(value.length>512) fail(`TELEMETRY_ATTRIBUTE_TOO_LARGE:${key}`);
      if(SENSITIVE_VALUE.test(value)){
        redacted_keys.push(key);
        continue;
      }
    }
    if(typeof value==='number'&&!Number.isFinite(value)) fail(`TELEMETRY_ATTRIBUTE_NONFINITE:${key}`);
    attributes[key]=value;
  }
  return {attributes,redacted_keys:redacted_keys.sort()};
}

function validateArtifactRefs(refs){
  if(refs===undefined||refs===null) return [];
  if(!Array.isArray(refs)||refs.length>32) fail('INVALID_ARTIFACT_REFS');
  return refs.map((ref,index)=>{
    if(!ref||typeof ref!=='object'||Array.isArray(ref)) fail(`INVALID_ARTIFACT_REF:${index}`);
    const allowed=new Set(['kind','path','digest','revision']);
    for(const key of Object.keys(ref)) if(!allowed.has(key)) fail(`INVALID_ARTIFACT_REF_FIELD:${key}`);
    const kind=boundedString(ref.kind,'ARTIFACT_KIND',64);
    const path=boundedString(ref.path,'ARTIFACT_PATH',512);
    const digestValue=boundedString(ref.digest,'ARTIFACT_DIGEST',71);
    if(!DIGEST_RE.test(digestValue)) fail('INVALID_ARTIFACT_DIGEST');
    const revision=ref.revision===undefined?null:boundedString(ref.revision,'ARTIFACT_REVISION',128);
    return revision?{kind,path,digest:digestValue,revision}:{kind,path,digest:digestValue};
  });
}

function addGenAiAttributes(attributes,gen_ai){
  if(gen_ai===undefined||gen_ai===null) return;
  if(!gen_ai||typeof gen_ai!=='object'||Array.isArray(gen_ai)) fail('GEN_AI_OBJECT_REQUIRED');
  const allowed=new Set(['operation_name','provider_name','request_model','response_model','usage']);
  for(const key of Object.keys(gen_ai)) if(!allowed.has(key)) fail(`INVALID_GEN_AI_FIELD:${key}`);
  if(gen_ai.operation_name!==undefined){
    if(!GENAI_OPERATIONS.has(gen_ai.operation_name)) fail('INVALID_GEN_AI_OPERATION');
    attributes['gen_ai.operation.name']=gen_ai.operation_name;
  }
  for(const [source,target] of [['provider_name','gen_ai.provider.name'],['request_model','gen_ai.request.model'],['response_model','gen_ai.response.model']]){
    if(gen_ai[source]!==undefined) attributes[target]=boundedString(gen_ai[source],source.toUpperCase(),256);
  }
  if(gen_ai.usage!==undefined){
    if(!gen_ai.usage||typeof gen_ai.usage!=='object'||Array.isArray(gen_ai.usage)) fail('GEN_AI_USAGE_OBJECT_REQUIRED');
    for(const [key,value] of Object.entries(gen_ai.usage)){
      if(!SAFE_USAGE_FIELDS.has(key)) fail(`INVALID_GEN_AI_USAGE_FIELD:${key}`);
      if(!Number.isSafeInteger(value)||value<0) fail(`INVALID_GEN_AI_USAGE_VALUE:${key}`);
      attributes[`gen_ai.usage.${key}`]=value;
    }
  }
}

function addResourceAttributes(attributes,resources){
  if(resources===undefined||resources===null) return;
  if(!resources||typeof resources!=='object'||Array.isArray(resources)) fail('RESOURCE_METRICS_OBJECT_REQUIRED');
  for(const [key,value] of Object.entries(resources)){
    if(!RESOURCE_FIELDS.has(key)) fail(`INVALID_RESOURCE_METRIC:${key}`);
    if(typeof value!=='number'||!Number.isFinite(value)||value<0) fail(`INVALID_RESOURCE_METRIC_VALUE:${key}`);
    attributes[`factory.resource.${key}`]=value;
  }
}

export function createTelemetrySpan(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) fail('TELEMETRY_INPUT_REQUIRED');
  const stage=boundedString(input.stage,'STAGE',64);
  if(!FACTORY_SPAN_NAMES.includes(stage)) fail('UNKNOWN_FACTORY_STAGE');
  const correlation={
    project_id:reqId(input.project_id,'PROJECT_ID'),
    run_id:reqId(input.run_id,'RUN_ID'),
    root_task_id:reqId(input.root_task_id,'ROOT_TASK_ID'),
    task_id:reqId(input.task_id,'TASK_ID'),
    attempt_id:reqId(input.attempt_id,'ATTEMPT_ID'),
    attempt_epoch:reqEpoch(input.attempt_epoch),
  };
  const sequence=reqSequence(input.sequence);
  const state=boundedString(input.state,'STATE',64);
  const started_at=reqIso(input.started_at,'STARTED_AT');
  const completed_at=reqIso(input.completed_at,'COMPLETED_AT');
  if(completed_at&&!started_at) fail('COMPLETED_AT_REQUIRES_STARTED_AT');
  const kind=input.openinference_span_kind??SPAN_KIND_BY_STAGE[stage]??'CHAIN';
  if(!OPENINFERENCE_KINDS.has(kind)) fail('INVALID_OPENINFERENCE_SPAN_KIND');
  const attributes={
    'factory.project.id':correlation.project_id,
    'factory.run.id':correlation.run_id,
    'factory.root_task.id':correlation.root_task_id,
    'factory.task.id':correlation.task_id,
    'factory.attempt.id':correlation.attempt_id,
    'factory.attempt.epoch':correlation.attempt_epoch,
    'factory.telemetry.sequence':sequence,
    'factory.stage':stage,
    'factory.state':state,
    'openinference.span.kind':kind,
  };
  addGenAiAttributes(attributes,input.gen_ai);
  addResourceAttributes(attributes,input.resources);
  if(input.candidate_commit!==undefined){
    const v=boundedString(input.candidate_commit,'CANDIDATE_COMMIT',64);
    if(!COMMIT_RE.test(v)) fail('INVALID_CANDIDATE_COMMIT');
    attributes['factory.candidate.commit']=v;
  }
  if(input.candidate_tree!==undefined){
    const v=boundedString(input.candidate_tree,'CANDIDATE_TREE',64);
    if(!COMMIT_RE.test(v)) fail('INVALID_CANDIDATE_TREE');
    attributes['factory.candidate.tree']=v;
  }
  for(const [source,target] of [
    ['review_result','factory.review.result'],
    ['verifier_result','factory.verifier.result'],
    ['provider_effect','factory.provider.effect'],
    ['error_class','error.type'],
  ]){
    if(input[source]!==undefined) attributes[target]=boundedString(input[source],source.toUpperCase(),128);
  }
  if(input.repair_count!==undefined){
    if(!Number.isSafeInteger(input.repair_count)||input.repair_count<0||input.repair_count>100) fail('INVALID_REPAIR_COUNT');
    attributes['factory.repair.count']=input.repair_count;
  }
  const extra=redactTelemetryAttributes(input.extra_attributes??{});
  Object.assign(attributes,extra.attributes);
  const artifact_refs=validateArtifactRefs(input.artifact_refs);
  const eventBasis={
    schema:TELEMETRY_SCHEMA,
    telemetry_version:TELEMETRY_VERSION,
    correlation,
    sequence,
    stage,
    state,
    started_at,
    completed_at,
    attributes,
    artifact_refs,
  };
  return {
    ...eventBasis,
    event_id:digest(eventBasis),
    redacted_keys:extra.redacted_keys,
    authority:'OBSERVABILITY_ONLY',
  };
}

export async function exportTelemetrySpan(span,{sink}={}){
  if(!span||span.schema!==TELEMETRY_SCHEMA||span.authority!=='OBSERVABILITY_ONLY') fail('VALID_TELEMETRY_SPAN_REQUIRED');
  if(typeof sink!=='function') return {status:'OBSERVABILITY_DEGRADED',reason:'SINK_UNAVAILABLE',event_id:span.event_id};
  try{
    const result=await sink(clone(span));
    return {status:'EXPORTED',event_id:span.event_id,sink_result:result===undefined?null:clone(result)};
  }catch(error){
    return {status:'OBSERVABILITY_DEGRADED',reason:'SINK_ERROR',error_class:error?.name||'Error',event_id:span.event_id};
  }
}

export function classifyTelemetryBatch(spans){
  if(!Array.isArray(spans)) fail('TELEMETRY_BATCH_REQUIRED');
  const seen=new Set();
  const lastByAttempt=new Map();
  let duplicates=0,out_of_order=0;
  const accepted=[];
  for(const span of spans){
    if(!span||span.schema!==TELEMETRY_SCHEMA||span.authority!=='OBSERVABILITY_ONLY') fail('VALID_TELEMETRY_SPAN_REQUIRED');
    if(seen.has(span.event_id)){duplicates++;continue;}
    seen.add(span.event_id);
    const c=span.correlation;
    const key=`${c.project_id}|${c.run_id}|${c.root_task_id}|${c.task_id}|${c.attempt_id}|${c.attempt_epoch}`;
    const prior=lastByAttempt.get(key);
    if(prior!==undefined&&span.sequence<prior) out_of_order++;
    lastByAttempt.set(key,Math.max(prior??0,span.sequence));
    accepted.push(span);
  }
  return {
    status:(duplicates||out_of_order)?'OBSERVABILITY_DEGRADED':'OK',
    input_count:spans.length,
    unique_count:accepted.length,
    duplicate_count:duplicates,
    out_of_order_count:out_of_order,
    spans:accepted,
    canonical_authority_changed:false,
  };
}
