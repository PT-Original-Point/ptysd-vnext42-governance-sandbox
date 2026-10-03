import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),ws=path.dirname(root);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(dir,args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const index={schema:'vnext5.2.construction-work-index.v1',observed_at:new Date().toISOString(),role:'SOURCE_CHECKPOINTS_NOT_LIVE_ACCEPTANCE',entries:[]};
const definitions=[
 ['S-MCP','VNEXT5.2-M01-FINAL-CP200-WORK','CHATGPT_GLOBAL_SKILL_GOVERNANCE',[]],
 ['S-RECOVERY','VNEXT5.2-D02-RUNTIME-WORK','CHATGPT_GLOBAL_SKILL_GOVERNANCE',null],
 ['S-ADS','VNEXT5.2-A00-HANYAO-WORK','HANYAO_ADS_LINE_PROD',[
  'scripts/ads-line-production-reconciliation.mjs','scripts/ads-line-production-reconciliation.test.mjs',
  'scripts/google-ads-provider-auth.ts','scripts/google-ads-provider-auth.test.ts',
  'scripts/google-ads-read-scope.ts','scripts/google-ads-read-scope.test.ts']]
];
for(const [id,folder,project_id,paths] of definitions){
 const dir=path.join(ws,folder), head=git(dir,['rev-parse','HEAD']),files=paths===null ?
  git(dir,['ls-files','--','tools/csg/v51-supervisor/']).split('\n').filter(Boolean):paths;
 const e={slice_id:id,project_id,local_worktree:folder,head,staged_tree:git(dir,['write-tree']),
  changed_paths:git(dir,['status','--porcelain','--untracked-files=all','--',...(id==='S-RECOVERY'?['tools/csg/v51-supervisor/']:id==='S-MCP'?['tools/csg/factory-mcp/']:paths)]).split('\n').filter(Boolean),
  state:id==='S-MCP'?'SOURCE_PROVIDER_CANDIDATE':'LOCAL_SOURCE_CANDIDATE_NOT_INSTALLED',
  live:'NOT_ACCEPTED_BY_THIS_CAPTURE',inputs:[]};
 for(const p of files){
  const b=fs.readFileSync(path.join(dir,p));
  if(/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30}|github_pat_[A-Za-z0-9_]{20}/.test(b.toString()))throw Error('POSSIBLE_SECRET:'+p);
  const out='inputs/'+id+'/'+p,full=path.join(root,out);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,b);
  e.inputs.push({source_path:p,artifact_path:out,sha256:sha(b),bytes:b.length,role:'INTENDED_SOURCE_BYTES_NOT_EXECUTION'});
 }
 if(id==='S-MCP')e.provider_source={repository:'PT-Original-Point/ptysd-vnext42-governance-sandbox',pr:381,exact_head:head,path_prefix:'tools/csg/factory-mcp/'};
 if(git(dir,['rev-parse','HEAD'])!==head || git(dir,['write-tree'])!==e.staged_tree ||
    e.inputs.some(f=>sha(fs.readFileSync(path.join(dir,f.source_path)))!==f.sha256))throw Error('SOURCE_CHANGED_DURING_CAPTURE:'+id);
 index.entries.push(e);
}
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
fs.writeFileSync(path.join(root,'evidence/local-work-index.json'),JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify(index.entries.map(e=>({slice:e.slice_id,head:e.head,source_files:e.inputs.length,changed:e.changed_paths.length}))));

