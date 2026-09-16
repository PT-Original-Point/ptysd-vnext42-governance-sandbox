import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWorklog,classifyProjection,canonicalNextTransition,iterCheckpointJsonl,stableJson} from '../../scripts/csg-worklog-projector.mjs';

function cp(seq,{event='ATOMIC_ACCEPTED',barrier='CLEAN',next='BEGIN_NEXT',unit=`CSG-${seq}`,recorded=`2026-09-16T10:${String(seq).padStart(2,'0')}:00Z`}={}){
  return {schema_version:'csg.checkpoint.v1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',checkpoint_seq:seq,transition_id:`T-${seq}`,previous_checkpoint_ref:null,migration_anchor:null,event:{type:event,reason_code:'TEST',subject_id:unit},mission_anchor:{},policy_anchor:{},controller_contract:'C',verifier_digest:'sha256:'+'a'.repeat(64),lifecycle:'ACTIVE',owner:null,run_ref:null,task_id:'W47-06',attempt_id:'A',attempt_epoch:1,atomic:{unit_id:unit},last_accepted:null,remote_wip:null,active_job_refs:[],unresolved_effect_refs:[],blockers:[],last_verified_gate:null,next_legal_transition:{action:next,unit_id:'NEXT',requires:[],forbidden:[]},stop_requested:false,barrier,evidence_refs:[],recorded_at:recorded,payload_digest:'sha256:'+seq.toString(16).padStart(64,'0')};
}

test('delete and rebuild is byte identical',()=>{const h=[cp(1),cp(2)];const a=projectWorklog(h);const b=projectWorklog(structuredClone(h));assert.equal(a.worklog_json,b.worklog_json);assert.equal(a.markdown,b.markdown);});
test('recorded_at is the only displayed time source',()=>{const x=cp(1,{recorded:'2026-09-16T01:02:03Z'});const a=projectWorklog([x]);assert.match(a.markdown,/2026-09-16T01:02:03Z/);assert.doesNotMatch(a.markdown,/2026-09-17/);});
test('fake Done projection cannot change canonical next transition',()=>{const x=cp(1,{next:'BEGIN_CSG_09A'});const fake={current_summary:'DONE',entries:[{result:'DONE'}]};assert.equal(canonicalNextTransition(x,fake).action,'BEGIN_CSG_09A');});
test('renderer failure leaves canonical checkpoint unchanged',()=>{const h=[cp(1)];const before=stableJson(h);assert.throws(()=>projectWorklog(h,{renderer:()=>{throw new Error('TEMPLATE_FAIL')}}),/TEMPLATE_FAIL/);assert.equal(stableJson(h),before);});
test('truncated jsonl is irrelevant to resume decision',()=>{const x=cp(1,{next:'SAFE_NEXT'});const line=[...iterCheckpointJsonl([x])][0];const truncated=line.slice(0,-8);assert.ok(truncated.length<line.length);assert.equal(canonicalNextTransition(x,{jsonl:truncated}).action,'SAFE_NEXT');});
test('100k history keeps latest projection bounded to 256',()=>{const h=[];for(let i=1;i<=100000;i++)h.push(cp(i,{recorded:'2026-09-16T10:00:00Z'}));const p=projectWorklog(h);assert.equal(p.worklog.entries.length,256);assert.equal(p.worklog.entries[0].seq,99745);assert.equal(p.worklog.entries.at(-1).seq,100000);});
test('full jsonl export is on demand and complete',()=>{const h=[cp(1),cp(2),cp(3)];assert.equal([...iterCheckpointJsonl(h)].length,3);});
test('stale projection is ignored',()=>{const a=projectWorklog([cp(1)]).worklog;assert.equal(classifyProjection(a,cp(2)),'STALE_PROJECTION_IGNORE');});
test('current projection matches exact checkpoint digest and seq',()=>{const x=cp(7);const a=projectWorklog([x]).worklog;assert.equal(classifyProjection(a,x),'CURRENT_PROJECTION');});
test('history must be strictly monotonic',()=>{assert.throws(()=>projectWorklog([cp(2),cp(1)]),/NOT_MONOTONIC/);});
test('rendered digest is stable across rebuilds',()=>{const h=[cp(1),cp(2),cp(3)];assert.equal(projectWorklog(h).worklog.rendered_digest,projectWorklog(h).worklog.rendered_digest);});
