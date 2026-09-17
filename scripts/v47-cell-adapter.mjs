import {createHash} from 'node:crypto';

export const CELL_PROFILE_SCHEMA='v47.cell.profile.v1';
export const CELL_PLAN_SCHEMA='v47.cell.plan.v1';
export const CELL_ATTESTATION_SCHEMA='v47.cell.runtime-attestation.v1';
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const ID=/^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const ROLES=new Set(['BUILD','REVIEW','REPAIR','REPLAN','INTEGRATE','FINAL_AUDIT']);
const READONLY=new Set(['REVIEW','REPLAN','FINAL_AUDIT']);
const ATTEST=[
  'ROOTLESS_EFFECTIVE','IMAGE_DIGEST_MATCH','NETWORK_NONE_EFFECTIVE','READONLY_ROOT_EFFECTIVE',
  'NO_NEW_PRIVILEGES_EFFECTIVE','CAP_DROP_ALL_EFFECTIVE','CPU_LIMIT_EFFECTIVE','MEMORY_LIMIT_EFFECTIVE',
  'PIDS_LIMIT_EFFECTIVE','DISK_LIMIT_EFFECTIVE','MANAGEMENT_SOCKET_ABSENT','SSH_AGENT_ABSENT',
  'HOST_PID_DENIED','HOST_NETWORK_DENIED','PRIVATE_REPO_MOUNT','PRIVATE_GIT_OBJECT_DB','ROLE_WRITE_POLICY_EFFECTIVE'
];
const fail=(x)=>{throw new Error(x)};
const copy=(x)=>structuredClone(x);

export function validateCellProfile(p){
  if(!p||p.schema_version!==CELL_PROFILE_SCHEMA||!ID.test(p.profile_id||'')) fail('CELL_PROFILE_INVALID');
  if(!['BLOCKED_IMAGE_PIN','READY'].includes(p.qualification_state)) fail('CELL_PROFILE_STATE_INVALID');
  if(p.base_image_digest!==null&&!DIGEST.test(p.base_image_digest)) fail('IMAGE_DIGEST_INVALID');
  if(p.qualification_state==='READY'&&!DIGEST.test(p.base_image_digest||'')) fail('IMAGE_DIGEST_UNRESOLVED');
  if(p.cell_root!=='/home/ptysd/.local/state/ptysd-v47/cells/{cell_id}') fail('CELL_ROOT_INVALID');
  if(!Number.isSafeInteger(p.tmpfs_mib)||p.tmpfs_mib<16||p.tmpfs_mib>1024) fail('TMPFS_LIMIT_INVALID');
  return copy(p);
}

export function pinCellImage(profile,digest){
  const p=validateCellProfile(profile);
  if(!DIGEST.test(digest)) fail('IMAGE_DIGEST_INVALID');
  p.base_image_digest=digest; p.qualification_state='READY';
  return validateCellProfile(p);
}

function executionIdentity(task,attempt){
  for(const k of ['project_id','run_id','task_id','contract_digest']) if(typeof task?.[k]!=='string') fail('COMPILED_TASK_REQUIRED');
  if(!DIGEST.test(task.contract_digest)) fail('COMPILED_TASK_REQUIRED');
  if(!ID.test(attempt?.attempt_id||'')||!Number.isSafeInteger(attempt?.attempt_epoch)||attempt.attempt_epoch<0||!ROLES.has(attempt?.role)) fail('ATTEMPT_IDENTITY_INVALID');
  const raw=[task.project_id,task.run_id,task.task_id,attempt.attempt_id,attempt.attempt_epoch,attempt.role].join('\n');
  return {cell_id:`CELL-${createHash('sha256').update(raw).digest('hex').slice(0,24).toUpperCase()}`,role:attempt.role};
}

function resources(task){
  const r=task?.resource_request;
  if(!r||!Number.isFinite(r.cpu_millis)||r.cpu_millis<=0||!Number.isSafeInteger(r.memory_mib)||r.memory_mib<=0||!Number.isSafeInteger(r.pids)||r.pids<=0||!Number.isSafeInteger(r.disk_mib)||r.disk_mib<=0||r.network_mode!=='DENY') fail('COMPILED_RESOURCE_REQUEST_REQUIRED');
  return {cpu_millis:r.cpu_millis,memory_mib:r.memory_mib,pids:r.pids,disk_mib:r.disk_mib,network_mode:'DENY'};
}

export function compileCellPlan(profile,task,attempt){
  const p=validateCellProfile(profile);
  if(p.qualification_state!=='READY') fail('CELL_PROFILE_NOT_EXECUTION_READY');
  const {cell_id,role}=executionIdentity(task,attempt), r=resources(task), root=p.cell_root.replace('{cell_id}',cell_id);
  const paths={root,home:`${root}/home`,xdg_config:`${root}/xdg/config`,xdg_data:`${root}/xdg/data`,xdg_cache:`${root}/xdg/cache`,opencode_db:`${root}/state/opencode.db`,repo:`${root}/repo`,output:`${root}/output`};
  const ro=READONLY.has(role), mount=(src,dst)=>`--volume=${src}:${dst}:${ro?'ro':'rw'},nodev,nosuid`;
  const plan={schema_version:CELL_PLAN_SCHEMA,cell_id,role,base_image_digest:p.base_image_digest,paths,
    env:{HOME:paths.home,XDG_CONFIG_HOME:paths.xdg_config,XDG_DATA_HOME:paths.xdg_data,XDG_CACHE_HOME:paths.xdg_cache,OPENCODE_DB:paths.opencode_db,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',SSH_AUTH_SOCK:''},
    resources:r,required_runtime_readback:[...ATTEST],podman_args:['run','--rm','--read-only','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',`--pids-limit=${r.pids}`,`--memory=${r.memory_mib}m`,`--cpus=${(r.cpu_millis/1000).toFixed(3)}`,`--storage-opt=size=${r.disk_mib}M`,`--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${p.tmpfs_mib}m`,mount(paths.repo,'/workspace/repo'),mount(paths.output,'/workspace/output'),p.base_image_digest]};
  return assertCellPlan(plan)&&plan;
}

export function assertCellPlan(p){
  if(!p||p.schema_version!==CELL_PLAN_SCHEMA||!DIGEST.test(p.base_image_digest||'')||!p.paths?.root?.includes(p.cell_id)) fail('CELL_PLAN_INVALID');
  for(const k of ['home','xdg_config','xdg_data','xdg_cache','opencode_db','repo','output']) if(!p.paths[k]?.startsWith(`${p.paths.root}/`)) fail('CROSS_CELL_STATE_PATH');
  if(p.env?.SSH_AUTH_SOCK!==''||p.env?.GIT_CONFIG_GLOBAL!=='/dev/null') fail('HOST_CREDENTIAL_OR_GIT_CONFIG_EXPOSED');
  const a=p.podman_args||[], joined=a.join('\n');
  for(const x of ['--read-only','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges']) if(!a.includes(x)) fail('MISSING_PODMAN_HARDENING');
  for(const x of ['--privileged','--network=host','--pid=host','podman.sock','docker.sock']) if(joined.includes(x)) fail('FORBIDDEN_PODMAN_ARGUMENT');
  if(READONLY.has(p.role)&&a.some(x=>x.startsWith('--volume=')&&x.includes(':rw,'))) fail('READONLY_ROLE_WRITE_CAPABILITY');
  return true;
}

export function assertRuntimeAttestation(plan,a){
  assertCellPlan(plan);
  if(!a||a.schema_version!==CELL_ATTESTATION_SCHEMA||a.cell_id!==plan.cell_id) fail('RUNTIME_ATTESTATION_INVALID');
  const keys=Object.keys(a.checks||{});
  if(keys.length!==ATTEST.length||ATTEST.some(k=>!keys.includes(k))) fail('RUNTIME_ATTESTATION_CHECKSET_MISMATCH');
  for(const k of ATTEST) if(a.checks[k]!==true) fail(`RUNTIME_CONTROL_NOT_EFFECTIVE:${k}`);
  return true;
}

export function assertCellSeparation(a,b){
  if(a.cell_id===b.cell_id) fail('CELL_ID_COLLISION');
  for(const k of ['root','home','xdg_config','xdg_data','xdg_cache','opencode_db','repo','output']) if(a.paths[k]===b.paths[k]) fail(`CROSS_CELL_PATH_ALIAS:${k}`);
  return true;
}

export function inspectCandidateEntries(entries){
  if(!Array.isArray(entries)) fail('CANDIDATE_ENTRIES_INVALID');
  for(const e of entries){
    const p=String(e?.path||'');
    if(!p||p.includes('\\')||p.startsWith('/')||/^[A-Za-z]:/.test(p)||p.split('/').some(x=>!x||x==='.'||x==='..'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))) fail('CANDIDATE_PATH_ESCAPE');
    const low=p.toLowerCase();
    if(low==='.git'||low.startsWith('.git/')||low==='.gitmodules'||low.startsWith('.opencode/')) fail('CANDIDATE_CONFIG_INJECTION');
    if(e.kind==='symlink'&&(!e.target||String(e.target).startsWith('/')||/^[A-Za-z]:/.test(String(e.target))||String(e.target).split('/').includes('..'))) fail('SYMLINK_ESCAPE');
    if(!['file','dir','symlink'].includes(e.kind)) fail('CANDIDATE_ENTRY_KIND_INVALID');
    const c=typeof e.content==='string'?e.content:'';
    if(/^gitdir:/im.test(c)||/core\.(hooksPath|fsmonitor)/i.test(c)||/filter\s*=|filter\.[A-Za-z0-9_-]+/i.test(c)) fail('GIT_CONFIG_INJECTION');
    if(c.startsWith('version https://git-lfs.github.com/spec/v1')) fail('LFS_POINTER_REQUIRES_TRUSTED_MATERIALIZATION');
  }
  return true;
}
