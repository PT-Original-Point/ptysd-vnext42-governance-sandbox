import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Supervisor } from '../src/core.ts';
import {
  createFactoryStatusPublicationReadRoute,
  createImmutableEvidenceReader,
  createImmutableEvidenceWriter,
  createProviderSessionReadRoute,
  createRecoveryEvidenceComposition,
  createSupervisorHeartbeatReadRoute,
} from '../src/recovery-evidence.ts';
import { publishSupervisorHeartbeatEvidence } from '../src/supervisor-heartbeat.ts';
import { publishLocalOwnerLivenessEvidence, publishProviderSessionEvidence } from '../src/recovery-evidence-producer.ts';

const project='CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const expectedProducerHead='e16cd05e821572061321f807841ae0145ff69bc1';
const expectedProducerBase='d39486601d851e31256852a24e9c1393b9046fe5';
const expectedProducerTree='71e5f034db151a963f4b0b71564d34fcfe6ff627';
const expectedProducerBlobs=[
  ['tools/csg/factory-mcp/broker/host-powershell-exec.ps1','5c60aa21c8347cb2bdc4b3de16efb11744a73323'],
  ['tools/csg/factory-mcp/broker/hostguard-broker.ps1','c1f82f1c4f4e75f1880c2d05a0680cace3266b73'],
  ['tools/csg/factory-mcp/broker/owner-liveness-publisher.ps1','a396ea8d6ffcefcc1d5ba374af2da19d63a4a3df'],
  ['tools/csg/factory-mcp/package.json','02fea14b65da7173472437ebe7ff534f234c03c8'],
  ['tools/csg/factory-mcp/src/index.mjs','62ef03c17f75274c546c466b1b9b326f2ac3361f'],
  ['tools/csg/factory-mcp/src/invoke-hostguard.ps1','2f9b3fe7a07357069fa0e4e6aaec604e315f3402'],
  ['tools/csg/factory-mcp/src/readonly-diagnostics.mjs','00c588b3dc029cc12453ba21f66fca13d5bc3498'],
  ['tools/csg/factory-mcp/src/readonly-diagnostics.ps1','2a4ec6018db18da2ec0579132821bf2d4dc2b442'],
  ['tools/csg/factory-mcp/windows/install-broker.ps1','6feb382d4319f51e43f042dbe8ec2387e16f4378'],
];
const candidateRoot=path.resolve(process.env.PTYSD_R2_03_WORKTREE||'');
assert.ok(process.env.PTYSD_R2_03_WORKTREE,'set PTYSD_R2_03_WORKTREE to the exact PR #381 source-only worktree');
assert.equal(execFileSync('git',['-C',candidateRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),expectedProducerHead);
assert.equal(execFileSync('git',['-C',candidateRoot,'rev-parse','HEAD^'],{encoding:'utf8'}).trim(),expectedProducerBase);
assert.equal(execFileSync('git',['-C',candidateRoot,'rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),expectedProducerTree);
for(const [relative,expectedBlob] of expectedProducerBlobs){
  const producerPath=path.join(candidateRoot,...relative.split('/'));
  assert.equal(execFileSync('git',['-C',candidateRoot,'hash-object',producerPath],{encoding:'utf8'}).trim(),expectedBlob,`producer blob mismatch: ${relative}`);
}
const publisherPath=path.join(candidateRoot,'tools','csg','factory-mcp','broker','owner-liveness-publisher.ps1');

const identityPayload = identity => ({
  project_id:identity.project_id, provider:identity.provider, task_id:identity.task_id,
  attempt_id:identity.attempt_id, attempt_epoch:identity.attempt_epoch,
  owner_generation:identity.owner_generation, fingerprint:identity.fingerprint,
  owner_principal_id:identity.owner_principal_id, owner_session_id:identity.owner_session_id,
  provider_session_id:identity.provider_session_id,
});
const publicKey = keyPair => keyPair.publicKey.export({format:'pem',type:'spki'}).toString();

async function readFactoryStatus(factoryRoot, publicationPath) {
  const child=spawn(process.execPath,['src/index.mjs'],{
    cwd:factoryRoot,env:{...process.env,NODE_ENV:'test',PTYSD_FACTORY_MCP_TEST_MODE:'1',
      PTYSD_FACTORY_MCP_TEST_OWNER_LIVENESS_PATH:publicationPath},
    stdio:['pipe','pipe','pipe'],windowsHide:true,
  });
  const stderr=[]; child.stderr.setEncoding('utf8'); child.stderr.on('data',chunk=>stderr.push(chunk));
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  const pending=new Map();
  lines.on('line',line=>{
    const message=JSON.parse(line); if(message.id===undefined||!pending.has(message.id)) return;
    const resolvePending=pending.get(message.id); pending.delete(message.id); resolvePending(message);
  });
  let requestId=0;
  const send=(method,params={})=>new Promise((resolveRequest,rejectRequest)=>{
    const id=++requestId, timer=setTimeout(()=>{pending.delete(id);rejectRequest(new Error(`MCP_TIMEOUT:${method}\n${stderr.join('')}`));},10000);
    pending.set(id,message=>{clearTimeout(timer);if(message.error) rejectRequest(new Error(JSON.stringify(message.error)));else resolveRequest(message);});
    child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);
  });
  try {
    const initialized=await send('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'r2-cross-candidate',version:'1.0.0'}});
    assert.equal(initialized.result?.serverInfo?.name,'ptysd-factory-mcp');
    child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})}\n`);
    const listed=await send('tools/list',{});
    assert.deepEqual(listed.result?.tools?.map(tool=>tool.name).sort(),['factory_status','host_powershell','worker_prepare','worker_start']);
    const call=await send('tools/call',{name:'factory_status',arguments:{}});
    assert.equal(call.result?.isError,undefined);
    return JSON.parse(call.result?.content?.[0]?.text??'null');
  } finally { child.kill(); lines.close(); }
}

const root=fs.mkdtempSync(path.join(os.tmpdir(),'v51-r2-cross-candidate-'));
const state=path.join(root,'state'); fs.mkdirSync(state);
const publicationPath=path.join(state,'owner-liveness.json');
const ownerPrincipal='CODEX_THREAD_01a0ed35-6063-7912-9872-7d4122a3b125';
const ownerScope='V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION';
const task=ownerScope;
const nowMs=Date.now();
const now=new Date(nowMs).toISOString();
const ownerSession=ownerPrincipal;
const providerSession='provider-session-gen5-test';
const identity={project_id:project,provider:'codex',task_id:task,attempt_id:'V51-R2-02-ATTEMPT-002',
  attempt_epoch:2,owner_generation:5,fingerprint:createHash('sha256').update([
    project,'codex',task,'V51-R2-02-ATTEMPT-002','2','5',ownerPrincipal,ownerScope,
  ].join('\n')).digest('hex'),owner_principal_id:ownerPrincipal,owner_session_id:ownerSession,
  provider_session_id:providerSession};
const providerKeys=generateKeyPairSync('ed25519');
const localKeys=generateKeyPairSync('ed25519');
const heartbeatKeys=generateKeyPairSync('ed25519');
const evidenceStore=path.join(state,'recovery-evidence');
for(const kind of ['provider','local','supervisor-heartbeat']) fs.mkdirSync(path.join(evidenceStore,'objects',kind),{recursive:true});
const writeEvidence=createImmutableEvidenceWriter(evidenceStore);
const readEvidence=createImmutableEvidenceReader(evidenceStore);

const providerObservationId='provider-observation-gen5-cross-candidate';
const localObservationId='local-observation-gen5-cross-candidate';
const providerJobId='provider-job-gen5-test';
const heartbeatReadbackPath=path.join(state,'supervisor-heartbeat-readback.json');
const heartbeatPublished=publishSupervisorHeartbeatEvidence({
  context:{identity,provider_observation_id:providerObservationId,owner_liveness_state:'EXPIRED'},
  host:{supervisor_id:'PTYSD-HOST-SUPERVISOR',boot_identity:'boot:cross-candidate',
    process_identity:'pid:4242;created:2026-10-01T00:00:00.000Z',service_identity:'PTYSD-VNext42-Supervisor'},
  signer:{keyId:'test-heartbeat',sign:bytes=>sign(null,Buffer.from(bytes),heartbeatKeys.privateKey)},
  now:nowMs,writeEvidence,publishReadback:bytes=>fs.writeFileSync(heartbeatReadbackPath,bytes,{flag:'wx'}),
  readReadback:()=>fs.readFileSync(heartbeatReadbackPath),
});

const providerPayload={
  observation_id:providerObservationId,status:'OBSERVED_JOB',...identityPayload(identity),
  provider_job_id:providerJobId,observed_at:now,source:'authorized-provider-agent-session-readback',state:'COMPLETED',
  reconciled_terminal:true,reconciliation_ref:'provider-terminal-readback:gen5-test',
};
const providerReadbackPath=path.join(state,'provider-session-readback.json');
let prematureEvidenceWrites=0;
assert.throws(()=>publishProviderSessionEvidence({identity,payload:{...providerPayload,state:'RUNNING',
  reconciled_terminal:false,reconciliation_ref:undefined},ports:{now:nowMs,
  signer:{keyId:'test-provider',sign:bytes=>sign(null,Buffer.from(bytes),providerKeys.privateKey)},
  writeEvidence:()=>{prematureEvidenceWrites++;return ''},publishReadback:()=>{prematureEvidenceWrites++;},readReadback:()=>undefined,
}}),/PROVIDER_SESSION_TERMINAL_RECONCILIATION_REQUIRED/);
assert.equal(prematureEvidenceWrites,0,'nonterminal provider state cannot publish evidence or readback');
const providerPublished=publishProviderSessionEvidence({identity,payload:providerPayload,ports:{now:nowMs,
  signer:{keyId:'test-provider',sign:bytes=>sign(null,Buffer.from(bytes),providerKeys.privateKey)},writeEvidence,
  publishReadback:bytes=>fs.writeFileSync(providerReadbackPath,bytes,{flag:'wx'}),readReadback:()=>fs.readFileSync(providerReadbackPath)}});
const providerRef=providerPublished.reference;
const providerDigest=providerPublished.evidenceDigest;
const localPayload={
  observation_id:localObservationId,provider_observation_id:providerObservationId,...identityPayload(identity),
  observed_at:now,source:'authorized-cross-source-liveness-readback',
  components:{
    os_process:{observation_id:'os-observation-gen5-test',provider_observation_id:providerObservationId,
      ...identityPayload(identity),observed_at:now,source:'local-os-process-readback',state:'ABSENT',
      process_id:null,process_image:null,process_principal:null,process_started_at_utc:null},
    provider_agent_session:{observation_id:'session-observation-gen5-test',provider_observation_id:providerObservationId,
      ...identityPayload(identity),observed_at:now,source:'provider-agent-session-readback',state:'TERMINAL',
      provider_session_id:providerSession,provider_job_id:providerJobId},
    supervisor_heartbeat:{...heartbeatPublished.component},
  },
};
const localReadbackPath=path.join(state,'local-liveness-evidence-readback.json');
const localPublished=publishLocalOwnerLivenessEvidence({identity,payload:localPayload,ports:{now:nowMs,
  signer:{keyId:'test-local',sign:bytes=>sign(null,Buffer.from(bytes),localKeys.privateKey)},writeEvidence,
  publishReadback:bytes=>fs.writeFileSync(localReadbackPath,bytes,{flag:'wx'}),readReadback:()=>fs.readFileSync(localReadbackPath)}});
const localRef=localPublished.reference;
const localDigest=localPublished.evidenceDigest;

const ps=String.raw`$payloadBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())
$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($payloadBytes)); . $payload.script_path
$state=$payload.state_directory
function Get-OwnerLivenessPublisherIdentitySid { return 'S-1-5-18' }
function Test-OwnerLivenessStateDirectoryBoundary { return $true }
function Test-OwnerLivenessStateDirectoryAcl { param($Acl) return $true }
function Test-OwnerLivenessProtectedReadDirectory { param([string]$Path) return $true }
function Test-OwnerLivenessProtectedReadFile { param([string]$Path) return $true }
function Set-OwnerLivenessPublishedFileAcl { param([string]$Path) }
function Get-CimInstance { param([string]$ClassName,[string]$Filter,[string]$ErrorAction) return @(
  [pscustomobject]@{Name='Codex.exe';ProcessId=101;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-5))},
  [pscustomobject]@{Name='ChatGPT.exe';ProcessId=102;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-4))}) }
function Invoke-CimMethod { param($InputObject,[string]$MethodName,[string]$ErrorAction) return [pscustomobject]@{ReturnValue=0;Domain='TEST';User='Executor'} }
function Get-ScheduledTask { param([string]$TaskName,[string]$ErrorAction) return [pscustomobject]@{State='Disabled';Settings=[pscustomobject]@{Enabled=$false};Principal=[pscustomobject]@{UserId='x'}} }
$null=Publish-OwnerLivenessSnapshot
$published=[IO.File]::ReadAllText((Join-Path $state 'owner-liveness.json')) | ConvertFrom-Json
[Console]::Out.Write([string]$published.publisher_status)`;

try {
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{
    input:Buffer.from(JSON.stringify({script_path:publisherPath,state_directory:state}),'utf8').toString('base64'),
    encoding:'utf8',timeout:30000,windowsHide:true,
  });
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.equal(result.stdout.trim(),'PUBLISHED',JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message}));
  const publication=JSON.parse(fs.readFileSync(publicationPath,'utf8'));
  assert.equal(publication.snapshot.source,'system-broker-fixed-owner-liveness-collector');
  assert.equal(publication.snapshot.owner_session_id,ownerSession);
  assert.equal(publication.snapshot.provider_session_id,providerSession);
  assert.match(publication.snapshot.observation_id,/^broker-observation-[a-f0-9]{32}$/);
  assert.notEqual(publication.snapshot.observation_id,localObservationId);
  assert.notEqual(publication.snapshot.observation_id,providerObservationId);
  assert.equal(publication.snapshot.provider_observation_id,providerObservationId);
  assert.deepEqual(publication.recovery_evidence,{schema:'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',status:'AVAILABLE',
    provider:{evidence_ref:providerRef,evidence_digest:providerDigest},local:{evidence_ref:localRef,evidence_digest:localDigest}});
  const factoryStatus=await readFactoryStatus(path.join(candidateRoot,'tools','csg','factory-mcp'),publicationPath);
  assert.equal(factoryStatus.owner_liveness.read_status,'AVAILABLE');
  assert.equal(factoryStatus.owner_liveness.components.provider_agent_session.provider_session.session_id,providerSession);
  assert.equal(factoryStatus.owner_liveness.components.supervisor_heartbeat.supervisor.readback_status,'PRESENT');
  assert.equal(factoryStatus.owner_liveness.reconciliation_verdict,'NOT_PERFORMED');
  const factoryStatusBytes=Buffer.from(JSON.stringify(factoryStatus));
  const factoryPublicationRoute=createFactoryStatusPublicationReadRoute(()=>factoryStatusBytes);

  const manifest=JSON.parse(fs.readFileSync(path.join(process.cwd(),'config/runtime-manifest.json'),'utf8'));
  const keys=(keyId,issuerRole,schema,pair)=>({key_id:keyId,issuer_role:issuerRole,
    scope:issuerRole==='PROVIDER_AGENT'?'V51_R2_PROVIDER_AGENT_SESSION':
      issuerRole==='HOST_LOCAL'?'V51_R2_LOCAL_OWNER_LIVENESS':'V51_R2_SUPERVISOR_HEARTBEAT',
    project_id:project,generation:1,not_before:'1970-01-01T00:00:00.000Z',not_after:'2999-01-01T00:00:00.000Z',
    revoked_at:null,schemas:[schema],public_key_pem:publicKey(pair)});
  manifest.recovery_evidence.trust_roots.keys=[
    keys('test-provider','PROVIDER_AGENT','PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1',providerKeys),
    keys('test-local','HOST_LOCAL','PTYSD_LOCAL_LIVENESS_EVIDENCE_V1',localKeys),
    keys('test-heartbeat','HOST_SUPERVISOR','PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1',heartbeatKeys),
  ];
  manifest.recovery_evidence.publication={status:'AVAILABLE',route_id:'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1',reason_code:null};
  manifest.recovery_evidence.dependencies={
    provider_session:{status:'AVAILABLE',route_id:'PTYSD_PROVIDER_AGENT_SESSION_READBACK_V1'},
    supervisor_heartbeat:{status:'AVAILABLE',route_id:'PTYSD_HOST_SUPERVISOR_HEARTBEAT_READBACK_V1'},
  };
  const manifestPath=path.join(root,'runtime-manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest),{flag:'wx'});
  const evidenceReads=[];
  const composition=createRecoveryEvidenceComposition(manifestPath,project,()=>nowMs+250,{
    ownerLivenessPublication:factoryPublicationRoute,
    immutableEvidence:{read:reference=>{evidenceReads.push(reference);return readEvidence(reference);}},
    providerSession:createProviderSessionReadRoute(state),
    supervisorHeartbeat:createSupervisorHeartbeatReadRoute(state),
  });
  const observation=composition.readCurrentObservation();
  assert.deepEqual(evidenceReads.slice(0,2),[providerRef,localRef]);
  assert.equal(observation.observation_id,providerObservationId);
  assert.equal(observation.local_liveness_observation.observation_id,localObservationId);

  const supervisor=new Supervisor(path.join(root,'runtime.db'),project,()=>nowMs+250,composition.trust);
  const postRecoveryEnvelope={schema:'PTYSD_TASK_ENVELOPE_V1',project_id:project,
    task_id:'post-recovery-dispatch-transition',interrupt_epoch:0,objective:'verify recovery and dispatch are separate durable transitions',
    owner_generation:6,provider_write:false,allowed_paths:['sandbox/**'],evidence_required:['TEST_PASS'],provider:'codex',
    owner_principal_id:ownerPrincipal,owner_session_id:ownerSession,provider_session_id:providerSession,
    attempt_id:'POST-RECOVERY-ATTEMPT-001',attempt_epoch:1};
  try {
    supervisor.ingest(postRecoveryEnvelope);
    const runtime=supervisor.runtime();
    runtime.recovery_required=true;
    runtime.recovery_context={task_id:task,attempt_id:identity.attempt_id,attempt_epoch:identity.attempt_epoch,
      owner_generation:identity.owner_generation,fingerprint:identity.fingerprint,provider:identity.provider,
      owner_principal_id:ownerPrincipal,owner_session_id:ownerSession,provider_session_id:providerSession};
    supervisor.db.prepare('UPDATE runtime SET data=? WHERE id=1').run(JSON.stringify(runtime));
    const receipt=supervisor.resolveRecovery(observation);
    assert.equal(receipt.result,'RESOLVED');
    assert.equal(receipt.observation.evidence_ref,providerRef);
    assert.equal(receipt.observation.local_liveness_observation.evidence_ref,localRef);
    assert.ok(evidenceReads.filter(reference=>reference===providerRef).length>=2);
    assert.ok(evidenceReads.filter(reference=>reference===localRef).length>=2);
    assert.equal(supervisor.runtime().recovery_required,false);
    assert.equal(supervisor.recoveryReceipts().length,1);
    supervisor.dispatch(postRecoveryEnvelope.task_id,'post-recovery-worker',60_000);
    const events=supervisor.events();
    const resolvedAt=events.findIndex(event=>event.kind==='RECOVERY_RESOLVED');
    const dispatchedAt=events.findIndex(event=>event.kind==='WORKER_DISPATCHED'&&
      JSON.parse(event.detail).task_id===postRecoveryEnvelope.task_id);
    assert.ok(resolvedAt>=0&&dispatchedAt>resolvedAt,'dispatch is a later durable transition than recovery resolution');
  } finally { supervisor.close(); }

  const recoveryContext={task_id:task,attempt_id:identity.attempt_id,attempt_epoch:identity.attempt_epoch,
    owner_generation:identity.owner_generation,fingerprint:identity.fingerprint,provider:identity.provider,
    owner_principal_id:ownerPrincipal,owner_session_id:ownerSession,provider_session_id:providerSession};
  const assertFailClosed=({name,expected,composition:attempt,run})=>{
    const nextTaskId=`after-failed-recovery-${name}`;
    const blocked=new Supervisor(path.join(root,`${name}.db`),project,()=>nowMs+250,attempt.trust);
    try {
      blocked.ingest({...postRecoveryEnvelope,task_id:nextTaskId,attempt_id:`${nextTaskId}-attempt`});
      const runtime=blocked.runtime(); runtime.recovery_required=true; runtime.recovery_context=recoveryContext;
      blocked.db.prepare('UPDATE runtime SET data=? WHERE id=1').run(JSON.stringify(runtime));
      assert.throws(()=>run(blocked),new RegExp(expected));
      assert.equal(blocked.runtime().recovery_required,true,`${name} must preserve the recovery latch`);
      assert.equal(blocked.recoveryReceipts().length,0,`${name} must not persist a recovery receipt`);
      assert.throws(()=>blocked.dispatch(nextTaskId,`worker-${name}`,60_000),/RECOVERY_REQUIRED/);
      assert.equal(blocked.events().some(event=>event.kind==='WORKER_DISPATCHED'),false,
        `${name} must not persist a dispatch transition`);
    } finally { blocked.close(); }
  };
  const routeOverrides={
    ownerLivenessPublication:factoryPublicationRoute,
    immutableEvidence:{read:reference=>readEvidence(reference)},
    providerSession:createProviderSessionReadRoute(state),
    supervisorHeartbeat:createSupervisorHeartbeatReadRoute(state),
  };
  const noProvider=createRecoveryEvidenceComposition(manifestPath,project,()=>nowMs+250,{
    ...routeOverrides,providerSession:{readExact:()=>({status:'UNAVAILABLE',reason_code:'PROVIDER_SESSION_TEST_UNAVAILABLE'})},
  });
  assertFailClosed({name:'provider-session-unavailable',expected:'PROVIDER_SESSION_ROUTE_UNAVAILABLE',composition:noProvider,
    run:blocked=>blocked.resolveRecovery(noProvider.readCurrentObservation())});
  const noHeartbeat=createRecoveryEvidenceComposition(manifestPath,project,()=>nowMs+250,{
    ...routeOverrides,supervisorHeartbeat:{readExact:()=>({status:'UNAVAILABLE',reason_code:'SUPERVISOR_HEARTBEAT_TEST_UNAVAILABLE'})},
  });
  assertFailClosed({name:'supervisor-heartbeat-unavailable',expected:'SUPERVISOR_HEARTBEAT_ROUTE_UNAVAILABLE',composition:noHeartbeat,
    run:blocked=>blocked.resolveRecovery(noHeartbeat.readCurrentObservation())});

  const wrongGeneration=createRecoveryEvidenceComposition(manifestPath,project,()=>nowMs+250,{
    ...routeOverrides,providerSession:{readExact:()=>({status:'AVAILABLE',value:{...providerPublished.readback,owner_generation:4}})},
  });
  assertFailClosed({name:'wrong-owner-generation',expected:'PROVIDER_SESSION_ROUTE_IDENTITY_MISMATCH',composition:wrongGeneration,
    run:blocked=>blocked.resolveRecovery(wrongGeneration.readCurrentObservation())});
  const wrongSession=createRecoveryEvidenceComposition(manifestPath,project,()=>nowMs+250,{
    ...routeOverrides,providerSession:{readExact:()=>({status:'AVAILABLE',value:{...providerPublished.readback,provider_session_id:'other-provider-session'}})},
  });
  assertFailClosed({name:'mismatched-provider-session',expected:'PROVIDER_SESSION_ROUTE_IDENTITY_MISMATCH',composition:wrongSession,
    run:blocked=>blocked.resolveRecovery(wrongSession.readCurrentObservation())});

  const staleHeartbeatObservation=composition.readCurrentObservation();
  staleHeartbeatObservation.local_liveness_observation.components.supervisor_heartbeat.heartbeat_at_utc=
    new Date(nowMs-31_000).toISOString();
  assertFailClosed({name:'stale-supervisor-heartbeat',expected:'SUPERVISOR_HEARTBEAT_EVIDENCE_REQUIRED',composition,
    run:blocked=>blocked.resolveRecovery(staleHeartbeatObservation)});

  const wrongTrustManifest=JSON.parse(JSON.stringify(manifest));
  const wrongProviderKeys=generateKeyPairSync('ed25519');
  wrongTrustManifest.recovery_evidence.trust_roots.keys.find(key=>key.issuer_role==='PROVIDER_AGENT').public_key_pem=
    publicKey(wrongProviderKeys);
  const wrongTrustManifestPath=path.join(root,'runtime-manifest-wrong-provider-key.json');
  fs.writeFileSync(wrongTrustManifestPath,JSON.stringify(wrongTrustManifest),{flag:'wx'});
  const wrongKey=createRecoveryEvidenceComposition(wrongTrustManifestPath,project,()=>nowMs+250,routeOverrides);
  assertFailClosed({name:'wrong-provider-trust-key',expected:'RECOVERY_EVIDENCE_UNTRUSTED',composition:wrongKey,
    run:blocked=>blocked.resolveRecovery(wrongKey.readCurrentObservation())});

  const tamperedBytes=Buffer.from(fs.readFileSync(path.join(evidenceStore,'objects','provider',`${providerRef.split('/').at(-1)}.json`)));
  tamperedBytes[tamperedBytes.length-3]^=1;
  fs.writeFileSync(path.join(evidenceStore,'objects','provider',`${providerRef.split('/').at(-1)}.json`),tamperedBytes);
  const tampered=createRecoveryEvidenceComposition(manifestPath,project,()=>nowMs+250,{
    ownerLivenessPublication:factoryPublicationRoute,
    immutableEvidence:{read:reference=>readEvidence(reference)},
    providerSession:createProviderSessionReadRoute(state),supervisorHeartbeat:createSupervisorHeartbeatReadRoute(state),
  });
  assertFailClosed({name:'altered-provider-evidence-byte',expected:'RECOVERY_EVIDENCE_DIGEST_MISMATCH',composition:tampered,
    run:blocked=>blocked.resolveRecovery(tampered.readCurrentObservation())});
  process.stdout.write('CROSS_CANDIDATE_SIGNED_EVIDENCE_AND_FAIL_CLOSED_MATRIX_PASS\n');
} finally {
  const resolved=path.resolve(root), tempRoot=path.resolve(os.tmpdir()), info=fs.lstatSync(resolved);
  assert.equal(info.isDirectory(),true); assert.equal(info.isSymbolicLink(),false); assert.equal(path.dirname(resolved),tempRoot);
  fs.rmSync(resolved,{recursive:true,force:true});
}
