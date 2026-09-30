import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor, providerSecretKeys, type Envelope, type RecoveryObservation, type LocalLivenessComponent, type LocalLivenessObservation, type RecoveryEvidenceKeySet, type RecoveryEvidenceTrust } from '../src/core.ts';
import { createImmutableEvidenceReader, createImmutableEvidenceWriter, createProviderSessionReadRoute, createRecoveryEvidenceComposition, createSupervisorHeartbeatReadRoute } from '../src/recovery-evidence.ts';

const project='CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ptysd-b0-'));
const env=(id='T1',epoch=0):Envelope=>({schema:'PTYSD_TASK_ENVELOPE_V1',task_id:id,project_id:project,interrupt_epoch:epoch,objective:'test',provider_write:false,allowed_paths:['sandbox/**'],evidence_required:['TEST_PASS'],provider:'local-supervisor',owner_principal_id:'owner-'+id,owner_session_id:'session-'+id,provider_session_id:'provider-session-'+id});
const throws=(fn:()=>any,msg:string)=>assert.throws(fn,new RegExp(msg));
const evidenceBlobs=new Map<string,Uint8Array>();
const providerKeyPair=generateKeyPairSync('ed25519');
const localKeyPair=generateKeyPairSync('ed25519');
const heartbeatKeyPair=generateKeyPairSync('ed25519');
const testEvidenceKeys:RecoveryEvidenceKeySet={
  providerPublicKeys:{'test-provider':providerKeyPair.publicKey},
  localPublicKeys:{'test-local':localKeyPair.publicKey},
  supervisorHeartbeatPublicKeys:{'test-heartbeat':heartbeatKeyPair.publicKey},
};
const evidenceTrust:RecoveryEvidenceTrust={
  readEvidence:reference=>evidenceBlobs.get(reference),
  readCurrentTrustRoots:()=>testEvidenceKeys,
};
const testSupervisor=(dbPath:string,projectId=project,clock=()=>Date.now())=>new Supervisor(dbPath,projectId,clock,evidenceTrust);
let evidenceSequence=0;
const stableEvidence=(value:any):any=>Array.isArray(value)?value.map(stableEvidence):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableEvidence(value[key])])):value;
const writeSignedEvidence=(kind:'provider'|'local'|'supervisor-heartbeat',reference:string,payload:Record<string,unknown>)=>{
  const schema=kind==='provider'?'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1':kind==='local'?'PTYSD_LOCAL_LIVENESS_EVIDENCE_V1':'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1';
  const issuer_key_id=kind==='provider'?'test-provider':kind==='local'?'test-local':'test-heartbeat';
  const signedBody={schema,issuer_key_id,payload:stableEvidence(payload)};
  const privateKey=kind==='provider'?providerKeyPair.privateKey:kind==='local'?localKeyPair.privateKey:heartbeatKeyPair.privateKey;
  const signature=sign(null,Buffer.from(JSON.stringify(stableEvidence(signedBody))),privateKey).toString('base64');
  const bytes=Buffer.from(JSON.stringify({...signedBody,signature}));
  evidenceBlobs.set(reference,bytes);
  return 'sha256:'+createHash('sha256').update(bytes).digest('hex');
};
const nextEvidenceRef=(kind:'provider'|'local'|'supervisor-heartbeat')=>`recovery://${kind}/${String(++evidenceSequence).padStart(32,'0')}`;
const signProviderEvidence=(observation:RecoveryObservation)=>{
  const reference=nextEvidenceRef('provider');
  observation.evidence_ref=reference;
  const {local_liveness_observation:_local,evidence_digest:_digest,...payload}=observation;
  observation.evidence_digest=writeSignedEvidence('provider',reference,payload);
};
const signLocalEvidence=(local:LocalLivenessObservation)=>{
  const reference=nextEvidenceRef('local');
  local.evidence_ref=reference;
  const {evidence_digest:_digest,...payload}=local;
  local.evidence_digest=writeSignedEvidence('local',reference,payload);
};
const signHeartbeatEvidence=(heartbeat:LocalLivenessComponent)=>{
  const reference=nextEvidenceRef('supervisor-heartbeat');
  heartbeat.heartbeat_evidence_ref=reference;
  const {heartbeat_evidence_ref:_reference,heartbeat_evidence_digest:_digest,...payload}=heartbeat;
  heartbeat.heartbeat_evidence_digest=writeSignedEvidence('supervisor-heartbeat',reference,payload);
};
const emptyObservation=(s:Supervisor,t:number):RecoveryObservation=>{
  const context=s.runtime().recovery_context!;
  const observationId='OBS-EMPTY-'+String(++evidenceSequence);
  const identity={
    project_id:project,provider:context.provider,task_id:context.task_id,
    attempt_id:context.attempt_id,attempt_epoch:context.attempt_epoch,
    owner_generation:context.owner_generation,fingerprint:context.fingerprint,
    owner_principal_id:context.owner_principal_id,owner_session_id:context.owner_session_id,
    provider_session_id:context.provider_session_id,
  };
  const component=(name:string,source:string,state:string):LocalLivenessComponent=>({
    observation_id:'LOCAL-'+name.toUpperCase()+'-'+String(evidenceSequence),provider_observation_id:observationId,
    ...identity,observed_at:new Date(t).toISOString(),source,state,
  });
  const observation:RecoveryObservation={
    observation_id:observationId,status:'OBSERVED_EMPTY',project_id:project,provider:context.provider,task_id:context.task_id,provider_job_id:null,
    owner_principal_id:context.owner_principal_id,owner_session_id:context.owner_session_id,provider_session_id:context.provider_session_id,
    attempt_id:context.attempt_id,attempt_epoch:context.attempt_epoch,owner_generation:context.owner_generation,
    fingerprint:context.fingerprint,observed_at:new Date(t).toISOString(),source:'authorized-test-readback',state:'NONE',
    evidence_ref:'',evidence_digest:'',
    local_liveness_observation:{
      observation_id:'LOCAL-OBS-'+String(evidenceSequence),provider_observation_id:observationId,...identity,
      owner_principal_id:context.owner_principal_id,owner_session_id:context.owner_session_id,provider_session_id:context.provider_session_id,
      observed_at:new Date(t).toISOString(),source:'authorized-cross-source-liveness-readback',
      evidence_ref:'',evidence_digest:'',
      components:{
        os_process:component('os-process','local-os-process-readback','ABSENT'),
        provider_agent_session:{...component('provider-agent-session','provider-agent-session-readback','TERMINAL'),provider_session_id:context.provider_session_id,provider_job_id:null},
        supervisor_heartbeat:{...component('supervisor-heartbeat','host-supervisor-heartbeat-readback','EXPIRED'),
          supervisor_id:'PTYSD-HOST-SUPERVISOR',heartbeat_id:'HEARTBEAT-'+String(evidenceSequence),
          heartbeat_at_utc:new Date(t-1000).toISOString(),boot_identity:'boot-test-1',process_identity:'pid:4242',
          service_identity:'PTYSD-Supervisor:LocalSystem',task_identity:context.task_id,
          heartbeat_evidence_ref:'',heartbeat_evidence_digest:''},
      },
    },
  };
  signHeartbeatEvidence(observation.local_liveness_observation!.components.supervisor_heartbeat);
  signLocalEvidence(observation.local_liveness_observation!);
  signProviderEvidence(observation);
  return observation;
};
test('WAL + persist-before-dispatch + deterministic hash',()=>{
  const d=tmp(), db=path.join(d,'s.db'), s=testSupervisor(db); assert.equal(s.journalMode(),'wal'); s.ingest(env());
  const kinds=(s.events() as any[]).map(x=>x.kind); assert.deepEqual(kinds.slice(0,2),['INIT','TASK_PERSISTED']);
  const h1=s.stateHash(); s.close(); const r=testSupervisor(db); assert.equal(r.stateHash(),h1); r.dispatch('T1','W1',60000);
  const kinds2=(r.events() as any[]).map(x=>x.kind); assert.ok(kinds2.indexOf('TASK_PERSISTED')<kinds2.indexOf('WORKER_DISPATCHED')); r.close();
});

test('ingest requires exact owner and provider session identity before execution can begin',()=>{
  const s=testSupervisor(path.join(tmp(),'s.db'));
  const missingSession={...env('NO-SESSION')} as any; delete missingSession.provider_session_id;
  throws(()=>s.ingest(missingSession),'EXACT_EXECUTION_SESSION_IDENTITY_REQUIRED');
  assert.equal(s.snapshot().tasks.length,0); s.close();
});

test('single worker + pending barrier + evidence completion',()=>{
  const s=testSupervisor(path.join(tmp(),'s.db')); s.ingest(env('A')); s.ingest(env('B'));
  s.setPending('OP-1'); throws(()=>s.dispatch('A','W1'),'PENDING_SIDE_EFFECT_BARRIER'); s.clearPending('OP-1');
  s.dispatch('A','W1',60000); throws(()=>s.dispatch('B','W2'),'ACTIVE_WORKER_CONFLICT');
  throws(()=>s.complete('A','W1',[]),'EVIDENCE_MISSING'); s.complete('A','W1',['TEST_PASS']);
  assert.equal(s.snapshot().tasks.find(x=>x.task_id==='A')?.state,'COMPLETED'); s.close();
});

test('STOP increments epoch and permanently rejects old envelope',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env('A',0)); s.dispatch('A','W1',60000); s.stop();
  assert.equal(s.runtime().interrupt_epoch,1); assert.equal(s.runtime().stopped,true); assert.equal(s.runtime().recovery_required,true); s.resume();
  throws(()=>s.ingest(env('OLD',0)),'STALE_INTERRUPT_EPOCH'); s.ingest(env('NEW',1));
  throws(()=>s.dispatch('NEW','W2',60000),'RECOVERY_REQUIRED');
  s.resolveRecovery(emptyObservation(s,t)); s.dispatch('NEW','W2',60000); s.close();
});

test('interrupt releases worker without changing epoch',()=>{
  const db=path.join(tmp(),'s.db'); let s=testSupervisor(db); s.ingest(env()); s.dispatch('T1','W1',60000);
  s.db.exec("CREATE TRIGGER fail_interrupt BEFORE INSERT ON events WHEN NEW.kind='WORKER_INTERRUPTED' BEGIN SELECT RAISE(ABORT,'injected interrupt fault'); END;");
  throws(()=>s.interrupt('TEST'),'injected interrupt fault');
  assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_task,'T1'); assert.equal(s.runtime().active_worker,'W1'); s.close();
  s=testSupervisor(db); assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_worker,'W1');
  s.db.exec('DROP TRIGGER fail_interrupt'); s.interrupt('TEST');
  assert.equal(s.runtime().interrupt_epoch,0); assert.equal(s.runtime().active_worker,null); assert.equal(s.runtime().recovery_required,true); assert.equal(s.snapshot().tasks[0].state,'INTERRUPTED'); s.close();
});

test('crash restart preserves lease then expiry only reduces capability',()=>{
  let t=1000; const db=path.join(tmp(),'s.db'); let s=testSupervisor(db,project,()=>t);
  s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200;
  s.db.exec("CREATE TRIGGER fail_stale BEFORE INSERT ON events WHEN NEW.kind='EXECUTOR_STALE' BEGIN SELECT RAISE(ABORT,'injected stale fault'); END;");
  throws(()=>s.tick(),'injected stale fault');
  assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_task,'T1'); assert.equal(s.runtime().active_worker,'W1');
  assert.equal(s.runtime().worker_lease_expires_at_ms,1100); assert.equal(s.runtime().recovery_required,false); s.close();
  s=testSupervisor(db,project,()=>t);
  assert.equal(s.snapshot().tasks[0].state,'RUNNING'); assert.equal(s.runtime().active_task,'T1'); assert.equal(s.runtime().active_worker,'W1');
  assert.equal(s.runtime().recovery_required,false); s.db.exec('DROP TRIGGER fail_stale');
  const stale=s.tick() as any; assert.equal(stale.worker,'W1'); assert.equal(s.runtime().active_task,null); assert.equal(s.runtime().active_worker,null);
  assert.equal(s.runtime().worker_lease_expires_at_ms,0); assert.equal(s.runtime().recovery_required,true); assert.equal(s.snapshot().tasks[0].state,'LEASE_EXPIRED');
  const event=(s.events() as any[]).filter(x=>x.kind==='EXECUTOR_STALE'); assert.equal(event.length,1);
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED'); s.close();
});

test('verified recovery resolution is durable, exact, and separate from one next dispatch',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200;
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
  let t=1000; const d=tmp(), db=path.join(d,'s.db'); let s=testSupervisor(db,project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1200; s.tick();
  const observation=emptyObservation(s,t);
  throws(()=>s.resolveRecovery({...observation,observed_at:new Date(t-31000).toISOString()}),'LIVE_OBSERVATION_STALE');
  throws(()=>s.resolveRecovery({...observation,status:'OBSERVED_JOB',provider_job_id:'JOB-1',state:'IN_PROGRESS'}),'LIVE_JOB_RECONCILIATION_REQUIRED');
  const terminalObservation={...observation,status:'OBSERVED_JOB' as const,provider_job_id:'JOB-1',state:'FAILED',reconciled_terminal:true,reconciliation_ref:'provider://test/reconciliation/1'};
  terminalObservation.local_liveness_observation!.components.provider_agent_session.provider_job_id='JOB-1';
  signLocalEvidence(terminalObservation.local_liveness_observation!); signProviderEvidence(terminalObservation);
  const receipt=s.resolveRecovery(terminalObservation);
  assert.equal(receipt.result,'RESOLVED'); assert.equal(s.runtime().recovery_required,false); s.close();
});

test('stale attempts and unreconciled or unsupported observed jobs stay readback-only',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200; s.tick();
  const staleAttempt=emptyObservation(s,t);
  staleAttempt.status='OBSERVED_JOB'; staleAttempt.provider_job_id='JOB-STALE'; staleAttempt.state='FAILED';
  staleAttempt.attempt_id='OLDER-ATTEMPT'; staleAttempt.attempt_epoch=staleAttempt.attempt_epoch-1;
  throws(()=>s.resolveRecovery(staleAttempt),'RECOVERY_IDENTITY_MISMATCH');
  for(const state of ['FAILED','CANCELLED','TIMED_OUT','ORPHANED','UNKNOWN','IN_PROGRESS']){
    const observation=emptyObservation(s,t);
    observation.status='OBSERVED_JOB'; observation.provider_job_id=`JOB-${state}`; observation.state=state;
    throws(()=>s.resolveRecovery(observation),'LIVE_JOB_RECONCILIATION_REQUIRED');
    assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  }
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0); s.close();
});

test('provider empty observation alone cannot resolve stale owner recovery or dispatch',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200; s.tick();
  const observation=emptyObservation(s,t); delete observation.local_liveness_observation;
  throws(()=>s.resolveRecovery(observation),'LOCAL_OWNER_LIVENESS_REQUIRED');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED'); s.close();
});

test('caller-shaped evidence cannot clear recovery without a trusted evidence authority',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200; s.tick();
  const observation=emptyObservation(s,t);
  throws(()=>s.resolveRecovery(observation),'TRUSTED_RECOVERY_EVIDENCE_SOURCE_UNAVAILABLE');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED'); s.close();
});

test('recovery evidence verifies durable bytes, trusted signatures, and exact submitted payloads',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.ingest(env('T2')); s.dispatch('T1','W1',100); t=1200; s.tick();
  const valid=emptyObservation(s,t);
  const original=evidenceBlobs.get(valid.evidence_ref)!;
  evidenceBlobs.set(valid.evidence_ref,Buffer.concat([Buffer.from(original),Buffer.from(' ')]));
  throws(()=>s.resolveRecovery(valid),'RECOVERY_EVIDENCE_DIGEST_MISMATCH');
  evidenceBlobs.set(valid.evidence_ref,original);
  const altered={...valid,source:'caller-invented-readback'};
  throws(()=>s.resolveRecovery(altered),'RECOVERY_EVIDENCE_PAYLOAD_MISMATCH');
  const parsed=JSON.parse(Buffer.from(original).toString('utf8'));
  parsed.payload.source='forged-source';
  const forgedBytes=Buffer.from(JSON.stringify(parsed));
  evidenceBlobs.set(valid.evidence_ref,forgedBytes);
  const forged={...valid,evidence_digest:'sha256:'+createHash('sha256').update(forgedBytes).digest('hex')};
  throws(()=>s.resolveRecovery(forged),'RECOVERY_EVIDENCE_UNTRUSTED');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  throws(()=>s.dispatch('T2','W2',60000),'RECOVERY_REQUIRED'); s.close();
});
test('stale owner recovery requires exact fresh independent process, session, and heartbeat observations',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1200; s.tick();
  const valid=emptyObservation(s,t);
  const clone=()=>JSON.parse(JSON.stringify(valid)) as RecoveryObservation;
  const cases:[string,(observation:RecoveryObservation)=>void][]=[
    ['LOCAL_OWNER_LIVENESS_COMPONENTS_INVALID',o=>{ delete o.local_liveness_observation!.components.supervisor_heartbeat; }],
    ['LOCAL_OWNER_LIVENESS_STALE',o=>{ o.local_liveness_observation!.components.os_process.observed_at=new Date(t-31000).toISOString(); }],
    ['LOCAL_OWNER_LIVENESS_STATE_MISMATCH',o=>{ o.local_liveness_observation!.components.provider_agent_session.state='ACTIVE'; }],
    ['LOCAL_OWNER_LIVENESS_IDENTITY_MISMATCH',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.owner_generation++; }],
    ['LOCAL_OWNER_LIVENESS_STALE',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.observed_at=new Date(t-31000).toISOString(); }],
    ['LOCAL_OWNER_LIVENESS_PROVIDER_OBSERVATION_MISMATCH',o=>{ o.local_liveness_observation!.provider_observation_id='OBS-OTHER'; }],
    ['LOCAL_OWNER_LIVENESS_SOURCE_MISMATCH',o=>{ o.local_liveness_observation!.components.os_process.source='generic-process-list'; }],
    ['LOCAL_OWNER_LIVENESS_OBSERVATION_ID_REUSED',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.observation_id=o.local_liveness_observation!.components.os_process.observation_id; }],
    ['RECOVERY_IDENTITY_MISMATCH',o=>{ o.owner_session_id='other-session'; }],
    ['LOCAL_OWNER_LIVENESS_IDENTITY_MISMATCH',o=>{ o.local_liveness_observation!.components.provider_agent_session.provider_session_id='other-provider-session'; }],
    ['PROVIDER_SESSION_BINDING_MISMATCH',o=>{ o.local_liveness_observation!.components.provider_agent_session.provider_job_id='unexpected-job'; }],
    ['SUPERVISOR_HEARTBEAT_EVIDENCE_REQUIRED',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.heartbeat_at_utc=new Date(t-31000).toISOString(); }],
    ['SUPERVISOR_HEARTBEAT_EVIDENCE_REQUIRED',o=>{ o.local_liveness_observation!.components.supervisor_heartbeat.heartbeat_at_utc=new Date(t+1000).toISOString(); }],
  ];
  for(const [code,mutate] of cases){
    const observation=clone(); mutate(observation); throws(()=>s.resolveRecovery(observation),code);
    assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0);
  }
  const receipt=s.resolveRecovery(valid); assert.equal(receipt.result,'RESOLVED');
  assert.equal(s.runtime().recovery_required,false); assert.equal(s.recoveryReceipts().length,1); s.close();
});

test('a wrong heartbeat trust key or a changed heartbeat payload cannot clear the recovery latch',()=>{
  let t=1000; const db=path.join(tmp(),'s.db'); let s=testSupervisor(db,project,()=>t);
  s.ingest(env()); s.dispatch('T1','W1',100); t=1200; s.tick(); const valid=emptyObservation(s,t); s.close();
  const wrongKeys:RecoveryEvidenceKeySet={...testEvidenceKeys,supervisorHeartbeatPublicKeys:{}};
  const wrongKeyTrust:RecoveryEvidenceTrust={readEvidence:evidenceTrust.readEvidence,readCurrentTrustRoots:()=>wrongKeys};
  s=new Supervisor(db,project,()=>t,wrongKeyTrust);
  throws(()=>s.resolveRecovery(valid),'RECOVERY_EVIDENCE_UNTRUSTED');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0); s.close();
  const changed=JSON.parse(JSON.stringify(valid)) as RecoveryObservation;
  changed.local_liveness_observation!.components.supervisor_heartbeat.heartbeat_id='HEARTBEAT-FORGED';
  s=testSupervisor(db,project,()=>t);
  throws(()=>s.resolveRecovery(changed),'RECOVERY_EVIDENCE_PAYLOAD_MISMATCH');
  assert.equal(s.runtime().recovery_required,true); assert.equal(s.recoveryReceipts().length,0); s.close();
});

test('worker provider credential guard',()=>{
  assert.deepEqual(providerSecretKeys({PATH:'x'}),[]);
  assert.deepEqual(providerSecretKeys({PATH:'x',GITHUB_TOKEN:'secret'}),['GITHUB_TOKEN']);
});

test('runtime manifest disables provider write and carries no worker credentials',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'config','runtime-manifest.json'),'utf8'));
  assert.equal(manifest.provider_write_enabled,false); assert.deepEqual(manifest.worker_provider_credentials,[]); assert.equal(manifest.active_workers_max,1);
  assert.equal(manifest.recovery_evidence.store.route_id,'PTYSD_FACTORY_MCP_RECOVERY_EVIDENCE_STORE_V1');
  assert.equal(manifest.recovery_evidence.store.relative_path,undefined);
  assert.equal(manifest.recovery_evidence.publication.route_id,'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1');
  assert.equal(manifest.recovery_evidence.publication.relative_path,undefined);
});

test('default recovery composition records unavailable source routes and keeps resolution parked',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const composition=createRecoveryEvidenceComposition(path.join(root,'config','runtime-manifest.json'),project);
  const status=composition.dependencyStatus();
  assert.equal(status.publication.status,'UNAVAILABLE');
  assert.equal(status.publication.route_id,'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1');
  assert.equal(status.provider_session.status,'UNAVAILABLE');
  assert.equal(status.provider_session.reason_code,'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED');
  assert.equal(status.supervisor_heartbeat.status,'UNAVAILABLE');
  assert.equal(status.supervisor_heartbeat.reason_code,'SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED');
  assert.equal(status.active_provider_trust_keys,0); assert.equal(status.active_local_trust_keys,0);
  assert.equal(status.active_supervisor_heartbeat_trust_keys,0);
  throws(()=>composition.readCurrentObservation(),'OWNER_LIVENESS_PUBLICATION_UNAVAILABLE');
});

test('immutable evidence reader accepts only bounded recovery references, never caller paths',()=>{
  const root=tmp(); const reference='recovery://provider/0123456789abcdef0123456789abcdef';
  const objectDir=path.join(root,'objects','provider'); fs.mkdirSync(objectDir,{recursive:true});
  const bytes=Buffer.from('{"schema":"test"}');
  fs.writeFileSync(path.join(objectDir,'0123456789abcdef0123456789abcdef.json'),bytes,{flag:'wx'});
  const read=createImmutableEvidenceReader(root);
  assert.deepEqual(Buffer.from(read(reference)!),bytes);
  assert.equal(read('C:\\Windows\\win.ini'),undefined);
  assert.equal(read('recovery://provider/../../win.ini'),undefined);
  assert.equal(read('recovery://provider/0123456789abcdef0123456789abcdeg'),undefined);
});

test('immutable evidence writer flushes signed records, reads back identical bytes, and never overwrites an id',()=>{
  const root=tmp(), reference=`recovery://provider/${'f'.repeat(32)}`;
  const objects=path.join(root,'objects','provider'); fs.mkdirSync(objects,{recursive:true});
  const pair=generateKeyPairSync('ed25519');
  const body={schema:'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1',issuer_key_id:'writer-test',
    payload:{evidence_ref:reference,project_id:project,owner_generation:5}};
  const signature=sign(null,Buffer.from(JSON.stringify(stableEvidence(body))),pair.privateKey).toString('base64');
  const bytes=Buffer.from(JSON.stringify({...body,signature}));
  const write=createImmutableEvidenceWriter(root), read=createImmutableEvidenceReader(root);
  try {
    const digest=write(reference,bytes);
    assert.equal(digest,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(Buffer.from(read(reference)!),bytes);
    assert.throws(()=>write(reference,bytes),/RECOVERY_EVIDENCE_IMMUTABLE_REFERENCE_EXISTS/);
    const altered=Buffer.from(bytes); altered[altered.length-2]^=1;
    assert.throws(()=>write(`recovery://provider/${'0'.repeat(32)}`,altered),/RECOVERY_EVIDENCE_INVALID/);
    assert.deepEqual(Buffer.from(read(reference)!),bytes);
  } finally {
    const resolved=path.resolve(root), tempRoot=path.resolve(os.tmpdir()), stat=fs.lstatSync(path.resolve(root));
    assert.equal(stat.isDirectory(),true); assert.equal(stat.isSymbolicLink(),false); assert.equal(path.dirname(resolved),tempRoot);
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('fixed provider-session and Supervisor-heartbeat routes read exact bounded identity-bound records',()=>{
  const root=tmp(), providerPath=path.join(root,'provider-session-readback.json'), heartbeatPath=path.join(root,'supervisor-heartbeat-readback.json');
  const identity={project_id:project,provider:'codex',task_id:'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION',
    attempt_id:'V51-R2-02-ATTEMPT-002',attempt_epoch:2,owner_generation:5,fingerprint:'sha256:'+('a'.repeat(64)),
    owner_principal_id:'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',
    owner_session_id:'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',provider_session_id:'provider-session-gen5-test'};
  const provider={schema:'PTYSD_PROVIDER_SESSION_READBACK_V1',...identity,observation_id:'provider-observation-5',provider_job_id:null,
    observed_at:'2026-09-30T14:00:00.000Z',state:'TERMINAL',evidence_ref:`recovery://provider/${'b'.repeat(32)}`,evidence_digest:'sha256:'+('c'.repeat(64))};
  const heartbeat={schema:'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1',...identity,supervisor_id:'PTYSD-HOST-SUPERVISOR',
    heartbeat_id:'heartbeat-5-001',observed_at:'2026-09-30T14:00:00.000Z',heartbeat_at_utc:'2026-09-30T13:59:59.000Z',
    boot_identity:'boot-identity-5',process_identity:'pid:4242',service_identity:'PTYSD-Supervisor',task_identity:identity.task_id,
    evidence_ref:`recovery://supervisor-heartbeat/${'d'.repeat(32)}`,evidence_digest:'sha256:'+('e'.repeat(64))};
  try {
    fs.writeFileSync(providerPath,JSON.stringify(provider),{flag:'wx'});
    fs.writeFileSync(heartbeatPath,JSON.stringify(heartbeat),{flag:'wx'});
    const providerRoute=createProviderSessionReadRoute(root), heartbeatRoute=createSupervisorHeartbeatReadRoute(root);
    const providerResult=providerRoute.readExact(identity), heartbeatResult=heartbeatRoute.readExact(identity);
    assert.equal(providerResult.status,'AVAILABLE'); assert.equal(heartbeatResult.status,'AVAILABLE');
    if(providerResult.status==='AVAILABLE') assert.equal(providerResult.value.owner_generation,5);
    if(heartbeatResult.status==='AVAILABLE') assert.equal(heartbeatResult.value.task_identity,identity.task_id);
    assert.deepEqual(providerRoute.readExact({...identity,owner_generation:4}),
      {status:'UNAVAILABLE',reason_code:'PROVIDER_SESSION_IDENTITY_MISMATCH'});
    assert.deepEqual(heartbeatRoute.readExact({...identity,attempt_epoch:1}),
      {status:'UNAVAILABLE',reason_code:'SUPERVISOR_HEARTBEAT_IDENTITY_MISMATCH'});
    fs.writeFileSync(providerPath,JSON.stringify({...provider,caller_path:'C:\\\\Windows\\\\win.ini'}));
    assert.equal(providerRoute.readExact(identity).status,'UNAVAILABLE');
    fs.writeFileSync(heartbeatPath,JSON.stringify({...heartbeat,task_identity:'OTHER_TASK'}));
    assert.equal(heartbeatRoute.readExact(identity).status,'UNAVAILABLE');
  } finally {
    const resolved=path.resolve(root), tempRoot=path.resolve(os.tmpdir());
    const stat=fs.lstatSync(resolved);
    assert.equal(stat.isDirectory(),true); assert.equal(stat.isSymbolicLink(),false);
    assert.equal(path.dirname(resolved),tempRoot);
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('immutable evidence reader rejects Windows reparse-point object directories',{skip:process.platform!=='win32'},t=>{
  const root=tmp(), outside=tmp();
  fs.mkdirSync(path.join(outside,'provider'),{recursive:true});
  try { fs.symlinkSync(outside,path.join(root,'objects'),'junction'); }
  catch (error:any) {
    if (['EPERM','EACCES','ENOTSUP','UNKNOWN'].includes(error?.code)) return t.skip('junction creation is unavailable in this Windows environment');
    throw error;
  }
  const reference='recovery://provider/0123456789abcdef0123456789abcdef';
  const read=createImmutableEvidenceReader(root);
  assert.equal(read(reference),undefined);
});

test('published signed evidence composes into exact recovery while missing route keeps the latch closed',()=>{
  let t=1000; const root=tmp(), db=path.join(root,'runtime.db');
  const gen5Envelope:Envelope={...env('V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION'),provider:'codex',
    attempt_id:'V51-R2-02-ATTEMPT-002',attempt_epoch:2,
    owner_principal_id:'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',
    owner_session_id:'CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125',
    provider_session_id:'provider-session-gen5-test'};
  let seed=testSupervisor(db,project,()=>t); seed.ingest(gen5Envelope); seed.ingest(env('T2'));
  const priorRuntime=seed.runtime(); priorRuntime.worker_lease_generation=4;
  seed.db.prepare('UPDATE runtime SET data=? WHERE id=1').run(JSON.stringify(priorRuntime));
  seed.dispatch(gen5Envelope.task_id,'W1',100); t=1200; seed.tick();
  const observation=emptyObservation(seed,t); seed.close();
  assert.equal(observation.owner_generation,5);
  assert.equal(observation.task_id,'V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION');
  assert.equal(observation.attempt_id,'V51-R2-02-ATTEMPT-002');
  const local=observation.local_liveness_observation!;
  const stateDir=path.join(root,'state'); fs.mkdirSync(stateDir,{recursive:true});
  const storeRoot=path.join(stateDir,'recovery-evidence');
  const evidenceWriter=createImmutableEvidenceWriter(storeRoot);
  const writeObject=(reference:string)=>{
    const match=/^recovery:\/\/(provider|local|supervisor-heartbeat)\/([a-f0-9]{32})$/.exec(reference)!;
    const bytes=evidenceBlobs.get(reference)!; const directory=path.join(storeRoot,'objects',match[1]);
    fs.mkdirSync(directory,{recursive:true});
    return evidenceWriter(reference,bytes);
  };
  assert.equal(writeObject(observation.evidence_ref),observation.evidence_digest);
  assert.equal(writeObject(local.evidence_ref),local.evidence_digest);
  assert.equal(writeObject(local.components.supervisor_heartbeat.heartbeat_evidence_ref!),
    local.components.supervisor_heartbeat.heartbeat_evidence_digest);
  const providerSession=local.components.provider_agent_session;
  const heartbeat=local.components.supervisor_heartbeat;
  const publication={
    schema:'v51.factory.owner-liveness.publication.v1',read_status:'AVAILABLE',publisher_status:'PUBLISHED',
    recovery_evidence:{schema:'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',status:'AVAILABLE',
      provider:{evidence_ref:observation.evidence_ref,evidence_digest:observation.evidence_digest},
      local:{evidence_ref:local.evidence_ref,evidence_digest:local.evidence_digest}},
    snapshot:{schema:'v51.factory.owner-liveness.snapshot.v1',project_id:observation.project_id,provider:observation.provider,
      task_id:observation.task_id,attempt_id:observation.attempt_id,attempt_epoch:observation.attempt_epoch,
      owner_generation:observation.owner_generation,fingerprint:observation.fingerprint,
      owner_principal_id:observation.owner_principal_id,owner_session_id:observation.owner_session_id,
      provider_session_id:observation.provider_session_id,observation_id:local.observation_id,
      provider_observation_id:observation.observation_id,
      components:{provider_agent_session:{provider_session_id:providerSession.provider_session_id,provider_job_id:providerSession.provider_job_id},
        supervisor_heartbeat:{supervisor_id:heartbeat.supervisor_id,heartbeat_id:heartbeat.heartbeat_id}}},
  };
  fs.writeFileSync(path.join(stateDir,'owner-liveness.json'),JSON.stringify(publication),{flag:'wx'});
  const configDir=path.join(root,'config'); fs.mkdirSync(configDir,{recursive:true});
  const key=(keyId:string,role:'PROVIDER_AGENT'|'HOST_LOCAL'|'HOST_SUPERVISOR',schema:string,pair:any)=>({
    key_id:keyId,issuer_role:role,scope:role==='PROVIDER_AGENT'?'V51_R2_PROVIDER_AGENT_SESSION':
      role==='HOST_LOCAL'?'V51_R2_LOCAL_OWNER_LIVENESS':'V51_R2_SUPERVISOR_HEARTBEAT',
    project_id:project,generation:1,
    not_before:'1970-01-01T00:00:00.000Z',not_after:'2999-01-01T00:00:00.000Z',revoked_at:null,
    schemas:[schema],public_key_pem:pair.publicKey.export({format:'pem',type:'spki'}).toString(),
  });
  const manifest={schema:'PTYSD_RUNTIME_MANIFEST_V1',project_id:project,provider_write_enabled:false,worker_provider_credentials:[],
    recovery_evidence:{schema:'PTYSD_RECOVERY_EVIDENCE_TRUST_V1',project_id:project,trust_root_generation:1,
      store:{kind:'APPEND_ONLY_ID_ADDRESSED_WITH_DIGEST',route_id:'PTYSD_FACTORY_MCP_RECOVERY_EVIDENCE_STORE_V1',max_bytes:1048576},
      trust_roots:{keys:[key('test-provider','PROVIDER_AGENT','PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1',providerKeyPair),
        key('test-local','HOST_LOCAL','PTYSD_LOCAL_LIVENESS_EVIDENCE_V1',localKeyPair),
        key('test-heartbeat','HOST_SUPERVISOR','PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1',heartbeatKeyPair)]},
      publication:{status:'AVAILABLE',route_id:'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1',reason_code:null},
      dependencies:{provider_session:{status:'UNAVAILABLE',reason_code:'PROVIDER_AGENT_SESSION_READ_ROUTE_NOT_CONFIGURED'},
        supervisor_heartbeat:{status:'UNAVAILABLE',reason_code:'SUPERVISOR_HEARTBEAT_READ_ROUTE_NOT_CONFIGURED'}}}};
  const malformedTrustRoots=[
    {name:'missing-scope',mutate:(value:any)=>{delete value.recovery_evidence.trust_roots.keys[0].scope;}},
    {name:'wrong-scope',mutate:(value:any)=>{value.recovery_evidence.trust_roots.keys[0].scope='V51_R2_LOCAL_OWNER_LIVENESS';}},
    {name:'private-key-field',mutate:(value:any)=>{value.recovery_evidence.trust_roots.keys[0].private_key_pem='must-not-be-configured';}},
    {name:'future-key-generation',mutate:(value:any)=>{value.recovery_evidence.trust_roots.keys[0].generation=2;}},
  ];
  for (const malformed of malformedTrustRoots) {
    const invalidManifest=JSON.parse(JSON.stringify(manifest)); malformed.mutate(invalidManifest);
    const invalidPath=path.join(configDir,`${malformed.name}.json`);
    fs.writeFileSync(invalidPath,JSON.stringify(invalidManifest),{flag:'wx'});
    throws(()=>createRecoveryEvidenceComposition(invalidPath,project,t),'RECOVERY_TRUST_ROOTS_INVALID');
  }
  const rotationManifest=JSON.parse(JSON.stringify(manifest));
  rotationManifest.recovery_evidence.trust_root_generation=2;
  const previousProviderKey=rotationManifest.recovery_evidence.trust_roots.keys[0];
  previousProviderKey.revoked_at=new Date(3000).toISOString();
  const nextProviderPair=generateKeyPairSync('ed25519');
  rotationManifest.recovery_evidence.trust_roots.keys.push({...previousProviderKey,key_id:'test-provider-v2',generation:2,
    not_before:new Date(2000).toISOString(),revoked_at:null,
    public_key_pem:nextProviderPair.publicKey.export({format:'pem',type:'spki'}).toString()});
  const rotationPath=path.join(configDir,'runtime-manifest-rotation.json');
  const rotationBytes=Buffer.from(JSON.stringify(rotationManifest));
  fs.writeFileSync(rotationPath,rotationBytes,{flag:'wx'});
  assert.equal(createRecoveryEvidenceComposition(rotationPath,project,1999).dependencyStatus().active_provider_trust_keys,1);
  assert.equal(createRecoveryEvidenceComposition(rotationPath,project,2000).dependencyStatus().active_provider_trust_keys,2);
  assert.equal(createRecoveryEvidenceComposition(rotationPath,project,3000).dependencyStatus().active_provider_trust_keys,1);
  assert.deepEqual(fs.readFileSync(rotationPath),rotationBytes,'runtime trust-root access is read-only');
  const manifestPath=path.join(configDir,'runtime-manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest),{flag:'wx'});
  const configuredManifest=JSON.parse(JSON.stringify(manifest));
  configuredManifest.recovery_evidence.dependencies={
    provider_session:{status:'AVAILABLE',route_id:'PTYSD_PROVIDER_AGENT_SESSION_READBACK_V1'},
    supervisor_heartbeat:{status:'AVAILABLE',route_id:'PTYSD_HOST_SUPERVISOR_HEARTBEAT_READBACK_V1'},
  };
  const configuredManifestPath=path.join(configDir,'runtime-manifest-fixed-routes.json');
  fs.writeFileSync(configuredManifestPath,JSON.stringify(configuredManifest),{flag:'wx'});
  const publicationRoute=(directory:string)=>({readCurrent:()=>{
    try { return fs.readFileSync(path.join(directory,'owner-liveness.json')); } catch { return undefined; }
  }});
  const immutableEvidenceRoute={read:createImmutableEvidenceReader(storeRoot)};
  const identity={project_id:observation.project_id,provider:observation.provider,task_id:observation.task_id,
    attempt_id:observation.attempt_id,attempt_epoch:observation.attempt_epoch,owner_generation:observation.owner_generation,
    fingerprint:observation.fingerprint,owner_principal_id:observation.owner_principal_id,
    owner_session_id:observation.owner_session_id,provider_session_id:observation.provider_session_id};
  const providerReadback={...identity,observation_id:observation.observation_id,provider_job_id:observation.provider_job_id,
    observed_at:observation.observed_at,state:'TERMINAL' as const,evidence_ref:observation.evidence_ref,evidence_digest:observation.evidence_digest};
  const heartbeatReadback={...identity,supervisor_id:heartbeat.supervisor_id!,heartbeat_id:heartbeat.heartbeat_id!,
    observed_at:heartbeat.observed_at,heartbeat_at_utc:heartbeat.heartbeat_at_utc!,boot_identity:heartbeat.boot_identity!,
    process_identity:heartbeat.process_identity!,service_identity:heartbeat.service_identity!,task_identity:heartbeat.task_identity!,
    evidence_ref:heartbeat.heartbeat_evidence_ref!,evidence_digest:heartbeat.heartbeat_evidence_digest!};
  fs.writeFileSync(path.join(stateDir,'provider-session-readback.json'),JSON.stringify({
    schema:'PTYSD_PROVIDER_SESSION_READBACK_V1',...providerReadback,
  }),{flag:'wx'});
  fs.writeFileSync(path.join(stateDir,'supervisor-heartbeat-readback.json'),JSON.stringify({
    schema:'PTYSD_SUPERVISOR_HEARTBEAT_READBACK_V1',...heartbeatReadback,
  }),{flag:'wx'});
  const providerRoute=createProviderSessionReadRoute(stateDir);
  const heartbeatRoute=createSupervisorHeartbeatReadRoute(stateDir);
  assert.equal(providerRoute.readExact(identity).status,'AVAILABLE');
  assert.equal(heartbeatRoute.readExact(identity).status,'AVAILABLE');
  const heartbeatParked=createRecoveryEvidenceComposition(manifestPath,project,t,{ownerLivenessPublication:publicationRoute(stateDir),
    immutableEvidence:immutableEvidenceRoute,providerSession:providerRoute});
  throws(()=>heartbeatParked.readCurrentObservation(),'SUPERVISOR_HEARTBEAT_ROUTE_UNAVAILABLE');
  const heartbeatSupervisor=new Supervisor(db,project,()=>t,heartbeatParked.trust);
  throws(()=>heartbeatSupervisor.dispatch('T2','W2',60000),'RECOVERY_REQUIRED');
  assert.equal(heartbeatSupervisor.runtime().recovery_required,true); assert.equal(heartbeatSupervisor.recoveryReceipts().length,0);
  heartbeatSupervisor.close();
  const wrongGeneration=createRecoveryEvidenceComposition(manifestPath,project,t,{
    ownerLivenessPublication:publicationRoute(stateDir),immutableEvidence:immutableEvidenceRoute,
    providerSession:{readExact:()=>({status:'AVAILABLE' as const,value:{...providerReadback,owner_generation:4}})},
    supervisorHeartbeat:heartbeatRoute,
  });
  throws(()=>wrongGeneration.readCurrentObservation(),'PROVIDER_SESSION_ROUTE_IDENTITY_MISMATCH');
  const wrongSession=createRecoveryEvidenceComposition(manifestPath,project,t,{
    ownerLivenessPublication:publicationRoute(stateDir),immutableEvidence:immutableEvidenceRoute,
    providerSession:providerRoute,
    supervisorHeartbeat:{readExact:()=>({status:'AVAILABLE' as const,value:{...heartbeatReadback,provider_session_id:'other-provider-session'}})},
  });
  throws(()=>wrongSession.readCurrentObservation(),'SUPERVISOR_HEARTBEAT_ROUTE_IDENTITY_MISMATCH');
  const parked=createRecoveryEvidenceComposition(manifestPath,project,t,{ownerLivenessPublication:publicationRoute(stateDir),immutableEvidence:immutableEvidenceRoute});
  const supervisor=new Supervisor(db,project,()=>t,parked.trust);
  throws(()=>parked.readCurrentObservation(),'PROVIDER_SESSION_ROUTE_UNAVAILABLE');
  throws(()=>supervisor.dispatch('T2','W2',60000),'RECOVERY_REQUIRED');
  assert.equal(supervisor.runtime().recovery_required,true); assert.equal(supervisor.recoveryReceipts().length,0);
  supervisor.close();
  const currentProducerShape={...publication}; delete (currentProducerShape as any).recovery_evidence;
  const missingEvidenceState=path.join(root,'missing-evidence-state'); fs.mkdirSync(missingEvidenceState,{recursive:true});
  fs.writeFileSync(path.join(missingEvidenceState,'owner-liveness.json'),JSON.stringify(currentProducerShape),{flag:'wx'});
  const currentProducer=createRecoveryEvidenceComposition(manifestPath,project,t,{ownerLivenessPublication:publicationRoute(missingEvidenceState)});
  throws(()=>currentProducer.readCurrentObservation(),'OWNER_LIVENESS_SIGNED_EVIDENCE_REFERENCES_UNAVAILABLE');
  const unavailableState=path.join(root,'unavailable-evidence-state'); fs.mkdirSync(unavailableState,{recursive:true});
  const explicitUnavailable={...publication,recovery_evidence:{schema:'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',status:'UNAVAILABLE',
    reason_code:'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED'}};
  fs.writeFileSync(path.join(unavailableState,'owner-liveness.json'),JSON.stringify(explicitUnavailable),{flag:'wx'});
  const unavailableEvidence=createRecoveryEvidenceComposition(manifestPath,project,t,{ownerLivenessPublication:publicationRoute(unavailableState)});
  throws(()=>unavailableEvidence.readCurrentObservation(),
    'OWNER_LIVENESS_SIGNED_EVIDENCE_UNAVAILABLE:TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED');
  const bound=createRecoveryEvidenceComposition(configuredManifestPath,project,t,{ownerLivenessPublication:publicationRoute(stateDir),
    immutableEvidence:immutableEvidenceRoute,providerSession:providerRoute,supervisorHeartbeat:heartbeatRoute});
  const composed=bound.readCurrentObservation();
  const rotationDeadline=t+5_000;
  const expiringManifest=JSON.parse(JSON.stringify(configuredManifest));
  const expiringManifestPath=path.join(configDir,'runtime-manifest-expiring-key.json');
  fs.writeFileSync(expiringManifestPath,JSON.stringify(expiringManifest),{flag:'wx'});
  const expiring=createRecoveryEvidenceComposition(expiringManifestPath,project,()=>t,{ownerLivenessPublication:publicationRoute(stateDir),
    immutableEvidence:immutableEvidenceRoute,providerSession:providerRoute,supervisorHeartbeat:heartbeatRoute});
  assert.equal(expiring.dependencyStatus().active_provider_trust_keys,1);
  expiringManifest.recovery_evidence.trust_roots.keys[0].revoked_at=new Date(rotationDeadline).toISOString();
  fs.writeFileSync(expiringManifestPath,JSON.stringify(expiringManifest));
  const expiringSupervisor=new Supervisor(db,project,()=>t,expiring.trust);
  const beforeRevocation=t;
  try {
    t=rotationDeadline+1_000;
    assert.equal(expiring.dependencyStatus().active_provider_trust_keys,0);
    throws(()=>expiringSupervisor.resolveRecovery(composed),'RECOVERY_EVIDENCE_UNTRUSTED');
    assert.equal(expiringSupervisor.runtime().recovery_required,true);
    assert.equal(expiringSupervisor.recoveryReceipts().length,0);
  } finally {
    t=beforeRevocation;
    expiringSupervisor.close();
  }
  const resolved=new Supervisor(db,project,()=>t,bound.trust);
  const receipt=resolved.resolveRecovery(composed);
  assert.equal(receipt.result,'RESOLVED'); assert.equal(resolved.runtime().recovery_required,false);
  assert.equal(resolved.recoveryReceipts().length,1);
  const resolvedAt=(resolved.events() as any[]).findIndex(event=>event.kind==='RECOVERY_RESOLVED');
  resolved.dispatch('T2','W2',60000);
  const dispatchedAt=(resolved.events() as any[]).findIndex(event=>event.kind==='WORKER_DISPATCHED' && JSON.parse(event.detail).task_id==='T2');
  assert.ok(resolvedAt>=0 && dispatchedAt>resolvedAt); resolved.close();
});

test('expired lease cannot be revived by heartbeat or completion',()=>{
  let t=1000; const s=testSupervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1101;
  throws(()=>s.heartbeat('W1',100),'WORKER_LEASE_EXPIRED'); throws(()=>s.complete('T1','W1',['TEST_PASS']),'WORKER_LEASE_EXPIRED');
  const stale=s.tick() as any; assert.equal(stale.worker,'W1'); assert.equal(s.runtime().recovery_required,true); s.close();
});
