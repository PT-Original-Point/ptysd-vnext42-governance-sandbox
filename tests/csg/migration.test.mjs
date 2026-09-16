import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGovernanceShadow,deriveLegacyViews,selectCurrent,assertStableReadWindow,validateCheckpointPointer,assertNoFullPassClaim} from '../../scripts/csg-migration-shadow.mjs';
const OID='066f6675ea566da07de8a1ae68d98afe635aff94', Q='cd2b177a27bcb49cc9026dec251649afafcf8d59';
const owner={principal_id:'CHATGPT-CONTROLLER',owner_generation:2,scope:'CSG-GOVERNANCE-QUEUE',lease_until:'2026-09-16T11:28:01Z'};
function fixture(){return {
 read_window:{before:{canonical_control_oid:OID,queue_oid:Q,directory_revision:3},after:{canonical_control_oid:OID,queue_oid:Q,directory_revision:3}},
 control:{project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',control_version:53,next_gate:'W47-06',active_run_id:'V47-CONSTRUCTION-001',mission_revision_id:'20260916T001525+0800',policy_revision_id:'20260916T001525+0800-EP68',v47_production_allowed:false,v47_business_project_access_allowed:false,v47_paid_fallback_allowed:false,v47_coding_parallelism_active:1},
 run:{project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',run_id:'V47-CONSTRUCTION-001',revision:3,active_task_id:'W47-06',stop_requested:false,unresolved_operation_ids:[]},
 runContract:{project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',task_id:'W47-04'},
 explicitTaskContract:null,
 taskGraphReceipt:{project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',next_wp:'W47-06',tests:{full_repository:{pass:171,fail:4,total:175},clean_parent_baseline_same_stale_failures:{classification:'PRE_EXISTING_STALE_CURRENT_CONTROL_ASSERTIONS_AFTER_LEGITIMATE_V47_REBASE'}}},
 directory:{project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',source_directory_revision:3,project_status:'RESERVED',active_run_id:'V47-CONSTRUCTION-001',next_hard_gate:'W47-06',current_mission_revision:'20260916T001525+0800',current_execution_policy_revision:'20260916T001525+0800-EP68'},
 pointer:{schema_version:'csg.pointer.v1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',checkpoint_seq:6,checkpoint_path:'checkpoints/csg/000006.json',checkpoint_digest:'sha256:'+'6'.repeat(64)},
 checkpoint:{schema_version:'csg.checkpoint.v1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',checkpoint_seq:6,payload_digest:'sha256:'+'6'.repeat(64),task_id:'W47-06',stop_requested:false,barrier:'ACTIVE_UNIT',owner},
 owner,
 legacyManifest:{schema:'PTYSD_RUNTIME_MANIFEST_V1',canonical_state_store:'sqlite-wal',workflow_authority:'supervisor-fsm'},readerCensus:{status:'UNRESOLVED_NOT_PROVEN_ZERO',active_reader_count:null},
 source_oids:{control_blob:'c638a7f496d2d99d10009f29c190d34b7351cfc6',run_blob:'0978d5385b761f5ac6644e25cdb21d89cdcfba8f',run_contract_blob:'8afd3c5e3c0b2fa40f2d179521411510bebafd0c',w47_05_receipt_blob:'62cbf973c07cee8c4675dd58bde5a8de7a293b10',legacy_manifest_blob:'91c93c397afe236214d11ee8feb54756a1672fc9',directory_shadow_blob:'43ada6ec00396c753be5703731595c697a84cfbe'}
};}

test('provider-derived shadow qualifies but remains non-authoritative',()=>{const s=buildGovernanceShadow(fixture());assert.equal(s.authority,'NON_AUTHORITATIVE_SHADOW');assert.equal(s.canonical.current_task_id,'W47-06');});
test('171 of 175 remains explicit and cannot become full pass',()=>{const s=buildGovernanceShadow(fixture());assert.deepEqual(s.w47_05_suite,{pass:171,fail:4,total:175,classification:'PRE_EXISTING_STALE_CURRENT_CONTROL_ASSERTIONS_AFTER_LEGITIMATE_V47_REBASE',full_pass_claim_allowed:false});assert.equal(assertNoFullPassClaim(s),true);});
test('W47-04 run contract is exposed as transition contract not W47-06 permit',()=>{const s=buildGovernanceShadow(fixture());assert.equal(s.task_contract.status,'TRANSITION_CONTRACT_RETAINED_NOT_ACTIVE_TASK_PERMIT');assert.ok(s.cutover_blockers.includes('ACTIVE_TASK_CONTRACT_NOT_EXPLICITLY_RESOLVED'));});
test('old Z6 candidate cannot take over newer exact canonical oid',()=>{const s=buildGovernanceShadow(fixture());const r=selectCurrent({binding_mode:'LEGACY_CURRENT_SHADOW_ONLY',shadow:s,legacyCandidate:{control_oid:'0'.repeat(40),current_task_id:'Z6'}});assert.equal(r.current_task_id,'W47-06');assert.equal(r.ignored_legacy,true);});
test('control plane advance during read fails closed',()=>{const x=fixture();x.read_window.after.canonical_control_oid='1'.repeat(40);assert.throws(()=>buildGovernanceShadow(x),/READ_WINDOW_DRIFT/);});
test('queue advance during read fails closed',()=>{const x=fixture();x.read_window.after.queue_oid='1'.repeat(40);assert.throws(()=>buildGovernanceShadow(x),/READ_WINDOW_DRIFT/);});
test('wrong checkpoint digest fails closed',()=>{const x=fixture();x.pointer.checkpoint_digest='sha256:'+'7'.repeat(64);assert.throws(()=>buildGovernanceShadow(x),/CHECKPOINT_DIGEST_MISMATCH/);});
test('wrong checkpoint path fails closed',()=>{const x=fixture();x.pointer.checkpoint_path='checkpoints/csg/000005.json';assert.throws(()=>buildGovernanceShadow(x),/CHECKPOINT_PATH_MISMATCH/);});
test('legacy reader census unresolved blocks cutover without blocking shadow read',()=>{const s=buildGovernanceShadow(fixture());assert.equal(s.legacy_reader.zero_active_readers_proven,false);assert.ok(s.cutover_blockers.includes('LEGACY_READER_CENSUS_REQUIRED'));assert.equal(s.cutover_eligible,false);});
test('active legacy reader blocks cutover',()=>{const x=fixture();x.readerCensus={status:'ACTIVE_READERS_PRESENT',active_reader_count:1};const s=buildGovernanceShadow(x);assert.equal(s.cutover_eligible,false);});
test('shadow does not change active owner',()=>{const x=fixture();const s=buildGovernanceShadow(x);assert.deepEqual(s.continuity.owner,owner);});
test('legacy control and run are projections of same shadow payload',()=>{const s=buildGovernanceShadow(fixture());const v=deriveLegacyViews(s);assert.equal(v.control_projection.next_gate,v.run_projection.active_task_id);assert.equal(v.control_projection.active_run_id,v.run_projection.run_id);assert.equal(v.control_projection.w47_05_full_suite,'171_PASS_4_PREEXISTING_STALE_ASSERTIONS_OF_175');});
test('scope and unresolved effects are preserved',()=>{const s=buildGovernanceShadow(fixture());assert.deepEqual(s.scope,{production_allowed:false,business_project_access_allowed:false,paid_fallback_allowed:false,coding_parallelism_active:1});assert.deepEqual(s.canonical.unresolved_operation_ids,[]);assert.equal(s.canonical.stop_requested,false);});
test('exact W47-06 contract plus zero-reader proof removes only migration blockers',()=>{const x=fixture();x.explicitTaskContract={task_id:'W47-06',ref:'contracts/W47-06.json'};x.readerCensus={status:'ZERO_ACTIVE_PROVEN',active_reader_count:0};const s=buildGovernanceShadow(x);assert.equal(s.cutover_eligible,true);assert.deepEqual(s.cutover_blockers,[]);});
test('owner mutation is rejected',()=>{const x=fixture();x.owner={...owner,owner_generation:3};assert.throws(()=>buildGovernanceShadow(x),/ACTIVE_OWNER_CHANGED/);});
