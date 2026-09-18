import { createHash } from 'node:crypto';

export const STATUS_VIEWS = Object.freeze({ compact:384, standard:2048, debug:4096 });
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATE_RE = /^[A-Z][A-Z0-9_:-]{0,63}$/;
const CODE_RE = /^[A-Z][A-Z0-9_:-]{0,95}$/;

const fail=(code)=>{throw new Error(code);};
const reqInt=(v,min,max,code)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(code);return v;};
const reqText=(v,max,code)=>{if(typeof v!=='string'||!v||Buffer.byteLength(v,'utf8')>max)fail(code);return v;};
const clip=(v,max)=>{if(typeof v!=='string'||!v)return null;let s=v;while(Buffer.byteLength(s,'utf8')>max)s=s.slice(0,Math.max(0,s.length-1));return s;};
const bytes=v=>Buffer.byteLength(JSON.stringify(v),'utf8');
const hash=v=>`sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`;

function artifactRef(ref){
  if(typeof ref==='string') return {ref:reqText(ref,512,'INVALID_ARTIFACT_REF')};
  if(!ref||typeof ref!=='object'||Array.isArray(ref))fail('INVALID_ARTIFACT_REF');
  const out={};
  if(ref.kind!==undefined)out.kind=reqText(ref.kind,64,'INVALID_ARTIFACT_KIND');
  if(ref.path!==undefined)out.path=reqText(ref.path,512,'INVALID_ARTIFACT_PATH');
  if(ref.digest!==undefined){if(typeof ref.digest!=='string'||!DIGEST_RE.test(ref.digest))fail('INVALID_ARTIFACT_DIGEST');out.digest=ref.digest;}
  if(ref.provider!==undefined)out.provider=reqText(ref.provider,64,'INVALID_ARTIFACT_PROVIDER');
  if(ref.revision!==undefined)out.revision=reqText(String(ref.revision),128,'INVALID_ARTIFACT_REVISION');
  if(Object.keys(out).length===0)fail('EMPTY_ARTIFACT_REF');
  return out;
}
function evidenceItem(item,debug){
  if(!item||typeof item!=='object'||Array.isArray(item))fail('INVALID_EVIDENCE_ITEM');
  const out={artifact_ref:artifactRef(item.artifact_ref)};
  if(item.category!==undefined)out.category=reqText(item.category,64,'INVALID_EVIDENCE_CATEGORY');
  if(item.result!==undefined)out.result=reqText(item.result,32,'INVALID_EVIDENCE_RESULT');
  if(debug&&item.summary!==undefined)out.summary=clip(item.summary,160);
  return out;
}
function metadata(input,debug){
  const src=input.metadata??{}; if(!src||typeof src!=='object'||Array.isArray(src))fail('INVALID_METADATA');
  const keys=debug?['project_id','run_id','task_id','attempt_id','attempt_epoch','phase','wait_reason','completion_state','active_lease_count','activity_revision']:['task_id','attempt_id','attempt_epoch','phase','wait_reason','completion_state'];
  const out={};
  for(const k of keys){if(src[k]===undefined||src[k]===null)continue;if(k.endsWith('_epoch')||k.endsWith('_count')||k.endsWith('_revision'))out[k]=reqInt(src[k],0,Number.MAX_SAFE_INTEGER,`INVALID_${k.toUpperCase()}`);else out[k]=reqText(String(src[k]),128,`INVALID_${k.toUpperCase()}`);}
  return out;
}
function baseInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('STATUS_OBJECT_REQUIRED');
  const revision=reqInt(input.revision,0,Number.MAX_SAFE_INTEGER,'INVALID_STATUS_REVISION');
  const state=reqText(input.state,64,'INVALID_STATUS_STATE'); if(!STATE_RE.test(state))fail('INVALID_STATUS_STATE');
  const stop=input.stop_requested===true;
  const approval=input.approval??null; if(approval!==null&&(!approval||typeof approval!=='object'||Array.isArray(approval)))fail('INVALID_APPROVAL');
  const approvalRequired=approval?.required===true;
  const approvalCode=approval?.reason_code===undefined?null:reqText(approval.reason_code,96,'INVALID_APPROVAL_CODE'); if(approvalCode&&!CODE_RE.test(approvalCode))fail('INVALID_APPROVAL_CODE');
  const error=input.error??null; if(error!==null&&(!error||typeof error!=='object'||Array.isArray(error)))fail('INVALID_ERROR');
  const errorCode=error===null?null:reqText(error.code,96,'INVALID_ERROR_CODE'); if(errorCode&&!CODE_RE.test(errorCode))fail('INVALID_ERROR_CODE');
  const unresolved=Array.isArray(input.unresolved_effect_refs)?input.unresolved_effect_refs.map(artifactRef):fail('INVALID_UNRESOLVED_REFS');
  const evidence=Array.isArray(input.evidence)?input.evidence:fail('INVALID_EVIDENCE');
  return {revision,state,stop,approvalRequired,approvalCode,errorCode,unresolved,evidence};
}
function fitList(out,key,hiddenKey,items,budget){
  out[key]=[]; out[hiddenKey]=items.length;
  for(const item of items){out[key].push(item);out[hiddenKey]--;if(bytes(out)>budget){out[key].pop();out[hiddenKey]++;break;}}
  if(out[key].length===0)delete out[key];
}

export function projectStatus(input,{view='compact',since_revision=0}={}){
  if(!Object.hasOwn(STATUS_VIEWS,view))fail('INVALID_STATUS_VIEW');
  reqInt(since_revision,0,Number.MAX_SAFE_INTEGER,'INVALID_SINCE_REVISION');
  const x=baseInput(input), budget=STATUS_VIEWS[view];
  const priority=x.stop||x.approvalRequired||x.errorCode!==null||x.unresolved.length>0;
  if(since_revision>=x.revision&&!priority){
    const out={schema:'v48.status-projection.v1',view:'compact',revision:x.revision,unchanged:true,hidden_evidence_count:x.evidence.length,unresolved_count:0};
    if(bytes(out)>STATUS_VIEWS.compact)fail('PROJECTION_BUDGET_EXCEEDED'); return out;
  }
  const out={schema:'v48.status-projection.v1',view,revision:x.revision,unchanged:false,state:x.state,stop_requested:x.stop,approval_required:x.approvalRequired,error_code:x.errorCode,unresolved_count:x.unresolved.length,hidden_unresolved_count:x.unresolved.length,hidden_evidence_count:x.evidence.length};
  if(x.approvalCode)out.approval_reason_code=x.approvalCode;
  if(view!=='compact')out.metadata=metadata(input,view==='debug');
  fitList(out,'unresolved_refs','hidden_unresolved_count',x.unresolved,budget);
  if(view!=='compact')fitList(out,'evidence','hidden_evidence_count',x.evidence.map(v=>evidenceItem(v,view==='debug')),budget);
  if(bytes(out)>budget)fail('PROJECTION_BUDGET_EXCEEDED');
  out.projection_digest=hash(out);
  if(bytes(out)>budget){delete out.projection_digest;if(bytes(out)>budget)fail('PROJECTION_BUDGET_EXCEEDED');}
  return out;
}

export function projectStatusSafe(input,options={}){
  try{return projectStatus(input,options);}catch(error){
    const view=Object.hasOwn(STATUS_VIEWS,options?.view)?options.view:'compact';
    const out={schema:'v48.status-projection.v1',view,projection_failed:true,error_code:String(error?.message||'PROJECTION_FAILED').slice(0,96)};
    if(bytes(out)>STATUS_VIEWS[view])return {schema:'v48.status-projection.v1',view:'compact',projection_failed:true,error_code:'PROJECTION_FAILED'};
    return out;
  }
}
