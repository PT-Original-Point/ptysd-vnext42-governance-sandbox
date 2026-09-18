import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compileCellCapability, assertCapabilityCurrent} from '../capability.mjs';
import {createJobSupervisor} from '../mutation-supervisor.mjs';
import {projectStatus, STATUS_VIEWS} from '../status-projection.mjs';
import {selectNativeAdapter, createAdapterInvocation} from '../adapter-abi.mjs';
import {computeVerifierBundleDigest, createVerifierBindingReceipt, admitVerifierOutcome} from '../verifier-binding.mjs';
import {evaluateObjectiveAdvisorTriggers, evaluateAdvisorPermit} from '../advisor-guard.mjs';

const contract=JSON.parse(fs.readFileSync(new URL('../../../../governance/csg/v48/w47-06-execution-contract-v1.json',import.meta.url),'utf8'));
const D=c=>`sha256:${c.repeat(64)}`;
const fence=()=>({
  project_id:contract.project_id,run_id:contract.run_id,task_id:contract.task_id,
  attempt_id:contract.attempt_id,attempt_epoch:contract.attempt_epoch,
  spec_digest:contract.spec_digest,contract_digest:contract.contract_digest,
  base_commit:contract.base_commit,base_tree:contract.base_tree,
  fence_generation:1,issued_at:'2026-09-18T07:00:00Z',expires_at:'2026-09-18T08:00:00Z',now:'2026-09-18T07:30:00Z',
  requested_scope:{
    owned_paths:['tools/csg/cell-kernel'],
    read_paths:['governance/csg/current.json'],
    resource_limits:{cpu_millis:1000,memory_mib:512,pids:16,disk_mib:64,provider_calls:0,network_mode:'DENY'},
    data_class:['SYNTHETIC'],
    model_profile_id:contract.model_profile_id,
  }
});
const identity=()=>({project_id:contract.project_id,run_id:contract.run_id,task_id:contract.task_id,attempt_id:contract.attempt_id,attempt_epoch:contract.attempt_epoch});
function runner(){let terminal=false;let starts=0;return{get starts(){return starts},set terminal(v){terminal=v},async start(){starts++;return{process_ref:'synthetic-proc-1',status:'RUNNING'}},async poll(){return{status:terminal?'SUCCEEDED':'RUNNING',events:['builder-ok','x'.repeat(300)],cursor:'cursor-1'}},async cancel(){}}}
const pre=()=>({base_commit:contract.base_commit,base_tree:contract.base_tree,file_hashes:{}});

function verifierReceipt(){
  const verifier_digest=computeVerifierBundleDigest({verifier_source_digest:D('1'),expected_case_digests:[D('2'),D('3')],anchor_digest:D('4')});
  return {verifier_digest,receipt:createVerifierBindingReceipt({candidate_commit:'c'.repeat(40),candidate_tree:'d'.repeat(40),worktree_root:path.resolve('/tmp/v48-n1'),cwd:path.resolve('/tmp/v48-n1/candidate'),contract_digest:contract.contract_digest,verifier_digest})};
}

test('N=1 happy path composes canonical contract -> capability -> builder -> reviewer -> verifier -> integrator -> publication intent',async()=>{
  const cap=compileCellCapability(contract,fence());
  assert.equal(cap.project_id,'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.equal(cap.execution_authorized,false,'current D12 gate must not silently authorize Worker/VM');
  assert.equal(cap.data_class.length,1);assert.equal(cap.data_class[0],'SYNTHETIC');
  assertCapabilityCurrent(cap,fence());

  const selection=selectNativeAdapter([{adapter_id:'synthetic-builder',interface_kind:'OPEN_CODE_NATIVE_HTTP',qualified:true,paid_fallback_allowed:false,incremental_usd:0,binary_required:false,binary_present:true,capabilities:['build'],route:'synthetic'}],['build']);
  const invocation=createAdapterInvocation(selection,identity(),{goal:'n1-synthetic-build',data_class:'SYNTHETIC'});
  assert.equal(invocation.incremental_usd,0);assert.equal(invocation.paid_fallback_allowed,false);
  assert.equal(Object.hasOwn(invocation.request,'provider_write_credential'),false);

  const r=runner();const s=createJobSupervisor({cell_id:'d12-happy',runner:r,initial_prestate:pre(),limits:{max_output_bytes:96,max_cursor_bytes:64,max_events:4}});
  await s.start({job_id:'JOB-N1',launch_key:'LAUNCH-N1',mode:'foreground',attempt_id:contract.attempt_id,attempt_epoch:contract.attempt_epoch});
  r.terminal=true;const polled=await s.poll('JOB-N1',0,null);assert.equal(polled.status,'SUCCEEDED');assert.ok(Buffer.byteLength(JSON.stringify(polled.events),'utf8')<=96);
  const lease=s.claim_activity('JOB-N1','BUILDER-EXPORT',{attempt_id:contract.attempt_id,attempt_epoch:1});
  s.settle_activity('JOB-N1','BUILDER-EXPORT',lease.activity_token,{attempt_id:contract.attempt_id,attempt_epoch:1});

  const trustedExport=Object.freeze({project_id:cap.project_id,candidate_commit:'c'.repeat(40),candidate_tree:'d'.repeat(40),contract_digest:cap.contract_digest,worker_provider_credential_count:0,incremental_usd:0});
  const freshReviewer=structuredClone(trustedExport);assert.equal(freshReviewer.project_id,contract.project_id);assert.equal(freshReviewer.worker_provider_credential_count,0);

  const {verifier_digest,receipt}=verifierReceipt();
  const verified=admitVerifierOutcome(receipt,{candidate_commit:trustedExport.candidate_commit,candidate_tree:trustedExport.candidate_tree,worktree_root:path.resolve('/tmp/v48-n1'),cwd:path.resolve('/tmp/v48-n1/candidate'),contract_digest:contract.contract_digest,verifier_digest,candidate_verdict:'PASS',candidate_exit_code:0,tests_total:3,tests_pass:3,tests_fail:0,tests_skipped:0,source_checkout_verdict:'PASS'});
  assert.equal(verified.accepted,true);

  const integrator=Object.freeze({...trustedExport,review_verdict:'PASS',verifier_binding_digest:verified.binding_digest});
  assert.equal(integrator.candidate_tree,trustedExport.candidate_tree);
  const finalVerify=admitVerifierOutcome(receipt,{candidate_commit:integrator.candidate_commit,candidate_tree:integrator.candidate_tree,worktree_root:path.resolve('/tmp/v48-n1'),cwd:path.resolve('/tmp/v48-n1/candidate'),contract_digest:contract.contract_digest,verifier_digest,candidate_verdict:'PASS',candidate_exit_code:0,tests_total:2,tests_pass:2,tests_fail:0,tests_skipped:0});
  assert.equal(finalVerify.accepted,true);

  const begin=s.begin_completion('JOB-N1',{attempt_id:contract.attempt_id,attempt_epoch:1});
  const done=s.commit_completion('JOB-N1',{attempt_id:contract.attempt_id,attempt_epoch:1,completion_id:'COMP-N1',completion_candidate_revision:begin.completion_candidate_revision,unresolved_effect_count:0,verifier_pass:true});
  const ackLost=s.commit_completion('JOB-N1',{attempt_id:contract.attempt_id,attempt_epoch:1,completion_id:'COMP-N1',completion_candidate_revision:begin.completion_candidate_revision,unresolved_effect_count:0,verifier_pass:true});
  assert.equal(done.completion_digest,ackLost.completion_digest);assert.equal(ackLost.reused,true);

  const publicationIntent={provider:'GitHub',target:'refs/heads/v45/factory-control',effect_boundary:'PROVIDERGUARD',candidate_commit:integrator.candidate_commit,candidate_tree:integrator.candidate_tree,worker_provider_credential_count:0,incremental_usd:0,dispatcher:'MAIN_CONTROLLER'};
  assert.equal(publicationIntent.effect_boundary,'PROVIDERGUARD');assert.equal(publicationIntent.worker_provider_credential_count,0);assert.equal(publicationIntent.incremental_usd,0);
});

test('no cross-project leak and stale epoch fail closed',async()=>{
  assert.throws(()=>compileCellCapability(contract,{...fence(),project_id:'OTHER_PROJECT'}),/STALE_PROJECT/);
  const cap=compileCellCapability(contract,fence());assert.throws(()=>assertCapabilityCurrent(cap,{...fence(),attempt_epoch:2}),/STALE_EPOCH/);
  const r=runner();const s=createJobSupervisor({cell_id:'d12-stale',runner:r,initial_prestate:pre()});
  await s.start({job_id:'JOB-S',launch_key:'LAUNCH-S',attempt_id:contract.attempt_id,attempt_epoch:1});r.terminal=true;await s.poll('JOB-S');
  assert.throws(()=>s.begin_completion('JOB-S',{attempt_id:contract.attempt_id,attempt_epoch:2}),/STALE_EPOCH/);
});

test('completion fence blocks active work and crash between begin/commit becomes recovery_required',async()=>{
  const r=runner();const s=createJobSupervisor({cell_id:'d12-fence',runner:r,initial_prestate:pre()});
  await s.start({job_id:'JOB-F',launch_key:'LAUNCH-F',attempt_id:contract.attempt_id,attempt_epoch:1});r.terminal=true;await s.poll('JOB-F');
  const lease=s.claim_activity('JOB-F','ACT-F',{attempt_id:contract.attempt_id,attempt_epoch:1});
  const begin=s.begin_completion('JOB-F',{attempt_id:contract.attempt_id,attempt_epoch:1});
  assert.throws(()=>s.commit_completion('JOB-F',{attempt_id:contract.attempt_id,attempt_epoch:1,completion_id:'COMP-F',completion_candidate_revision:begin.completion_candidate_revision,unresolved_effect_count:0,verifier_pass:true}),/ACTIVE_LEASES_BLOCK_COMPLETION/);
  s.settle_activity('JOB-F','ACT-F',lease.activity_token,{attempt_id:contract.attempt_id,attempt_epoch:1});
  const interrupted=s.record_interruption('JOB-F',{attempt_id:contract.attempt_id,attempt_epoch:1});assert.equal(interrupted.state,'RECOVERY_REQUIRED');
  assert.throws(()=>s.commit_completion('JOB-F',{attempt_id:contract.attempt_id,attempt_epoch:1,completion_id:'COMP-F',completion_candidate_revision:begin.completion_candidate_revision,unresolved_effect_count:0,verifier_pass:true}),/RECOVERY_REQUIRED/);
});

test('STOP is priority-visible and status/context projection stays bounded',()=>{
  const evidence=Array.from({length:20},(_,i)=>({artifact_ref:{kind:'BUNDLE_OBJECT',path:`e/${i}.json`,digest:D(String(i%10))},category:'TEST',result:'PASS',summary:'x'.repeat(500)}));
  const status={revision:9,state:'RUNNING',stop_requested:true,approval:null,error:null,unresolved_effect_refs:[],evidence,metadata:{project_id:contract.project_id,run_id:contract.run_id,task_id:contract.task_id,attempt_id:contract.attempt_id,attempt_epoch:1,phase:'D12',completion_state:'OPEN'}};
  const compact=projectStatus(status,{view:'compact',since_revision:99});
  assert.equal(compact.unchanged,false);assert.equal(compact.stop_requested,true);assert.ok(Buffer.byteLength(JSON.stringify(compact),'utf8')<=STATUS_VIEWS.compact);
  const standard=projectStatus({...status,stop_requested:false},{view:'standard',since_revision:0});
  assert.ok(Buffer.byteLength(JSON.stringify(standard),'utf8')<=STATUS_VIEWS.standard);assert.ok(standard.hidden_evidence_count>0);
});

test('worker provider-write credential and paid fallback remain forbidden',()=>{
  const selection=selectNativeAdapter([{adapter_id:'synthetic-builder',interface_kind:'OPEN_CODE_NATIVE_HTTP',qualified:true,paid_fallback_allowed:false,incremental_usd:0,binary_required:false,binary_present:true,capabilities:['build'],route:'synthetic'}],['build']);
  assert.throws(()=>createAdapterInvocation(selection,identity(),{provider_write_credential:'secret'}),/PROVIDER_WRITE_CREDENTIAL_FORBIDDEN/);
  assert.throws(()=>selectNativeAdapter([{adapter_id:'paid',interface_kind:'OPEN_CODE_NATIVE_HTTP',qualified:true,paid_fallback_allowed:true,incremental_usd:1,binary_required:false,binary_present:true,capabilities:['build'],route:'api-paid'}],['build']),/NO_QUALIFIED_ZERO_COST_ADAPTER/);
  const noTrigger=evaluateObjectiveAdvisorTriggers({same_failure_signature_count:0});assert.equal(noTrigger.triggered,false);
  const permit=evaluateAdvisorPermit({trigger_codes:['T1'],root_task_id:contract.root_task_id,calls_used:0,quota_state:'AVAILABLE',route:'SUBSCRIPTION_AUTHORIZED',incremental_usd:0,zen_paid_fallback:false});
  assert.equal(permit.incremental_usd,0);assert.equal(permit.paid_fallback_allowed,false);
});

test('wrong candidate tree cannot pass exact verifier binding',()=>{
  const {verifier_digest,receipt}=verifierReceipt();
  assert.throws(()=>admitVerifierOutcome(receipt,{candidate_commit:'c'.repeat(40),candidate_tree:'e'.repeat(40),worktree_root:path.resolve('/tmp/v48-n1'),cwd:path.resolve('/tmp/v48-n1/candidate'),contract_digest:contract.contract_digest,verifier_digest,candidate_verdict:'PASS',candidate_exit_code:0,tests_total:1,tests_pass:1,tests_fail:0,tests_skipped:0}),/VERIFIER_BINDING_MISMATCH_CANDIDATE_TREE/);
});
