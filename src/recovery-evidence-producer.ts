import { createHash, randomBytes } from 'node:crypto';
import type { LocalLivenessObservation, RecoveryIdentity } from './recovery-evidence.ts';

const PROVIDER_SCHEMA='PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1';
const LOCAL_SCHEMA='PTYSD_LOCAL_LIVENESS_EVIDENCE_V1';
const PROVIDER_READBACK_SCHEMA='PTYSD_PROVIDER_SESSION_READBACK_V1';
const LOCAL_READBACK_SCHEMA='PTYSD_LOCAL_LIVENESS_EVIDENCE_READBACK_V1';
const MAX_EVIDENCE_BYTES=1_048_576;
const MAX_READBACK_BYTES=65_536;
const TERMINAL_STATES=new Set(['COMPLETED','FAILED','CANCELLED','TIMED_OUT']);
const identityKeys: Array<keyof RecoveryIdentity>=[
  'project_id','provider','task_id','attempt_id','attempt_epoch','owner_generation','fingerprint',
  'owner_principal_id','owner_session_id','provider_session_id',
];
const stable=(value:any):any=>Array.isArray(value)?value.map(stable):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const canonicalJson=(value:any)=>JSON.stringify(stable(value));
const digest=(bytes:Uint8Array)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fail=(code:string):never=>{throw new Error(code);};
const isText=(value:unknown,max=512):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const isUtc=(value:unknown,now:number)=>typeof value==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)&&
  Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<=30_000;

export type RecoveryEvidenceSigner={
  keyId:string;
  /** The private signing key remains inside its provider or Host-owned signer. */
  sign:(canonicalPayload:Uint8Array)=>Uint8Array;
};
export type RecoveryEvidenceWritePorts={
  now:number;
  signer:RecoveryEvidenceSigner;
  writeEvidence:(reference:string,bytes:Uint8Array)=>string;
  publishReadback:(bytes:Uint8Array)=>void;
  readReadback:()=>Uint8Array|undefined;
};
export type ProviderSessionEvidencePayload=Omit<import('./core.ts').RecoveryObservation,
  'evidence_ref'|'evidence_digest'|'local_liveness_observation'>;
export type LocalOwnerLivenessEvidencePayload=Omit<LocalLivenessObservation,'evidence_ref'|'evidence_digest'>;

function validateIdentity(value:Record<string,any>,expected:RecoveryIdentity){
  for(const key of identityKeys){
    if(value[key]!==expected[key]) fail('RECOVERY_EVIDENCE_PRODUCER_IDENTITY_MISMATCH');
  }
}

function persistSignedEvidence(kind:'provider'|'local',schema:string,payload:Record<string,any>,ports:RecoveryEvidenceWritePorts){
  if(!Number.isSafeInteger(ports.now)||ports.now<0) fail('RECOVERY_EVIDENCE_PRODUCER_CLOCK_INVALID');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(ports.signer?.keyId??'')||typeof ports.signer.sign!=='function') {
    fail('RECOVERY_EVIDENCE_PRODUCER_SIGNER_UNAVAILABLE');
  }
  const reference=`recovery://${kind}/${randomBytes(16).toString('hex')}`;
  payload.evidence_ref=reference;
  const body={schema,issuer_key_id:ports.signer.keyId,payload:stable(payload)};
  let signature:Uint8Array;
  try{signature=ports.signer.sign(Buffer.from(canonicalJson(body)));}catch{return fail('RECOVERY_EVIDENCE_PRODUCER_SIGNING_FAILED');}
  if(!(signature instanceof Uint8Array)||signature.byteLength!==64) fail('RECOVERY_EVIDENCE_PRODUCER_SIGNATURE_INVALID');
  const bytes=Buffer.from(JSON.stringify({...body,signature:Buffer.from(signature).toString('base64')}));
  if(bytes.byteLength>MAX_EVIDENCE_BYTES) fail('RECOVERY_EVIDENCE_PRODUCER_TOO_LARGE');
  const expectedDigest=digest(bytes);
  let storedDigest:string;
  try{storedDigest=ports.writeEvidence(reference,bytes);}catch{return fail('RECOVERY_EVIDENCE_PRODUCER_DURABLE_WRITE_FAILED');}
  if(storedDigest!==expectedDigest) fail('RECOVERY_EVIDENCE_PRODUCER_EVIDENCE_READBACK_MISMATCH');
  return {reference,evidenceDigest:expectedDigest,payload,bytes};
}

function publishExactReadback(bytes:Uint8Array,ports:RecoveryEvidenceWritePorts){
  if(bytes.byteLength<1||bytes.byteLength>MAX_READBACK_BYTES) fail('RECOVERY_EVIDENCE_PRODUCER_READBACK_TOO_LARGE');
  try{ports.publishReadback(bytes);}catch{return fail('RECOVERY_EVIDENCE_PRODUCER_READBACK_PUBLISH_FAILED');}
  let readback:Uint8Array|undefined;
  try{readback=ports.readReadback();}catch{return fail('RECOVERY_EVIDENCE_PRODUCER_READBACK_UNAVAILABLE');}
  if(!readback||!Buffer.from(readback).equals(Buffer.from(bytes))) fail('RECOVERY_EVIDENCE_PRODUCER_SAME_SOURCE_READBACK_FAILED');
}

/** Provider-boundary producer. It only attests to terminal/read-empty observations and carries no provider-write authority. */
export function publishProviderSessionEvidence(input:{identity:RecoveryIdentity;payload:ProviderSessionEvidencePayload;ports:RecoveryEvidenceWritePorts}){
  const {identity,payload,ports}=input;
  validateIdentity(payload as unknown as Record<string,any>,identity);
  if(!isText(payload.observation_id,128)||!isUtc(payload.observed_at,ports.now)||
      payload.source!=='authorized-provider-agent-session-readback') fail('PROVIDER_SESSION_EVIDENCE_OBSERVATION_INVALID');
  if(payload.status==='OBSERVED_EMPTY'){
    if(payload.provider_job_id!==null||payload.state!=='NONE'||payload.reconciled_terminal===true) fail('PROVIDER_SESSION_EMPTY_OBSERVATION_INVALID');
  }else if(payload.status==='OBSERVED_JOB'){
    if(!isText(payload.provider_job_id,128)||!TERMINAL_STATES.has(payload.state)||payload.reconciled_terminal!==true||
        !isText(payload.reconciliation_ref,512)) fail('PROVIDER_SESSION_TERMINAL_RECONCILIATION_REQUIRED');
  }else fail('PROVIDER_SESSION_OBSERVATION_STATUS_INVALID');
  const signed=persistSignedEvidence('provider',PROVIDER_SCHEMA,{...payload},ports);
  const readback={schema:PROVIDER_READBACK_SCHEMA,...identity,observation_id:payload.observation_id,
    provider_job_id:payload.provider_job_id,observed_at:payload.observed_at,state:'TERMINAL',
    evidence_ref:signed.reference,evidence_digest:signed.evidenceDigest};
  publishExactReadback(Buffer.from(JSON.stringify(readback)),ports);
  return {...signed,readback};
}

/** Host-local producer. Its role-scoped signer is separate from provider and heartbeat signers. */
export function publishLocalOwnerLivenessEvidence(input:{identity:RecoveryIdentity;payload:LocalOwnerLivenessEvidencePayload;ports:RecoveryEvidenceWritePorts}){
  const {identity,payload,ports}=input;
  validateIdentity(payload as unknown as Record<string,any>,identity);
  if(!isText(payload.observation_id,128)||!isUtc(payload.observed_at,ports.now)||
      payload.source!=='authorized-cross-source-liveness-readback'||!isText(payload.provider_observation_id,128)) {
    fail('LOCAL_LIVENESS_EVIDENCE_OBSERVATION_INVALID');
  }
  if((payload as any).evidence_digest!==undefined) fail('LOCAL_LIVENESS_EVIDENCE_DIGEST_MUST_BE_EXTERNAL');
  if(!payload.components||Object.keys(payload.components).sort().join(',')!=='os_process,provider_agent_session,supervisor_heartbeat') {
    fail('LOCAL_LIVENESS_EVIDENCE_COMPONENTS_INVALID');
  }
  const observationIds=new Set([payload.observation_id,payload.provider_observation_id]);
  const requirements={
    os_process:{source:'local-os-process-readback',state:'ABSENT'},
    provider_agent_session:{source:'provider-agent-session-readback',state:'TERMINAL'},
    supervisor_heartbeat:{source:'host-supervisor-heartbeat-readback',state:'EXPIRED'},
  } as const;
  for(const name of Object.keys(requirements) as Array<keyof typeof requirements>){
    const component=payload.components[name] as any;
    if(!component||!isText(component.observation_id,128)||observationIds.has(component.observation_id)||
        component.provider_observation_id!==payload.provider_observation_id||component.source!==requirements[name].source||
        component.state!==requirements[name].state||!isUtc(component.observed_at,ports.now)) fail('LOCAL_LIVENESS_EVIDENCE_COMPONENT_INVALID');
    validateIdentity(component,identity);
    observationIds.add(component.observation_id);
  }
  const providerComponent=payload.components.provider_agent_session;
  const heartbeat=payload.components.supervisor_heartbeat;
  if(providerComponent.provider_session_id!==identity.provider_session_id||
      heartbeat.heartbeat_id!==heartbeat.observation_id||!isText(heartbeat.heartbeat_evidence_ref,128)||
      !/^recovery:\/\/supervisor-heartbeat\/[a-f0-9]{32}$/.test(heartbeat.heartbeat_evidence_ref)||
      !/^sha256:[a-f0-9]{64}$/.test(heartbeat.heartbeat_evidence_digest??'')) fail('LOCAL_LIVENESS_EVIDENCE_BINDING_INVALID');
  const signed=persistSignedEvidence('local',LOCAL_SCHEMA,{...payload},ports);
  const readback={schema:LOCAL_READBACK_SCHEMA,...identity,observation_id:payload.observation_id,
    provider_observation_id:payload.provider_observation_id,observed_at:payload.observed_at,
    evidence_ref:signed.reference,evidence_digest:signed.evidenceDigest};
  publishExactReadback(Buffer.from(JSON.stringify(readback)),ports);
  return {...signed,readback};
}
