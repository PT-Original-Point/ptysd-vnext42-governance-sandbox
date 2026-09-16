import {createHash} from 'node:crypto';

export const PROJECTOR_VERSION='csg-worklog-projector.v1';
export const TEMPLATE_SOURCE=[
  '# Governance Worklog',
  'Project: {{project_id}}',
  'Source checkpoint: {{checkpoint_seq}}',
  'Recorded at: {{recorded_at}}',
  'Barrier: {{barrier}}',
  'Event: {{event_type}}',
  'Unit: {{unit_id}}',
  'Result: {{result}}',
  'Next: {{next_action}} {{next_unit_id}}'
].join('\n')+'\n';

function sha256(bytes){return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;}
function stable(v){
  if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
export function stableJson(v){return stable(v);}
function requireCheckpoint(cp){
  if(!cp||cp.schema_version!=='csg.checkpoint.v1') throw new Error('CHECKPOINT_REQUIRED');
  if(!Number.isSafeInteger(cp.checkpoint_seq)||cp.checkpoint_seq<1) throw new Error('CHECKPOINT_SEQ_INVALID');
  if(typeof cp.payload_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(cp.payload_digest)) throw new Error('CHECKPOINT_DIGEST_INVALID');
  if(typeof cp.recorded_at!=='string'||!cp.recorded_at.endsWith('Z')) throw new Error('RECORDED_AT_REQUIRED');
  return cp;
}
function unitId(cp){return cp.event?.subject_id||cp.atomic?.unit_id||cp.atomic?.wp_id||cp.task_id||'UNKNOWN';}
function resultFor(cp){
  const m={ATOMIC_STARTED:'STARTED',ATOMIC_ACCEPTED:'ACCEPTED',GATE_PASS:'PASS',BLOCKED:'BLOCKED',WAITING_HUMAN:'WAITING_HUMAN',STOP:'STOP',TERMINAL:'TERMINAL'};
  return m[cp.event?.type]||String(cp.event?.type||'UNKNOWN');
}
export function entryFromCheckpoint(cp){
  requireCheckpoint(cp);
  return {seq:cp.checkpoint_seq,unit_id:unitId(cp),event:String(cp.event?.type||'UNKNOWN'),result:resultFor(cp),evidence_refs:structuredClone(cp.evidence_refs||[])};
}
export function currentSummary(cp){
  requireCheckpoint(cp);
  const n=cp.next_legal_transition||{};
  return `project=${cp.project_id}; seq=${cp.checkpoint_seq}; recorded_at=${cp.recorded_at}; barrier=${cp.barrier}; event=${cp.event?.type||'UNKNOWN'}; unit=${unitId(cp)}; next=${n.action||'NONE'}:${n.unit_id??'-'}`;
}
export function renderMarkdown(worklog,cp){
  const n=cp.next_legal_transition||{};
  const head=TEMPLATE_SOURCE
    .replace('{{project_id}}',cp.project_id)
    .replace('{{checkpoint_seq}}',String(cp.checkpoint_seq))
    .replace('{{recorded_at}}',cp.recorded_at)
    .replace('{{barrier}}',cp.barrier)
    .replace('{{event_type}}',String(cp.event?.type||'UNKNOWN'))
    .replace('{{unit_id}}',unitId(cp))
    .replace('{{result}}',resultFor(cp))
    .replace('{{next_action}}',n.action||'NONE')
    .replace('{{next_unit_id}}',n.unit_id??'-');
  const rows=worklog.entries.map(e=>`- ${e.seq} | ${e.unit_id} | ${e.event} | ${e.result}`).join('\n');
  return head+'\n## Recent checkpoint events\n'+(rows?rows+'\n':'') ;
}
export function projectWorklog(checkpoints,{maxEntries=256,renderer=renderMarkdown}={}){
  if(!Array.isArray(checkpoints)||checkpoints.length<1) throw new Error('CHECKPOINT_HISTORY_REQUIRED');
  let prev=0;
  for(const cp of checkpoints){requireCheckpoint(cp); if(cp.checkpoint_seq<=prev) throw new Error('CHECKPOINT_HISTORY_NOT_MONOTONIC'); prev=cp.checkpoint_seq;}
  const latest=checkpoints.at(-1);
  const entries=checkpoints.slice(-maxEntries).map(entryFromCheckpoint);
  const worklog={schema_version:'csg.worklog.v1',source_checkpoint_seq:latest.checkpoint_seq,source_checkpoint_digest:latest.payload_digest,projector_version:PROJECTOR_VERSION,template_digest:sha256(Buffer.from(TEMPLATE_SOURCE,'utf8')),current_summary:currentSummary(latest),entries,rendered_digest:'',stale:false};
  const markdown=renderer(worklog,latest);
  if(typeof markdown!=='string') throw new Error('RENDERER_MUST_RETURN_STRING');
  worklog.rendered_digest=sha256(Buffer.from(markdown,'utf8'));
  return {worklog,markdown,worklog_json:stableJson(worklog)+'\n'};
}
export function classifyProjection(worklog,currentCheckpoint){
  requireCheckpoint(currentCheckpoint);
  return worklog?.source_checkpoint_seq===currentCheckpoint.checkpoint_seq&&worklog?.source_checkpoint_digest===currentCheckpoint.payload_digest?'CURRENT_PROJECTION':'STALE_PROJECTION_IGNORE';
}
export function canonicalNextTransition(checkpoint,_projectionIgnored=null){requireCheckpoint(checkpoint);return structuredClone(checkpoint.next_legal_transition);}
export function *iterCheckpointJsonl(checkpoints){for(const cp of checkpoints){requireCheckpoint(cp);yield stableJson(cp)+'\n';}}
