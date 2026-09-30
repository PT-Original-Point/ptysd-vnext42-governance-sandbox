import { createHash } from 'node:crypto';

export const EXECUTION_ATTEMPT_SCHEMA = 'v49.execution-attempt.v1';
export const EXECUTION_ATTEMPT_STATES = Object.freeze(['READY','DISPATCHING','READBACK_REQUIRED','RECOVERY_REQUIRED','COMPLETED','FAILED']);
export const SIDE_EFFECT_STATES = Object.freeze(['NONE','PENDING','UNKNOWN','APPLIED','NOT_APPLIED','PARTIAL_OR_AMBIGUOUS']);
export const READBACK_STATES = Object.freeze(['NOT_REQUIRED','REQUIRED','CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','PARTIAL_OR_AMBIGUOUS']);
export const MUTATION_CLASSES = Object.freeze(['LOCAL_PREPARATION','LOCAL_EXECUTION','PROVIDER_EFFECT','HUMAN_RESERVED']);

const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_RE=/^sha256:[0-9a-f]{64}$/;
const TERMINAL=new Set(['COMPLETED','FAILED']);
const MUTATIONS=new Set(MUTATION_CLASSES);
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const digest=v=>`sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const clone=v=>structuredClone(v);
const fail=(code,detail='')=>{throw new Error(detail?`${code}:${detail}`:code);};
const reqId=(v,n)=>{if(typeof v!=='string'||!ID_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqText=(v,n,max=1024)=>{if(typeof v!=='string'||!v||Buffer.byteLength(v,'utf8')>max)fail(`INVALID_${n}`);return v;};
const reqDigest=(v,n)=>{if(typeof v!=='string'||!DIGEST_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqInt=(v,min,max,n)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(`INVALID_${n}`);return v;};
const reqTime=(v,n)=>{const s=reqText(v,n,128),ms=Date.parse(s);if(!Number.isFinite(ms))fail(`INVALID_${n}`);return {s,ms};};

function precondition(v){
  if(!v||typeof v!=='object'||Array.isArray(v))fail('PROVIDER_PRECONDITION_REQUIRED');
  const keys=Object.keys(v);
  if(keys.length<1||keys.length>16)fail('INVALID_PROVIDER_PRECONDITION');
  if(Buffer.byteLength(JSON.stringify(v),'utf8')>4096)fail('PROVIDER_PRECONDITION_TOO_LARGE');
  return clone(stable(v));
}
function fence(v){
  if(!v||typeof v!=='object'||Array.isArray(v))fail('CURRENT_ATTEMPT_FENCE_REQUIRED');
  return {
    project_id:reqId(v.project_id,'FENCE_PROJECT_ID'),
    mission_revision:reqText(v.mission_revision,'FENCE_MISSION_REVISION',256),
    mission_hash:reqDigest(v.mission_hash,'FENCE_MISSION_HASH'),
    authorization_envelope_digest:reqDigest(v.authorization_envelope_digest,'FENCE_AUTHORIZATION_ENVELOPE_DIGEST'),
    run_id:reqId(v.run_id,'FENCE_RUN_ID'),
    atomic_unit_id:reqId(v.atomic_unit_id,'FENCE_ATOMIC_UNIT_ID'),
    attempt_id:reqId(v.attempt_id,'FENCE_ATTEMPT_ID'),
    attempt_epoch:reqInt(v.attempt_epoch,1,2147483647,'FENCE_ATTEMPT_EPOCH'),
    operation_id:reqId(v.operation_id,'FENCE_OPERATION_ID'),
    now:reqTime(v.now,'FENCE_NOW').s,
  };
}
function payload(attempt){const x=clone(attempt);delete x.attempt_digest;return x;}
function seal(attempt){const x=clone(attempt);delete x.attempt_digest;return {...x,attempt_digest:digest(x)};}
function validateDigest(attempt){
  if(!attempt||attempt.schema!==EXECUTION_ATTEMPT_SCHEMA)fail('EXECUTION_ATTEMPT_SCHEMA_MISMATCH');
  const claimed=reqDigest(attempt.attempt_digest,'ATTEMPT_DIGEST');
  if(digest(payload(attempt))!==claimed)fail('EXECUTION_ATTEMPT_DIGEST_MISMATCH');
}
function bind(attempt,current){
  const f=fence(current);
  for(const [k,code] of [
    ['project_id','STALE_PROJECT'],['mission_revision','STALE_MISSION_REVISION'],['mission_hash','STALE_MISSION_HASH'],
    ['authorization_envelope_digest','STALE_AUTHORIZATION_ENVELOPE'],['run_id','STALE_RUN'],['atomic_unit_id','STALE_ATOMIC_UNIT'],
    ['attempt_id','STALE_ATTEMPT'],['attempt_epoch','STALE_EPOCH'],['operation_id','STALE_OPERATION'],
  ]) if(attempt[k]!==f[k])fail(code);
  return f;
}
function transitionBase(attempt,current){
  validateDigest(attempt);
  const f=bind(attempt,current);
  if(TERMINAL.has(attempt.state))fail('ATTEMPT_TERMINAL');
  return {x:clone(attempt),f};
}
function observationRef(v){return reqText(v,'PROVIDER_OBSERVATION_REF',2048);}

export function createExecutionAttempt(spec,currentFence){
  if(!spec||typeof spec!=='object'||Array.isArray(spec))fail('EXECUTION_ATTEMPT_SPEC_REQUIRED');
  const f=fence(currentFence);
  const mutationClass=reqText(spec.mutation_class,'MUTATION_CLASS',64);
  if(!MUTATIONS.has(mutationClass))fail('INVALID_MUTATION_CLASS');
  const started=reqTime(spec.started_at,'STARTED_AT');
  const deadline=reqTime(spec.deadline,'DEADLINE');
  if(deadline.ms<=started.ms)fail('INVALID_DEADLINE_ORDER');
  if(Date.parse(f.now)<started.ms)fail('ATTEMPT_NOT_STARTED');
  const x={
    schema:EXECUTION_ATTEMPT_SCHEMA,
    project_id:reqId(spec.project_id,'PROJECT_ID'),
    mission_revision:reqText(spec.mission_revision,'MISSION_REVISION',256),
    mission_hash:reqDigest(spec.mission_hash,'MISSION_HASH'),
    authorization_envelope_digest:reqDigest(spec.authorization_envelope_digest,'AUTHORIZATION_ENVELOPE_DIGEST'),
    run_id:reqId(spec.run_id,'RUN_ID'),
    atomic_unit_id:reqId(spec.atomic_unit_id,'ATOMIC_UNIT_ID'),
    attempt_id:reqId(spec.attempt_id,'ATTEMPT_ID'),
    attempt_epoch:reqInt(spec.attempt_epoch,1,2147483647,'ATTEMPT_EPOCH'),
    operation_id:reqId(spec.operation_id,'OPERATION_ID'),
    state:'READY',
    started_at:started.s,
    deadline:deadline.s,
    finished_at:null,
    executor:reqId(spec.executor,'EXECUTOR'),
    tool:reqId(spec.tool,'TOOL'),
    route:reqId(spec.route,'ROUTE'),
    mutation_class:mutationClass,
    provider_precondition:precondition(spec.provider_precondition),
    idempotency_key:reqText(spec.idempotency_key,'IDEMPOTENCY_KEY',256),
    side_effect_state:'NONE',
    readback_state:'NOT_REQUIRED',
    dispatch_count:0,
    readback_count:0,
    terminal_reason:null,
    last_dispatch_observed_at:null,
    last_provider_observation_ref:null,
    retry_of_attempt_id:null,
    retry_of_attempt_epoch:null,
  };
  for(const [k,code] of [
    ['project_id','STALE_PROJECT'],['mission_revision','STALE_MISSION_REVISION'],['mission_hash','STALE_MISSION_HASH'],
    ['authorization_envelope_digest','STALE_AUTHORIZATION_ENVELOPE'],['run_id','STALE_RUN'],['atomic_unit_id','STALE_ATOMIC_UNIT'],
    ['attempt_id','STALE_ATTEMPT'],['attempt_epoch','STALE_EPOCH'],['operation_id','STALE_OPERATION'],
  ]) if(x[k]!==f[k])fail(code);
  return seal(x);
}

export function assertExecutionAttemptCurrent(attempt,currentFence){
  validateDigest(attempt);
  bind(attempt,currentFence);
  return true;
}

export function beginExecutionDispatch(attempt,currentFence){
  const {x,f}=transitionBase(attempt,currentFence);
  if(x.state==='READBACK_REQUIRED'||x.state==='RECOVERY_REQUIRED')fail('READBACK_REQUIRED_BEFORE_RETRY');
  if(x.state==='DISPATCHING'||x.dispatch_count>0)fail('DUPLICATE_DISPATCH_DENIED');
  if(x.state!=='READY')fail('ATTEMPT_NOT_DISPATCHABLE');
  if(Date.parse(f.now)>=Date.parse(x.deadline))fail('ATTEMPT_DEADLINE_EXPIRED');
  x.state='DISPATCHING';
  x.side_effect_state='PENDING';
  x.readback_state='NOT_REQUIRED';
  x.dispatch_count=1;
  return seal(x);
}

export function recordExecutionDispatchOutcome(attempt,currentFence,{classification,observed_at}={}){
  const {x}=transitionBase(attempt,currentFence);
  if(x.state!=='DISPATCHING'||x.dispatch_count!==1)fail('DISPATCH_OUTCOME_WITHOUT_DISPATCH');
  const observed=reqTime(observed_at,'DISPATCH_OBSERVED_AT').s;
  x.last_dispatch_observed_at=observed;
  if(classification==='ACKNOWLEDGED'){
    x.state='READBACK_REQUIRED';
    x.side_effect_state='PENDING';
    x.readback_state='REQUIRED';
  }else if(classification==='UNKNOWN'){
    x.state='RECOVERY_REQUIRED';
    x.side_effect_state='UNKNOWN';
    x.readback_state='REQUIRED';
  }else if(classification==='PARTIAL_OR_AMBIGUOUS'){
    x.state='RECOVERY_REQUIRED';
    x.side_effect_state='PARTIAL_OR_AMBIGUOUS';
    x.readback_state='REQUIRED';
  }else if(classification==='REJECTED_BEFORE_EFFECT'){
    x.state='FAILED';
    x.side_effect_state='NOT_APPLIED';
    x.readback_state='NOT_REQUIRED';
    x.terminal_reason='DISPATCH_REJECTED_BEFORE_EFFECT';
    x.finished_at=observed;
  }else{
    fail('INVALID_DISPATCH_CLASSIFICATION');
  }
  return seal(x);
}

export function recordExecutionReadback(attempt,currentFence,{classification,observed_at,provider_observation_ref}={}){
  validateDigest(attempt);
  const f=bind(attempt,currentFence);
  if(TERMINAL.has(attempt.state))fail('ATTEMPT_TERMINAL');
  if(!['READBACK_REQUIRED','RECOVERY_REQUIRED'].includes(attempt.state))fail('READBACK_NOT_REQUIRED');
  const x=clone(attempt);
  x.readback_count=reqInt(x.readback_count,0,Number.MAX_SAFE_INTEGER,'READBACK_COUNT')+1;
  x.last_provider_observation_ref=observationRef(provider_observation_ref);
  const observed=reqTime(observed_at,'READBACK_OBSERVED_AT').s;
  if(Date.parse(observed)>Date.parse(f.now)+300000)fail('READBACK_OBSERVED_IN_FUTURE');
  if(classification==='CONFIRMED_APPLIED'){
    x.state='COMPLETED';
    x.side_effect_state='APPLIED';
    x.readback_state='CONFIRMED_APPLIED';
    x.terminal_reason='READBACK_CONFIRMED_APPLIED';
    x.finished_at=observed;
  }else if(classification==='CONFIRMED_NOT_APPLIED'){
    x.state='FAILED';
    x.side_effect_state='NOT_APPLIED';
    x.readback_state='CONFIRMED_NOT_APPLIED';
    x.terminal_reason='READBACK_CONFIRMED_NOT_APPLIED';
    x.finished_at=observed;
  }else if(classification==='PARTIAL_OR_AMBIGUOUS'){
    x.state='RECOVERY_REQUIRED';
    x.side_effect_state='PARTIAL_OR_AMBIGUOUS';
    x.readback_state='PARTIAL_OR_AMBIGUOUS';
    x.terminal_reason=null;
    x.finished_at=null;
  }else{
    fail('INVALID_READBACK_CLASSIFICATION');
  }
  return seal(x);
}

export function createRetryExecutionAttempt(prior,retrySpec,currentFence){
  validateDigest(prior);
  if(prior.state!=='FAILED'||prior.side_effect_state!=='NOT_APPLIED')fail('RETRY_REQUIRES_CONFIRMED_NOT_APPLIED');
  if(!['CONFIRMED_NOT_APPLIED','NOT_REQUIRED'].includes(prior.readback_state))fail('READBACK_REQUIRED_BEFORE_RETRY');
  if(prior.readback_state==='NOT_REQUIRED'&&prior.terminal_reason!=='DISPATCH_REJECTED_BEFORE_EFFECT')fail('READBACK_REQUIRED_BEFORE_RETRY');
  if(prior.readback_state==='CONFIRMED_NOT_APPLIED'&&!prior.last_provider_observation_ref)fail('PROVIDER_OBSERVATION_REQUIRED_FOR_RETRY');
  if(!retrySpec||typeof retrySpec!=='object'||Array.isArray(retrySpec))fail('RETRY_SPEC_REQUIRED');
  const nextEpoch=reqInt(retrySpec.attempt_epoch,1,2147483647,'ATTEMPT_EPOCH');
  if(nextEpoch!==prior.attempt_epoch+1)fail('RETRY_EPOCH_MUST_INCREMENT_ONCE');
  const nextAttempt=reqId(retrySpec.attempt_id,'ATTEMPT_ID');
  if(nextAttempt===prior.attempt_id)fail('RETRY_ATTEMPT_ID_MUST_CHANGE');
  const recoveryRef=retrySpec.recovery_observation_ref??null;
  if(prior.readback_state==='CONFIRMED_NOT_APPLIED'&&recoveryRef!==prior.last_provider_observation_ref)fail('RETRY_OBSERVATION_REF_MISMATCH');
  if(retrySpec.operation_id!==undefined&&retrySpec.operation_id!==prior.operation_id)fail('RETRY_OPERATION_ID_MISMATCH');
  if(retrySpec.idempotency_key!==undefined&&retrySpec.idempotency_key!==prior.idempotency_key)fail('RETRY_IDEMPOTENCY_KEY_MISMATCH');
  const next=createExecutionAttempt({
    project_id:prior.project_id,mission_revision:prior.mission_revision,mission_hash:prior.mission_hash,
    authorization_envelope_digest:prior.authorization_envelope_digest,run_id:prior.run_id,atomic_unit_id:prior.atomic_unit_id,
    attempt_id:nextAttempt,attempt_epoch:nextEpoch,operation_id:prior.operation_id,
    started_at:retrySpec.started_at,deadline:retrySpec.deadline,executor:retrySpec.executor??prior.executor,
    tool:retrySpec.tool??prior.tool,route:retrySpec.route??prior.route,mutation_class:prior.mutation_class,
    provider_precondition:retrySpec.provider_precondition,idempotency_key:prior.idempotency_key,
  },currentFence);
  const x=clone(next);
  delete x.attempt_digest;
  x.retry_of_attempt_id=prior.attempt_id;
  x.retry_of_attempt_epoch=prior.attempt_epoch;
  return seal(x);
}
