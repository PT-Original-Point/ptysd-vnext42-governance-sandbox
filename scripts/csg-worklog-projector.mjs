import {createHash} from 'node:crypto';

export const PROJECTOR_VERSION='csg-worklog-projector.v2-telemetry';
export const FACTORY_PROJECTION_SCHEMA='factory.worklog.projection.v1';
export const TEMPLATE_SOURCE=[
  '# Governance Worklog','Project: {{project_id}}','Source checkpoint: {{checkpoint_seq}}','Recorded at: {{recorded_at}}',
  'Barrier: {{barrier}}','Event: {{event_type}}','Unit: {{unit_id}}','Result: {{result}}','Next: {{next_action}} {{next_unit_id}}'
].join('\n')+'\n';
const WORKLOG_ATTRS=['openinference.span.kind','gen_ai.operation.name','gen_ai.provider.name','gen_ai.request.model','gen_ai.response.model','factory.review.result','factory.verifier.result','factory.provider.effect','factory.repair.count','error.type'];
function sha256(bytes){return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
export function stableJson(v){return stable(v);}
function requireCheckpoint(cp){
  if(!cp||cp.schema_version!=='csg.checkpoint.v1')throw new Error('CHECKPOINT_REQUIRED');
  if(!Number.isSafeInteger(cp.checkpoint_seq)||cp.checkpoint_seq<1)throw new Error('CHECKPOINT_SEQ_INVALID');
  if(typeof cp.payload_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(cp.payload_digest))throw new Error('CHECKPOINT_DIGEST_INVALID');
  if(typeof cp.recorded_at!=='string'||!cp.recorded_at.endsWith('Z'))throw new Error('RECORDED_AT_REQUIRED');
  return cp;
}
function requireSpan(span,projectId){
  if(!span||span.schema!=='factory.telemetry.span.v1'||span.authority!=='OBSERVABILITY_ONLY')throw new Error('TELEMETRY_SPAN_REQUIRED');
  if(span.correlation?.project_id!==projectId)throw new Error('TELEMETRY_PROJECT_MISMATCH');
  if(typeof span.event_id!=='string'||!/^sha256:[0-9a-f]{64}$/.test(span.event_id))throw new Error('TELEMETRY_EVENT_ID_INVALID');
  if(!Number.isSafeInteger(span.sequence)||span.sequence<1)throw new Error('TELEMETRY_SEQUENCE_INVALID');
  return span;
}
function unitId(cp){return cp.event?.subject_id||cp.atomic?.unit_id||cp.atomic?.wp_id||cp.task_id||'UNKNOWN';}
function resultFor(cp){return ({ATOMIC_STARTED:'STARTED',ATOMIC_ACCEPTED:'ACCEPTED',GATE_PASS:'PASS',BLOCKED:'BLOCKED',WAITING_HUMAN:'WAITING_HUMAN',STOP:'STOP',TERMINAL:'TERMINAL'})[cp.event?.type]||String(cp.event?.type||'UNKNOWN');}
export function entryFromCheckpoint(cp){requireCheckpoint(cp);return {seq:cp.checkpoint_seq,unit_id:unitId(cp),event:String(cp.event?.type||'UNKNOWN'),result:resultFor(cp),evidence_refs:structuredClone(cp.evidence_refs||[])};}
export function currentSummary(cp){
  requireCheckpoint(cp);const n=cp.next_legal_transition||{};
  return `project=${cp.project_id}; seq=${cp.checkpoint_seq}; recorded_at=${cp.recorded_at}; barrier=${cp.barrier}; event=${cp.event?.type||'UNKNOWN'}; unit=${unitId(cp)}; next=${n.action||'NONE'}:${n.unit_id??'-'}`;
}
function telemetryKey(s){const c=s.correlation;return [c.run_id,c.root_task_id,c.task_id,c.attempt_epoch,c.attempt_id,s.sequence,s.event_id].join('|');}
function selectedAttributes(attrs={}){
  const out={};for(const k of WORKLOG_ATTRS)if(Object.hasOwn(attrs,k))out[k]=attrs[k];
  for(const [k,v] of Object.entries(attrs))if(k.startsWith('factory.resource.'))out[k]=v;
  return out;
}
export function projectTelemetryRows(spans,projectId,{maxTelemetry=256}={}){
  if(!Array.isArray(spans)||spans.length>4096)throw new Error('TELEMETRY_INPUT_BOUND');
  if(!Number.isSafeInteger(maxTelemetry)||maxTelemetry<1||maxTelemetry>256)throw new Error('TELEMETRY_OUTPUT_BOUND');
  const byId=new Map();for(const raw of spans){const s=requireSpan(raw,projectId);if(!byId.has(s.event_id))byId.set(s.event_id,s);}
  const cmp=(a,b)=>telemetryKey(a)<telemetryKey(b)?-1:telemetryKey(a)>telemetryKey(b)?1:0;
  const rows=[...byId.values()].sort(cmp).slice(-maxTelemetry).map(s=>({
    event_id:s.event_id,run_id:s.correlation.run_id,root_task_id:s.correlation.root_task_id,task_id:s.correlation.task_id,
    attempt_id:s.correlation.attempt_id,attempt_epoch:s.correlation.attempt_epoch,sequence:s.sequence,stage:s.stage,state:s.state,
    attributes:selectedAttributes(s.attributes),artifact_refs:structuredClone(s.artifact_refs||[])
  }));
  return {input_count:spans.length,duplicate_count:spans.length-byId.size,rows};
}
export function buildFactoryProjection(cp,spans=[]){
  requireCheckpoint(cp);const t=projectTelemetryRows(spans,cp.project_id);
  const projection={schema:FACTORY_PROJECTION_SCHEMA,authority:'PROJECTION_ONLY',source_checkpoint_seq:cp.checkpoint_seq,source_checkpoint_digest:cp.payload_digest,telemetry_count:t.rows.length,telemetry_duplicate_count:t.duplicate_count,telemetry_digest:sha256(Buffer.from(stableJson(t.rows),'utf8')),telemetry_rows:t.rows};
  projection.projection_digest=sha256(Buffer.from(stableJson(projection),'utf8'));return projection;
}
export function renderMarkdown(worklog,cp,factoryProjection){
  const n=cp.next_legal_transition||{};const head=TEMPLATE_SOURCE
    .replace('{{project_id}}',cp.project_id).replace('{{checkpoint_seq}}',String(cp.checkpoint_seq)).replace('{{recorded_at}}',cp.recorded_at)
    .replace('{{barrier}}',cp.barrier).replace('{{event_type}}',String(cp.event?.type||'UNKNOWN')).replace('{{unit_id}}',unitId(cp))
    .replace('{{result}}',resultFor(cp)).replace('{{next_action}}',n.action||'NONE').replace('{{next_unit_id}}',n.unit_id??'-');
  const rows=worklog.entries.map(e=>`- ${e.seq} | ${e.unit_id} | ${e.event} | ${e.result}`).join('\n');
  const telemetry=factoryProjection.telemetry_rows.map(e=>`- ${e.run_id}/${e.task_id}/${e.attempt_id}@${e.attempt_epoch} #${e.sequence} | ${e.stage} | ${e.state} | ${e.event_id}`).join('\n');
  return head+'\n## Recent checkpoint events\n'+(rows?rows+'\n':'')+'\n## Bounded telemetry projection\n'+`Digest: ${factoryProjection.telemetry_digest}\n`+(telemetry?telemetry+'\n':'');
}
export function projectWorklog(checkpoints,{maxEntries=256,renderer=renderMarkdown,telemetry=[]}={}){
  if(!Array.isArray(checkpoints)||checkpoints.length<1)throw new Error('CHECKPOINT_HISTORY_REQUIRED');let prev=0;
  for(const cp of checkpoints){requireCheckpoint(cp);if(cp.checkpoint_seq<=prev)throw new Error('CHECKPOINT_HISTORY_NOT_MONOTONIC');prev=cp.checkpoint_seq;}
  const latest=checkpoints.at(-1),entries=checkpoints.slice(-maxEntries).map(entryFromCheckpoint),factory_projection=buildFactoryProjection(latest,telemetry);
  const worklog={schema_version:'csg.worklog.v1',source_checkpoint_seq:latest.checkpoint_seq,source_checkpoint_digest:latest.payload_digest,projector_version:PROJECTOR_VERSION,template_digest:sha256(Buffer.from(TEMPLATE_SOURCE,'utf8')),current_summary:currentSummary(latest),entries,rendered_digest:'',stale:false};
  const markdown=renderer(worklog,latest,factory_projection);if(typeof markdown!=='string')throw new Error('RENDERER_MUST_RETURN_STRING');
  worklog.rendered_digest=sha256(Buffer.from(markdown,'utf8'));
  return {worklog,factory_projection,markdown,worklog_json:stableJson(worklog)+'\n',factory_projection_json:stableJson(factory_projection)+'\n'};
}
export function classifyProjection(worklog,currentCheckpoint){requireCheckpoint(currentCheckpoint);return worklog?.source_checkpoint_seq===currentCheckpoint.checkpoint_seq&&worklog?.source_checkpoint_digest===currentCheckpoint.payload_digest?'CURRENT_PROJECTION':'STALE_PROJECTION_IGNORE';}
export function canonicalNextTransition(checkpoint,_projectionIgnored=null){requireCheckpoint(checkpoint);return structuredClone(checkpoint.next_legal_transition);}
export function *iterCheckpointJsonl(checkpoints){for(const cp of checkpoints){requireCheckpoint(cp);yield stableJson(cp)+'\n';}}
