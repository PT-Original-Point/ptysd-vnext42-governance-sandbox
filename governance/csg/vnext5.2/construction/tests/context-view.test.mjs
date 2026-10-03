import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {oid, safePath, readSharedContext, canonicalJson, checkpointDigest} from '../scripts/csg-read-shared-context.mjs';
const a='a'.repeat(40), b='b'.repeat(40), c='c'.repeat(40);
const gov='PT-Original-Point/ptysd-vnext42-governance-sandbox';
const ids=['CHATGPT_GLOBAL_SKILL_GOVERNANCE','HANYAO_ADS_LINE_PROD'];
const branch='codex/vnext5.2-shared-construction-20261003-r2';
function fixture(change=()=>{}) {
  const data = new Map(); const put=(r,v)=>data.set(r,v);
  const f=(repo,path,sha,value)=>put(repo+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+sha,
    {encoding:'base64', sha:c, content:Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64')});
  put(gov+'/git/ref/heads/'+encodeURIComponent(branch),{object:{sha:a}});
  put(gov+'/git/ref/heads/'+encodeURIComponent('governance/project-directory'),{object:{sha:b}});
  f(gov,'governance/csg/vnext5.2/construction/CURRENT.json',a,
    {schema:'vnext5.2.shared-construction-context.v1',project_id:ids[0],canonical_selection_changed:false,
     architecture_path:'01.md', construction_work_index:'work.json',human_requested_spec:'VNEXT5.2',architecture_revision:'R1'});
  f(gov,'governance/csg/vnext5.2/construction/01.md',a,'architecture');
  f(gov,'governance/csg/vnext5.2/construction/work.json',a,
    {schema:'vnext5.2.construction-work-index.v1',entries:[{slice_id:'S-MCP',project_id:ids[0],head:a,staged_tree:b,inputs:[]}]});
  f(gov,'directory/descriptor.json',b,{write_policy:'SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE'});
  ids.forEach((id,i)=>{
    const repo=i?'t14210184/hanyao':gov, rid=i?'1272482826':'1352411536', ref=i?'governance/hanyao-control':'v45/factory-control';
    put(repo+'/git/ref/heads/'+encodeURIComponent(ref),{object:{sha:c}});
    f(gov,'directory/projects/'+id+'.json',b,{project_id:id,binding_id:id,binding_generation:1,control_locator:{repository_id:rid,ref:'refs/heads/'+ref,current_path:'current.json'}});
    const cp={project_id:id,checkpoint_seq:i?2:200,lifecycle:'ACTIVE',
      owner:null,unresolved_effect_refs:[],mission_anchor:{ref:'github://'+rid+'/mission.json@'+a},
      policy_anchor:{ref:'github://'+rid+'/policy.json@'+a}};
    cp.payload_digest='sha256:'+createHash('sha256').update(canonicalJson(cp)).digest('hex');
    f(repo,'current.json',c,{project_id:id,binding_id:id,binding_generation:1,checkpoint_path:'checkpoint.json',checkpoint_seq:i?2:200,checkpoint_digest:cp.payload_digest});
    f(repo,'checkpoint.json',c,cp);
    f(repo,'mission.json',a,{project_id:id,payload:{current_construction_spec:{id:i?'HANYAO':'VNEXT5.1-R2'}}});
    f(repo,'policy.json',a,{project_id:id});
  });
  change(data);
  return async route=>{ assert(data.has(route),'unrecognized fixed GET: '+route); return data.get(route); };
}
test('exact lowercase OID accepts valid bytes',()=>assert.equal(oid(a),a));
test('malformed OID is never trimmed or normalized',()=>{
 for(const v of [a.toUpperCase(),' '+a,a+'\n','a'.repeat(39),null]) assert.throws(()=>oid(v),/MALFORMED_OID/);
});
test('paths reject traversal and Windows escaping',()=>{
 for(const v of ['../x','a/../x','a\\x','/a','a//x','a/./x']) assert.throws(()=>safePath(v),/INVALID_PATH/);
});
test('reader separates Human V5.2 from canonical V5.1-R2 with no dispatch',async()=>{
 const r=await readSharedContext(fixture());
 assert.equal(r.human_requested_spec,'VNEXT5.2');
 assert.equal(r.projects[0].canonical_control_spec,'VNEXT5.1-R2');
 assert.equal(r.projects[1].checkpoint,2);
 for(const k of ['dispatch','host_mutation','canonical_write','provider_write']) assert.equal(r[k],false);
 assert.equal(r.installed_runtime,'NOT_OBSERVED');
 assert.equal(r.construction_work.status,'READBACK_OK');
});
test('same-source declared checkpoint digest mismatch rejects',async()=>{
 const get=fixture(d=>{for(const [k,v] of d) if(k.includes('/contents/checkpoint.json')) {
   const cp=JSON.parse(Buffer.from(v.content,'base64'));cp.payload_digest='different';
   v.content=Buffer.from(JSON.stringify(cp)).toString('base64'); }});
 const r=await readSharedContext(get);
 assert(r.projects.every(p=>p.status==='SCOPED_CONTROL_READ_UNAVAILABLE' && p.reason==='CHECKPOINT_PAYLOAD_DIGEST_INVALID'));
});
test('shared document cannot claim canonical selection',async()=>{
 const get=fixture(d=>{for(const [k,v] of d) if(k.includes('/CURRENT.json')) {
   const cur=JSON.parse(Buffer.from(v.content,'base64'));cur.canonical_selection_changed=true;
   v.content=Buffer.from(JSON.stringify(cur)).toString('base64'); }});
 await assert.rejects(readSharedContext(get),/INVALID_SHARED_ROLE/);
});
test('moving shared ref is rejected',async()=>{
 const get=fixture();let count=0;
 await assert.rejects(readSharedContext(async r=>r.endsWith('/'+encodeURIComponent(branch)) && ++count>1 ?
   {object:{sha:b}} : get(r)),/SHARED_OR_DIRECTORY_CHANGED_DURING_READ/);
});
test('one project route failure preserves the other project readback',async()=>{
 const get=fixture();
 const r=await readSharedContext(route=>route.startsWith('t14210184/hanyao/') ?
   Promise.reject(Error('GITHUB_READ_403')) : get(route));
 assert.equal(r.projects[0].status,'READBACK_OK');
 assert.equal(r.projects[1].status,'SCOPED_CONTROL_READ_UNAVAILABLE');
 assert.equal(r.projects[1].authority_granted,false);
 assert.equal(r.dispatch,false);
});
test('observed legacy HANYAO CP2 hashes exact provider bytes, no newline trimming',()=>{
 const cp=JSON.parse(fs.readFileSync(new URL('../evidence/hanyao-cp2-observed.json',import.meta.url),'utf8'));
 const raw=JSON.stringify(cp), expected='sha256:d13fad83e8b6b610f4976efefe6d6e34eb1f18185c410a497b47c6f52ed46572';
 assert.equal(checkpointDigest(cp,raw,ids[1],'governance/hanyao/checkpoints/000002.json').digest,expected);
 assert.notEqual(checkpointDigest(cp,raw+'\n',ids[1],'governance/hanyao/checkpoints/000002.json').digest,expected);
});
test('missing self-digest on arbitrary checkpoint is unsupported',()=>{
 assert.throws(()=>checkpointDigest({checkpoint_seq:200},'{}',ids[0],'checkpoint.json'),/UNSUPPORTED/);
});

