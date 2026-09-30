import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor, providerSecretKeys, type Envelope, type RecoveryObservation, type LocalLivenessComponent } from '../src/core.ts';

const project='CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ptysd-b0-'));
const env=(id='T1',epoch=0):Envelope=>({schema:'PTYSD_TASK_ENVELOPE_V1',task_id:id,project_id:project,interrupt_epoch:epoch,objective:'test',provider_write:false,allowed_paths:['sandbox/**'],evidence_required:['TEST_PASS'],provider:'local-supervisor'});
const throws=(fn:()=>any,msg:string)=>assert.throws(fn,new RegExp(msg));
const emptyObservation=(s:Supervisor,t:number):RecoveryObservation=>{
  const context=s.runtime().recovery_context!;
  const observationId='OBS-EMPTY-1';
  const identity={
    project_id:project,provider:context.provider,task_id:context.task_id,
    attempt_id:context.attempt_id,attempt_epoch:context.attempt_epoch,
    owner_generation:context.owner_generation,fingerprint:context.fingerprint,
  };
  const component=(name:string,source:string,state:string):LocalLivenessComponent=>({
    observation_id:`LOCAL-${name.toUpperCase()}-1`,provider_observation_id:observationId,
    ...identity,observed_at:new Date(t).toISOString(),source,state,
  });
  return {
    observation_id:observationId,status:'OBSERVED_EMPTY',project_id:project,provider:context.provider,provider_job_id:null,
    attempt_id:context.attempt_id,attempt_epoch:context.attempt_epoch,owner_generation:context.owner_generation,
    fingerprint:context.fingerprint,observed_at:new Date(t).toISOString(),source:'authorized-test-readback',state:'NONE',
    evidence_ref:'provider://test/readback/empty-1',evidence_digest:`sha256:${'a'.repeat(64)}`,
    local_liveness_observation:{
      observation_id:'LOCAL-OBS-1',provider_observation_id:observationId,...identity,
      observed_at:new Date(t).toISOString(),source:'authorized-cross-source-liveness-readback',
      evidence_ref:'host://test/readback/liveness-1',evidence_digest:`sha256:${'b'.repeat(64)}`,
      components:{
        os_process:component('os-process','local-os-process-readback','ABSENT'),
        provider_agent_session:component('provider-agent-session','provider-agent-session-readback','TERMINAL'),
        supervisor_heartbeat:component('supervisor-heartbeat','host-supervisor-heartbeat-readback','EXPIRED'),
      },
    },
  };
};

test('WAL + persist-before-dispatch + deterministic hash',()=>{
  const d=tmp(), db=path.join(d,'s.db'), s=new Supervisor(db); assert.equal(s.journalMode(),'wal'); s.ingest(env());
  const kinds=(s.events() as any[]).map(x=>x.kind); assert.deepEqual(kinds.slice(0,2),['INIT','TASK_PERSISTED']);
  const h1=s.stateHash(); s.close(); const r=new Supervisor(db); assert.equal(r.stateHash(),h1); r.dispatch('T1','W1',60000);
  const kinds2=(r.events() as any[]).map(x=>x.kind); assert.ok(kinds2.indexOf('TASK_PERSISTED')<kinds2.indexOf('WORKER_DISPATCHED')); r.close();
});

test('single worker + pending barrier + evidence completion',()=>{
  const s=new Supervisor(path.join(tmp(),'s.db')); s.ingest(env('A')); s.ingest(env('B'));
  s.setPending('OP-1'); throws(()=>s.dispatch('A','W1'),'PENDING_SIDE_EFFECT_BARRIER'); s.clearPending('OP-1');
  s.dispatch('A','W1',60000); throws(()=>s.dispatch('B','W2'),'ACTIVE_WORKER_CONFLICT');
  throws(()=>s.complete('A','W1',[]),'EVIDENCE_MISSING'); s.complete('A','W1',['TEST_PASS']);
  assert.equal(s.snapshot().tasks.find(x=>x.task_id==='A')?.state,'COMPLETED'); s.close();
});

test('STOP increments epoch, rejects old envelope, and does not bypass recovery',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env('A',0)); s.dispatch('A','W1',60000); s.stop();
  assert.equal(s.runtime().interrupt_epoch,1); assert.equal(s.runtime().stopped,true); assert.equal(s.runtime().recovery_required,true); s.resume();
  throws(()=>s.ingest(env('OLD',0)),'STALE_INTERRUPT_EPOCH'); s.ingest(env('NEW',1));
  throws(()=>s.dispatch('NEW','W2',60000),'RECOVERY_REQUIRED');
  s.resolveRecovery(emptyObservation(s,t)); s.dispatch('NEW','W2',60000); s.close();
});

test('interrupt is atomic and cannot clear recovery latch',()=>{
  const db=path.join(tmp(),'s.db'); let s=new Supervisor(db); s.ingest(env()); s.dispatch('T1','W1',60000);
  s.db.exec("CREATE TRIGGER fail_interrupt BEFORE INSERT ON events WHEN NEW.kind='WORKER_INTERRUPTED' BEGIN SELECT RAISE(ABORT,'injected interrupt fault'); END;");
  throws(()=>s.interrupt('TEST'),'injected interrupt fault');
  assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_task,'T1'); assert.equal(s.runtime().active_worker,'W1'); s.close();
  s=new Supervisor(db); assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_worker,'W1');
  s.db.exec('DROP TRIGGER fail_interrupt'); s.interrupt('TEST');
  assert.equal(s.runtime().interrupt_epoch,0); assert.equal(s.runtime().active_worker,null); assert.equal(s.runtime().recovery_required,true); assert.equal(s.snapshot().tasks[0].state,'INTERRUPTED'); s.close();
});

test('lease expiry transition is one crash-atomic SQLite transaction',()=>{
  let t=1000; const db=path.join(tmp(),'s.db'); let s=new Supervisor(db,project,()=>t);
  s.ingest(env()); s.dispatch('T1','W1',100); t=1200;
  s.db.exec("CREATE TRIGGER fail_stale BEFORE INSERT ON events WHEN NEW.kind='EXECUTOR_STALE' BEGIN SELECT RAISE(ABORT,'injected stale fault'); END;");
  throws(()=>s.tick(),'injected stale fault');
  assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_task,'T1'); assert.equal(s.runtime().active_worker,'W1');
  assert.equal(s.runtime().worker_lease_expires_at_ms,1100); assert.equal(s.runtime().recovery_required,false); s.close();
  s=new Supervisor(db,project,()=>t);
  assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_task,'T1'); assert.equal(s.runtime().active_worker,'W1');
  assert.equal(s.runtime().recovery_required,false); s.db.exec('DROP TRIGGER fail_stale');
  const stale=s.tick() as any; assert.equal(stale.worker,'W1'); assert.equal(s.runtime().active_task,null); assert.equal(s.runtime().active_worker,null);
  assert.equal(s.runtime().worker_lease_expires_at_ms,0); assert.equal(s.runtime().recovery_required,true); assert.equal(s.snapshot().tasks[0].state,'LEASE_EXPIRED');
  const event=(s.events() as any[]).filter(x=>x.kind==='EXECUTOR_STALE'); assert.equal(event.length,1); s.close();
});

test('verified recovery resolution is durable, exact, and separate from one next dispatch',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200;
  s.tick(); assert.equal(s.runtime().recovery_required,true);
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED');
  const observation=emptyObservation(s,t);
  throws(()=>s.resolveRecovery({...observation,owner_generation:observation.owner_generation+1}),'RECOVERY_IDENTITY_MISMATCH');
  s.setPending('OP-PENDING'); throws(()=>s.resolveRecovery(observation),'PENDING_SIDE_EFFECT_BARRIER'); s.clearPending('OP-PENDING');
  s.db.exec("CREATE TRIGGER fail_resolution BEFORE INSERT ON events WHEN NEW.kind='RECOVERY_RESOLVED' BEGIN SELECT RAISE(ABORT,'injected resolution fault'); END;");
  throws(()=>s.resolveRecovery(observation),'injected resolution fault');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0); s.db.exec('DROP TRIGGER fail_resolution');
  const receipt=s.resolveRecovery(observation); assert.equal(receipt.result,'RESOLVED'); assert.equal(s.runtime().recovery_required,false);
  assert.equal(s.recoveryReceipts().length,1); throws(()=>s.resolveRecovery(observation),'RECOVERY_NOT_REQUIRED');
  const resolvedIndex=(s.events() as any[]).findIndex(x=>x.kind==='RECOVERY_RESOLVED'); s.dispatch('T2','W2',60000);
  const dispatchedIndex=(s.events() as any[]).findIndex(x=>x.kind==='WORKER_DISPATCHED' && JSON.parse(x.detail).task_id==='T2');
  assert.ok(resolvedIndex>=0 && dispatchedIndex>resolvedIndex);
  throws(()=>s.dispatch('T2','W3',60000),'ACTIVE_WORKER_CONFLICT'); s.complete('T2','W2',['TEST_PASS']);
  throws(()=>s.dispatch('T2','W3',60000),'ILLEGAL_TASK_TRANSITION');
  assert.equal((s.events() as any[]).filter(x=>x.kind==='WORKER_DISPATCHED' && JSON.parse(x.detail).task_id==='T2').length,1); s.close();
});

test('recovery resolution accepts only fresh empty or explicitly reconciled terminal job identity',()=>{
  let t=1000; const d=tmp(), db=path.join(d,'s.db'); let s=new Supervisor(db,project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1200; s.tick();
  const observation=emptyObservation(s,t);
  throws(()=>s.resolveRecovery({...observation,observed_at:new Date(t-31000).toISOString()}),'LIVE_OBSERVATION_STALE');
  throws(()=>s.resolveRecovery({...observation,status:'OBSERVED_JOB',provider_job_id:'JOB-1',state:'IN_PROGRESS'}),'LIVE_JOB_RECONCILIATION_REQUIRED');
  const receipt=s.resolveRecovery({...observation,status:'OBSERVED_JOB',provider_job_id:'JOB-1',state:'FAILED',reconciled_terminal:true,reconciliation_ref:'provider://test/reconciliation/1'});
  assert.equal(receipt.result,'RESOLVED'); assert.equal(s.runtime().recovery_required,false); s.close();
});

test('provider empty observation alone cannot resolve stale owner recovery or dispatch',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200; s.tick();
  const observation=emptyObservation(s,t); delete observation.local_liveness_observation;
  throws(()=>s.resolveRecovery(observation),'LOCAL_OWNER_LIVENESS_REQUIRED');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED'); s.close();
});

test('stale owner recovery requires exact fresh independent process, session, and heartbeat observations',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1200; s.tick();
  const valid=emptyObservation(s,t);
  const clone=()=>JSON.parse(JSON.stringify(valid)) as RecoveryObservation;
  const cases:[string,(observation:RecoveryObservation)=>void][]=[
    ['LOCAL_OWNER_LIVENESS_COMPONENTS_INVALID',o=>{ delete o.local_liveness_observation!.components.supervisor_heartbeat; }],
    ['LOCAL_OWNER_LIVENESS_STALE',o=>{ o.local_liveness_observation!.components.os_process.observed_at=new Date(t-31000).toISOString(); }],
    ['LOCAL_OWNER_LIVENESS_STATE_MISMATCH',o=>{ o.local_liveness_observation!.components.provider_agent_session.state='ACTIVE'; }],
    ['LOCAL_OWNER_LIVENESS_IDENTITY_MISMATCH',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.owner_generation++; }],
    ['LOCAL_OWNER_LIVENESS_PROVIDER_OBSERVATION_MISMATCH',o=>{ o.local_liveness_observation!.provider_observation_id='OBS-OTHER'; }],
    ['LOCAL_OWNER_LIVENESS_SOURCE_MISMATCH',o=>{ o.local_liveness_observation!.components.os_process.source='generic-process-list'; }],
    ['LOCAL_OWNER_LIVENESS_OBSERVATION_ID_REUSED',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.observation_id=o.local_liveness_observation!.components.os_process.observation_id; }],
  ];
  for(const [code,mutate] of cases){
    const observation=clone(); mutate(observation); throws(()=>s.resolveRecovery(observation),code);
    assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  }
  const receipt=s.resolveRecovery(valid); assert.equal(receipt.result,'RESOLVED');
  assert.equal(s.runtime().recovery_required,false); assert.equal(s.recoveryReceipts().length,1); s.close();
});

test('worker provider credential guard',()=>{
  assert.deepEqual(providerSecretKeys({PATH:'x'}),[]);
  assert.deepEqual(providerSecretKeys({PATH:'x',GITHUB_TOKEN:'secret'}),['GITHUB_TOKEN']);
});

test('runtime manifest disables provider write and carries no worker credentials',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'config','runtime-manifest.json'),'utf8'));
  assert.equal(manifest.provider_write_enabled,false); assert.deepEqual(manifest.worker_provider_credentials,[]); assert.equal(manifest.active_workers_max,1);
});

test('expired lease cannot be revived by heartbeat or completion',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1101;
  throws(()=>s.heartbeat('W1',100),'WORKER_LEASE_EXPIRED'); throws(()=>s.complete('T1','W1',['TEST_PASS']),'WORKER_LEASE_EXPIRED');
  const stale=s.tick() as any; assert.equal(stale.worker,'W1'); assert.equal(s.runtime().recovery_required,true); s.close();
});
