import {createHash} from 'node:crypto';

const SHA1=/^[0-9a-f]{40}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function stableJson(v){
  if(Array.isArray(v)) return '['+v.map(stableJson).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableJson(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
export function sha256Json(v){return 'sha256:'+createHash('sha256').update(Buffer.from(stableJson(v),'utf8')).digest('hex');}

export function assertStableReadWindow(before,after){
  for(const key of ['canonical_control_oid','queue_oid','directory_revision']){
    if(before[key]!==after[key]) fail(`READ_WINDOW_DRIFT:${key}`);
  }
  return true;
}
export function validateCheckpointPointer(pointer,checkpoint){
  if(pointer?.schema_version!=='csg.pointer.v1'||checkpoint?.schema_version!=='csg.checkpoint.v1') fail('CHECKPOINT_SCHEMA_MISMATCH');
  if(pointer.project_id!==checkpoint.project_id) fail('CHECKPOINT_PROJECT_MISMATCH');
  if(pointer.checkpoint_seq!==checkpoint.checkpoint_seq) fail('CHECKPOINT_SEQ_MISMATCH');
  const expected=`checkpoints/csg/${String(checkpoint.checkpoint_seq).padStart(6,'0')}.json`;
  if(pointer.checkpoint_path!==expected) fail('CHECKPOINT_PATH_MISMATCH');
  if(pointer.checkpoint_digest!==checkpoint.payload_digest) fail('CHECKPOINT_DIGEST_MISMATCH');
  if(!DIGEST.test(checkpoint.payload_digest)) fail('CHECKPOINT_DIGEST_INVALID');
  return true;
}
function requireCurrentChain({control,run,directory,taskGraphReceipt}){
  const task=run.active_task_id;
  if(control.project_id!==run.project_id||run.project_id!==directory.project_id||directory.project_id!==taskGraphReceipt.project_id) fail('PROJECT_ID_MISMATCH');
  if(control.next_gate!==task||directory.next_hard_gate!==task||taskGraphReceipt.next_wp!==task) fail('CURRENT_TASK_CHAIN_MISMATCH');
  if(control.active_run_id!==run.run_id||directory.active_run_id!==run.run_id) fail('RUN_ID_MISMATCH');
  if(control.mission_revision_id!==directory.current_mission_revision||control.policy_revision_id!==directory.current_execution_policy_revision) fail('MISSION_POLICY_MISMATCH');
  if(run.stop_requested!==false) fail('STOP_REQUESTED');
  return task;
}
function suiteSnapshot(taskGraphReceipt){
  const s=taskGraphReceipt.tests?.full_repository;
  if(!s||s.pass!==171||s.fail!==4||s.total!==175) fail('W47_05_SUITE_CLASSIFICATION_DRIFT');
  if(taskGraphReceipt.tests?.clean_parent_baseline_same_stale_failures?.classification!=='PRE_EXISTING_STALE_CURRENT_CONTROL_ASSERTIONS_AFTER_LEGITIMATE_V47_REBASE') fail('STALE_ASSERTION_CLASSIFICATION_DRIFT');
  return {pass:171,fail:4,total:175,classification:'PRE_EXISTING_STALE_CURRENT_CONTROL_ASSERTIONS_AFTER_LEGITIMATE_V47_REBASE',full_pass_claim_allowed:false};
}
function taskContractSnapshot(run,runContract,explicitTaskContract){
  if(runContract.project_id!==run.project_id) fail('RUN_CONTRACT_PROJECT_MISMATCH');
  if(explicitTaskContract&&explicitTaskContract.task_id===run.active_task_id){
    return {active_task_id:run.active_task_id,run_contract_task_id:runContract.task_id,status:'ACTIVE_TASK_CONTRACT_EXPLICITLY_RESOLVED',explicit_contract_ref:explicitTaskContract.ref,cutover_blocker:false};
  }
  if(runContract.task_id===run.active_task_id){
    return {active_task_id:run.active_task_id,run_contract_task_id:runContract.task_id,status:'RUN_CONTRACT_MATCHES_ACTIVE_TASK',explicit_contract_ref:null,cutover_blocker:false};
  }
  return {active_task_id:run.active_task_id,run_contract_task_id:runContract.task_id,status:'TRANSITION_CONTRACT_RETAINED_NOT_ACTIVE_TASK_PERMIT',explicit_contract_ref:null,cutover_blocker:true};
}
function legacyReaderSnapshot(legacyManifest,readerCensus){
  if(!legacyManifest||legacyManifest.schema!=='PTYSD_RUNTIME_MANIFEST_V1') fail('LEGACY_MANIFEST_MISSING');
  const resolved=readerCensus?.status==='ZERO_ACTIVE_PROVEN'&&readerCensus.active_reader_count===0;
  return {manifest_path:'config/runtime-manifest.json',canonical_state_store:legacyManifest.canonical_state_store,workflow_authority:legacyManifest.workflow_authority,census_status:readerCensus?.status||'UNRESOLVED_NOT_PROVEN_ZERO',active_reader_count:readerCensus?.active_reader_count??null,zero_active_readers_proven:resolved,cutover_blocker:!resolved};
}
export function buildGovernanceShadow(input){
  assertStableReadWindow(input.read_window.before,input.read_window.after);
  validateCheckpointPointer(input.pointer,input.checkpoint);
  const task=requireCurrentChain(input);
  if(input.checkpoint.owner&&input.owner&& !eq(input.checkpoint.owner,input.owner)) fail('ACTIVE_OWNER_CHANGED');
  if(input.checkpoint.task_id!==task) fail('CHECKPOINT_TASK_MISMATCH');
  if(input.checkpoint.stop_requested!==runStop(input.run)) fail('STOP_STATE_MISMATCH');
  const suite=suiteSnapshot(input.taskGraphReceipt);
  const taskContract=taskContractSnapshot(input.run,input.runContract,input.explicitTaskContract);
  const legacyReader=legacyReaderSnapshot(input.legacyManifest,input.readerCensus);
  const blockers=[];
  if(taskContract.cutover_blocker) blockers.push('ACTIVE_TASK_CONTRACT_NOT_EXPLICITLY_RESOLVED');
  if(legacyReader.cutover_blocker) blockers.push('LEGACY_READER_CENSUS_REQUIRED');
  const shadow={
    schema:'CSG_GOVERNANCE_MIGRATION_SHADOW_V1',authority:'NON_AUTHORITATIVE_SHADOW',project_id:input.run.project_id,
    read_window:structuredClone(input.read_window),
    canonical:{control_ref:'refs/heads/v45/factory-control',control_oid:input.read_window.after.canonical_control_oid,control_version:input.control.control_version,current_task_id:task,run_id:input.run.run_id,run_revision:input.run.revision,stop_requested:input.run.stop_requested,unresolved_operation_ids:structuredClone(input.run.unresolved_operation_ids)},
    directory:{directory_revision:input.directory.source_directory_revision??input.directory.directory_revision,status:input.directory.project_status??input.directory.status,next_hard_gate:input.directory.next_hard_gate},
    continuity:{queue_oid:input.read_window.after.queue_oid,checkpoint_seq:input.pointer.checkpoint_seq,checkpoint_digest:input.pointer.checkpoint_digest,barrier:input.checkpoint.barrier,owner:structuredClone(input.checkpoint.owner)},
    w47_05_suite:suite,task_contract:taskContract,legacy_reader:legacyReader,
    scope:{production_allowed:input.control.v47_production_allowed,business_project_access_allowed:input.control.v47_business_project_access_allowed,paid_fallback_allowed:input.control.v47_paid_fallback_allowed,coding_parallelism_active:input.control.v47_coding_parallelism_active},
    source_oids:structuredClone(input.source_oids),
    cutover_eligible:blockers.length===0,cutover_blockers:blockers,
    old_z6_takeover_allowed:false
  };
  shadow.shadow_digest=sha256Json(shadow);
  return shadow;
}
function runStop(run){return Boolean(run.stop_requested);}
export function deriveLegacyViews(shadow){
  return {
    control_projection:{project_id:shadow.project_id,control_version:shadow.canonical.control_version,next_gate:shadow.canonical.current_task_id,active_run_id:shadow.canonical.run_id,w47_05_full_suite:`${shadow.w47_05_suite.pass}_PASS_${shadow.w47_05_suite.fail}_PREEXISTING_STALE_ASSERTIONS_OF_${shadow.w47_05_suite.total}`},
    run_projection:{project_id:shadow.project_id,run_id:shadow.canonical.run_id,revision:shadow.canonical.run_revision,active_task_id:shadow.canonical.current_task_id,stop_requested:shadow.canonical.stop_requested,unresolved_operation_ids:structuredClone(shadow.canonical.unresolved_operation_ids)}
  };
}
export function selectCurrent({binding_mode,shadow,legacyCandidate}){
  if(binding_mode!=='LEGACY_CURRENT_SHADOW_ONLY') fail('CUTOVER_NOT_AUTHORIZED');
  if(legacyCandidate&&legacyCandidate.control_oid!==shadow.canonical.control_oid) return {source:'CANONICAL_EXACT_OID',current_task_id:shadow.canonical.current_task_id,ignored_legacy:true};
  return {source:'CANONICAL_EXACT_OID',current_task_id:shadow.canonical.current_task_id,ignored_legacy:false};
}
export function assertNoFullPassClaim(shadow){if(shadow.w47_05_suite.fail!==4||shadow.w47_05_suite.full_pass_claim_allowed!==false) fail('ILLEGAL_175_PASS_CLAIM');return true;}
