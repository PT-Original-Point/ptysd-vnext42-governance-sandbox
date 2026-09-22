import {createHash} from 'node:crypto';

const DIGEST_RE=/^sha256:[0-9a-f]{64}$/;
const GIT_RE=/^[0-9a-f]{40,64}$/;
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WIN_RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const CONTRACT_SCHEMA='v48.w47-06.execution-input.v1';
const CAPABILITY_SCHEMA='v48.cell-capability.v1';
const AUTHORIZATION_SCHEMA_RANK=new Map([['v49.authorization-envelope.v1',1],['v49.authorization-envelope.v2',2]]);

const fail=(code,detail='')=>{throw new Error(detail?`${code}:${detail}`:code);};
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const digest=v=>`sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const reqId=(v,n)=>{if(typeof v!=='string'||!ID_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqDigest=(v,n)=>{if(typeof v!=='string'||!DIGEST_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqGit=(v,n)=>{if(typeof v!=='string'||!GIT_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqInt=(v,min,max,n)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(`INVALID_${n}`);return v;};

function pathKey(raw){
  if(typeof raw!=='string'||!raw||raw!==raw.normalize('NFC'))fail('INVALID_PATH_UNICODE');
  if(raw.includes('\\')||raw.startsWith('/')||/^[A-Za-z]:/.test(raw)||raw.startsWith('//'))fail('PATH_ESCAPE');
  const parts=raw.split('/'); if(parts.some(p=>!p||p==='.'||p==='..'))fail('PATH_ESCAPE');
  for(const p of parts)if(/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||WIN_RESERVED.test(p))fail('WINDOWS_PATH_COLLISION');
  return parts.join('/').toLocaleLowerCase('en-US');
}
function canonicalPaths(values,name){
  if(!Array.isArray(values))fail(`INVALID_${name}`); const seen=new Map();
  for(const raw of values){const key=pathKey(raw);if(seen.has(key))fail(`PATH_ALIAS:${raw}`);seen.set(key,raw.normalize('NFC'));}
  return [...seen.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v);
}
function isWithin(path,root){const p=pathKey(path),r=pathKey(root);return p===r||p.startsWith(`${r}/`);}
function shrinkPaths(requested,allowed,name){
  const a=canonicalPaths(allowed,`${name}_ALLOWED`), r=requested===undefined?a:canonicalPaths(requested,name);
  for(const p of r)if(!a.some(root=>isWithin(p,root)))fail(`SCOPE_WIDEN_${name}:${p}`); return r;
}
function contractDigest(contract){const x=structuredClone(contract);delete x.contract_digest;return digest(x);}
function bind(actual,expected,code){if(actual!==expected)fail(code);}
function networkRank(v){return v==='DENY'?0:v==='LIMITED'?1:-1;}
function shrinkResources(requested,limit){
  const r=requested??limit, out={};
  for(const k of ['cpu_millis','memory_mib','pids','disk_mib','provider_calls']){
    reqInt(limit[k],0,Number.MAX_SAFE_INTEGER,`LIMIT_${k.toUpperCase()}`); reqInt(r[k],0,Number.MAX_SAFE_INTEGER,k.toUpperCase());
    if(r[k]>limit[k])fail(`RESOURCE_WIDEN:${k}`); out[k]=r[k];
  }
  if(networkRank(limit.network_mode)<0||networkRank(r.network_mode)<0)fail('INVALID_NETWORK_MODE');
  if(networkRank(r.network_mode)>networkRank(limit.network_mode))fail('RESOURCE_WIDEN:network_mode'); out.network_mode=r.network_mode;
  return out;
}
function shrinkAuthorizationSchema(requested,allowed='v49.authorization-envelope.v1'){
  const allowedRank=AUTHORIZATION_SCHEMA_RANK.get(allowed), requestedSchema=requested??allowed, requestedRank=AUTHORIZATION_SCHEMA_RANK.get(requestedSchema);
  if(!allowedRank||!requestedRank)fail('INVALID_AUTHORIZATION_MIN_SCHEMA');
  if(requestedRank<allowedRank)fail('AUTHORIZATION_SCHEMA_DOWNGRADE');
  return requestedSchema;
}
function shrinkData(requested,allowed){
  if(!Array.isArray(allowed)||!allowed.length)fail('INVALID_DATA_CLASS'); const a=new Set(allowed);
  const r=requested??allowed; if(!Array.isArray(r)||!r.length)fail('INVALID_DATA_CLASS');
  for(const v of r)if(!a.has(v))fail(`DATA_SCOPE_WIDEN:${v}`); return [...new Set(r)].sort();
}

export function compileCellCapability(taskContract,currentFence){
  if(!taskContract||taskContract.schema_version!==CONTRACT_SCHEMA)fail('TASK_CONTRACT_SCHEMA_MISMATCH');
  if(!currentFence||typeof currentFence!=='object'||Array.isArray(currentFence))fail('CURRENT_FENCE_REQUIRED');
  reqId(taskContract.project_id,'PROJECT_ID');reqId(taskContract.run_id,'RUN_ID');reqId(taskContract.root_task_id,'ROOT_TASK_ID');reqId(taskContract.task_id,'TASK_ID');reqId(taskContract.attempt_id,'ATTEMPT_ID');reqInt(taskContract.attempt_epoch,1,2147483647,'ATTEMPT_EPOCH');
  reqDigest(taskContract.spec_digest,'SPEC_DIGEST');reqDigest(taskContract.contract_digest,'CONTRACT_DIGEST');reqGit(taskContract.base_commit,'BASE_COMMIT');reqGit(taskContract.base_tree,'BASE_TREE');
  if(contractDigest(taskContract)!==taskContract.contract_digest)fail('TASK_CONTRACT_DIGEST_MISMATCH');
  for(const [field,code] of [['project_id','STALE_PROJECT'],['run_id','STALE_RUN'],['task_id','STALE_TASK'],['attempt_id','STALE_ATTEMPT'],['attempt_epoch','STALE_EPOCH'],['spec_digest','STALE_SPEC_DIGEST'],['contract_digest','STALE_CONTRACT_DIGEST'],['base_commit','STALE_BASE_COMMIT'],['base_tree','STALE_BASE_TREE']]) bind(currentFence[field],taskContract[field],code);
  const fenceGeneration=reqInt(currentFence.fence_generation,1,2147483647,'FENCE_GENERATION');
  const issuedMs=Date.parse(currentFence.issued_at), expiresMs=Date.parse(currentFence.expires_at), nowMs=Date.parse(currentFence.now);
  if(!Number.isFinite(issuedMs)||!Number.isFinite(expiresMs)||!Number.isFinite(nowMs)||expiresMs<=issuedMs)fail('INVALID_EXPIRY');
  if(nowMs>=expiresMs)fail('CAPABILITY_EXPIRED');
  const scope=currentFence.requested_scope??{};
  const owned=shrinkPaths(scope.owned_paths,taskContract.worker_owned_paths,'OWNED_PATHS');
  const read=shrinkPaths(scope.read_paths,taskContract.worker_read_paths,'READ_PATHS');
  const forbidden=canonicalPaths(taskContract.worker_forbidden_paths,'FORBIDDEN_PATHS');
  for(const p of owned)if(forbidden.some(root=>isWithin(p,root)))fail(`OWNED_FORBIDDEN_COLLISION:${p}`);
  const resources=shrinkResources(scope.resource_limits,taskContract.resource_limits);
  const dataClass=shrinkData(scope.data_class,taskContract.data_class);
  if(scope.model_profile_id!==undefined&&scope.model_profile_id!==taskContract.model_profile_id)fail('MODEL_PROFILE_WIDEN');
  const seed={contract_digest:taskContract.contract_digest,task_id:taskContract.task_id,attempt_id:taskContract.attempt_id,attempt_epoch:taskContract.attempt_epoch,fence_generation:fenceGeneration,expires_at:currentFence.expires_at};
  const authorizationMinSchema=shrinkAuthorizationSchema(scope.authorization_min_schema,taskContract.authorization_min_schema??'v49.authorization-envelope.v1');
  const capability={schema:CAPABILITY_SCHEMA,project_id:taskContract.project_id,run_id:taskContract.run_id,root_task_id:taskContract.root_task_id,task_id:taskContract.task_id,attempt_id:taskContract.attempt_id,attempt_epoch:taskContract.attempt_epoch,spec_digest:taskContract.spec_digest,contract_digest:taskContract.contract_digest,base_commit:taskContract.base_commit,base_tree:taskContract.base_tree,owned_paths:owned,read_paths:read,forbidden_paths:forbidden,resource_limits:resources,model_profile_id:taskContract.model_profile_id,model_profile_revision:taskContract.model_profile_revision,data_class:dataClass,sandbox_profile:taskContract.sandbox_profile,authorization_min_schema:authorizationMinSchema,expires_at:currentFence.expires_at,fence_generation:fenceGeneration,opaque_capability_id:`cap_${digest(seed).slice(7,39)}`,execution_authorized:taskContract.worker_dispatch_authorized===true&&taskContract.host_vm_execution_authorized===true&&taskContract.trust_gate_state==='SATISFIED'};
  return {...capability,capability_digest:digest(capability)};
}

export function assertCapabilityCurrent(capability,currentFence){
  if(!capability||capability.schema!==CAPABILITY_SCHEMA)fail('CAPABILITY_SCHEMA_MISMATCH');
  const x=structuredClone(capability), claimed=x.capability_digest; delete x.capability_digest; if(digest(x)!==claimed)fail('CAPABILITY_DIGEST_MISMATCH');
  for(const [field,code] of [['project_id','STALE_PROJECT'],['run_id','STALE_RUN'],['task_id','STALE_TASK'],['attempt_id','STALE_ATTEMPT'],['attempt_epoch','STALE_EPOCH'],['spec_digest','STALE_SPEC_DIGEST'],['contract_digest','STALE_CONTRACT_DIGEST'],['base_commit','STALE_BASE_COMMIT'],['base_tree','STALE_BASE_TREE'],['fence_generation','STALE_FENCE_GENERATION']]) bind(currentFence[field],capability[field],code);
  if(Date.parse(currentFence.now)>=Date.parse(capability.expires_at))fail('CAPABILITY_EXPIRED'); return true;
}
