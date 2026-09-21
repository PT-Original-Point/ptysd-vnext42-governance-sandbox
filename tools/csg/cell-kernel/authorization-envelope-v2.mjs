import { createHash } from 'node:crypto';

export const AUTHORIZATION_ENVELOPE_V2_SCHEMA='v49.authorization-envelope.v2';
export const AUTHORIZATION_STATE_SCHEMA='v49.authorization-state.v1';
export const AUTHORIZABLE_EFFECT_CLASSES_V2=Object.freeze(['LOCAL_PREPARATION','LOCAL_EXECUTION','PROVIDER_EFFECT','HUMAN_RESERVED']);

const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_RE=/^sha256:[0-9a-f]{64}$/;
const EFFECT_SET=new Set(AUTHORIZABLE_EFFECT_CLASSES_V2);
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const digest=v=>`sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const clone=v=>structuredClone(v);
const fail=(code,detail='')=>{throw new Error(detail?`${code}:${detail}`:code);};
const reqId=(v,n)=>{if(typeof v!=='string'||!ID_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqText=(v,n,max=1024)=>{if(typeof v!=='string'||!v||Buffer.byteLength(v,'utf8')>max)fail(`INVALID_${n}`);return v;};
const reqDigest=(v,n)=>{if(typeof v!=='string'||!DIGEST_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqInt=(v,n)=>{if(!Number.isSafeInteger(v)||v<1||v>2147483647)fail(`INVALID_${n}`);return v;};
const reqNullableId=(v,n)=>v===null?null:reqId(v,n);
const reqNullableText=(v,n,max=2048)=>v===null?null:reqText(v,n,max);
const reqTime=(v,n)=>{const s=reqText(v,n,128);if(!Number.isFinite(Date.parse(s)))fail(`INVALID_${n}`);return s;};
const list=(v,n,{allowEmpty=true}={})=>{
  if(!Array.isArray(v)||(!allowEmpty&&v.length===0))fail(`INVALID_${n}`);
  const out=[];for(const item of v){const x=reqId(item,n);if(!out.includes(x))out.push(x);}return out.sort();
};
function missionTuple(mission){
  if(!mission||typeof mission!=='object'||Array.isArray(mission))fail('CURRENT_MISSION_REQUIRED');
  return {project_id:reqId(mission.project_id,'MISSION_PROJECT_ID'),revision:reqText(mission.revision,'MISSION_REVISION',256),hash:reqDigest(mission.hash,'MISSION_HASH')};
}
function envelopePayload(x){const y=clone(x);delete y.envelope_digest;return y;}
function statePayload(x){const y=clone(x);delete y.state_digest;return y;}

export function compileAuthorizationState(source,currentMission){
  if(!source||typeof source!=='object'||Array.isArray(source))fail('AUTHORIZATION_STATE_SOURCE_REQUIRED');
  const mission=missionTuple(currentMission);
  const projectId=reqId(source.project_id,'PROJECT_ID');
  if(projectId!==mission.project_id)fail('AUTHORIZATION_STATE_PROJECT_MISMATCH');
  if(reqText(source.mission_revision,'MISSION_REVISION',256)!==mission.revision)fail('AUTHORIZATION_STATE_MISSION_REVISION_MISMATCH');
  if(reqDigest(source.mission_hash,'MISSION_HASH')!==mission.hash)fail('AUTHORIZATION_STATE_MISSION_HASH_MISMATCH');
  const state={
    schema:AUTHORIZATION_STATE_SCHEMA,
    project_id:projectId,
    mission_revision:mission.revision,
    mission_hash:mission.hash,
    current_authorization_id:reqId(source.current_authorization_id,'CURRENT_AUTHORIZATION_ID'),
    authorization_generation:reqInt(source.authorization_generation,'AUTHORIZATION_GENERATION'),
    supersedes:reqNullableId(source.supersedes??null,'SUPERSEDES'),
    revoked_authorization_ids:list(source.revoked_authorization_ids??[],'REVOKED_AUTHORIZATION_ID'),
    human_authorization_ref:reqText(source.human_authorization_ref,'HUMAN_AUTHORIZATION_REF',1024),
    recorded_at:reqTime(source.recorded_at,'RECORDED_AT'),
  };
  if(state.revoked_authorization_ids.includes(state.current_authorization_id))fail('CURRENT_AUTHORIZATION_CANNOT_BE_REVOKED');
  return {...state,state_digest:digest(state)};
}

export function validateAuthorizationState(state,currentMission){
  if(!state||state.schema!==AUTHORIZATION_STATE_SCHEMA)fail('AUTHORIZATION_STATE_SCHEMA_MISMATCH');
  if(digest(statePayload(state))!==reqDigest(state.state_digest,'AUTHORIZATION_STATE_DIGEST'))fail('AUTHORIZATION_STATE_DIGEST_MISMATCH');
  const mission=missionTuple(currentMission);
  if(state.project_id!==mission.project_id)fail('AUTHORIZATION_STATE_PROJECT_MISMATCH');
  if(state.mission_revision!==mission.revision||state.mission_hash!==mission.hash)fail('AUTHORIZATION_STATE_MISSION_STALE');
  reqInt(state.authorization_generation,'AUTHORIZATION_GENERATION');
  if(state.revoked_authorization_ids?.includes(state.current_authorization_id))fail('CURRENT_AUTHORIZATION_REVOKED');
  return true;
}

export function compileAuthorizationEnvelopeV2(source,currentMission){
  if(!source||typeof source!=='object'||Array.isArray(source))fail('AUTHORIZATION_SOURCE_REQUIRED');
  const mission=missionTuple(currentMission);
  const projectId=reqId(source.project_id,'PROJECT_ID');
  const missionRevision=reqText(source.mission_revision,'MISSION_REVISION',256);
  const missionHash=reqDigest(source.mission_hash,'MISSION_HASH');
  if(projectId!==mission.project_id)fail('AUTHORIZATION_PROJECT_MISMATCH');
  if(missionRevision!==mission.revision)fail('AUTHORIZATION_MISSION_REVISION_MISMATCH');
  if(missionHash!==mission.hash)fail('AUTHORIZATION_MISSION_HASH_MISMATCH');
  const validUntil=reqText(source.valid_until_mission_revision,'VALID_UNTIL_MISSION_REVISION',256);
  if(validUntil!==missionRevision)fail('AUTHORIZATION_MUST_EXPIRE_ON_MISSION_CHANGE');
  const allowed=list(source.allowed_mutation_classes,'ALLOWED_MUTATION_CLASS',{allowEmpty:false});
  for(const effect of allowed)if(!EFFECT_SET.has(effect))fail('INVALID_ALLOWED_MUTATION_CLASS',effect);
  const scopeTags=list(source.scope_tags,'SCOPE_TAG',{allowEmpty:false});
  const forbidden=list(source.forbidden_actions??[],'FORBIDDEN_ACTION');
  const reservations=list(source.human_reservations??[],'HUMAN_RESERVATION');
  const conflict=forbidden.find(x=>reservations.includes(x));if(conflict)fail('FORBIDDEN_RESERVATION_COLLISION',conflict);
  const revokedAt=source.revoked_at===null||source.revoked_at===undefined?null:reqTime(source.revoked_at,'REVOKED_AT');
  const envelope={
    schema:AUTHORIZATION_ENVELOPE_V2_SCHEMA,
    authorization_id:reqId(source.authorization_id,'AUTHORIZATION_ID'),
    authorization_generation:reqInt(source.authorization_generation,'AUTHORIZATION_GENERATION'),
    supersedes:reqNullableId(source.supersedes??null,'SUPERSEDES'),
    project_id:projectId,
    mission_revision:missionRevision,
    mission_hash:missionHash,
    valid_until_mission_revision:validUntil,
    scope_tags:scopeTags,
    allowed_mutation_classes:allowed,
    forbidden_actions:forbidden,
    human_reservations:reservations,
    human_authorization_ref:reqText(source.human_authorization_ref,'HUMAN_AUTHORIZATION_REF',1024),
    issued_at:reqTime(source.issued_at,'ISSUED_AT'),
    revoked_at:revokedAt,
    revocation_ref:reqNullableText(source.revocation_ref??null,'REVOCATION_REF',2048),
  };
  if(envelope.revoked_at!==null&&envelope.revocation_ref===null)fail('AUTHORIZATION_REVOCATION_REF_REQUIRED');
  return {...envelope,envelope_digest:digest(envelope)};
}

export function validateAuthorizationEnvelopeV2(envelope,currentMission,authorizationState){
  if(!envelope||envelope.schema!==AUTHORIZATION_ENVELOPE_V2_SCHEMA)fail('AUTHORIZATION_ENVELOPE_SCHEMA_MISMATCH');
  if(digest(envelopePayload(envelope))!==reqDigest(envelope.envelope_digest,'AUTHORIZATION_ENVELOPE_DIGEST'))fail('AUTHORIZATION_ENVELOPE_DIGEST_MISMATCH');
  validateAuthorizationState(authorizationState,currentMission);
  const mission=missionTuple(currentMission);
  if(envelope.project_id!==mission.project_id)fail('AUTHORIZATION_PROJECT_MISMATCH');
  if(envelope.mission_revision!==mission.revision||envelope.valid_until_mission_revision!==mission.revision)fail('AUTHORIZATION_MISSION_REVISION_STALE');
  if(envelope.mission_hash!==mission.hash)fail('AUTHORIZATION_MISSION_HASH_STALE');
  if(envelope.revoked_at!==null)fail('AUTHORIZATION_REVOKED');
  if(authorizationState.revoked_authorization_ids.includes(envelope.authorization_id))fail('AUTHORIZATION_REVOKED');
  if(envelope.authorization_id!==authorizationState.current_authorization_id)fail('AUTHORIZATION_NOT_CURRENT');
  if(envelope.authorization_generation!==authorizationState.authorization_generation)fail('AUTHORIZATION_GENERATION_STALE');
  return true;
}

export function evaluateAuthorizationV2({envelope,current_mission,authorization_state,identity,request,human_reservation_permit=null,validate_human_reservation_permit}={}){
  if(!request||typeof request!=='object'||Array.isArray(request))return {authorized:false,reason_codes:['AUTHORIZATION_REQUEST_REQUIRED']};
  if(request.effect_class==='READ_ONLY')return {authorized:true,envelope_required:false,human_reservation_required:false,authorization_generation:null};
  const reasons=[];
  try{validateAuthorizationEnvelopeV2(envelope,current_mission,authorization_state);}catch(error){reasons.push(String(error.message));}
  const actionId=typeof request.action_id==='string'&&ID_RE.test(request.action_id)?request.action_id:null;
  const scopeTag=typeof request.authorization_scope_tag==='string'&&ID_RE.test(request.authorization_scope_tag)?request.authorization_scope_tag:null;
  if(!identity||identity.project_id!==envelope?.project_id)reasons.push('AUTHORIZATION_IDENTITY_PROJECT_MISMATCH');
  if(!actionId)reasons.push('AUTHORIZATION_ACTION_ID_REQUIRED');
  if(!scopeTag)reasons.push('AUTHORIZATION_SCOPE_TAG_REQUIRED');
  if(!EFFECT_SET.has(request.effect_class))reasons.push('AUTHORIZATION_EFFECT_CLASS_INVALID');
  if(envelope&&EFFECT_SET.has(request.effect_class)&&!envelope.allowed_mutation_classes?.includes(request.effect_class))reasons.push('AUTHORIZATION_MUTATION_CLASS_DENY');
  if(scopeTag&&envelope&&!envelope.scope_tags?.includes(scopeTag))reasons.push('AUTHORIZATION_SCOPE_DENY');
  if(actionId&&envelope?.forbidden_actions?.includes(actionId))reasons.push('AUTHORIZATION_ACTION_FORBIDDEN');
  const reservationRequired=request.effect_class==='HUMAN_RESERVED'||(actionId&&envelope?.human_reservations?.includes(actionId));
  if(reservationRequired){
    if(typeof validate_human_reservation_permit!=='function')reasons.push('HUMAN_PERMIT_VALIDATOR_REQUIRED');
    else{try{validate_human_reservation_permit(human_reservation_permit,current_mission,actionId);}catch(error){reasons.push(String(error.message));}}
  }
  const unique=[...new Set(reasons)].sort();
  const out={
    authorized:unique.length===0,
    envelope_required:true,
    human_reservation_required:reservationRequired,
    reason_codes:unique,
    authorization_id:envelope?.authorization_id??null,
    authorization_generation:envelope?.authorization_generation??null,
    envelope_digest:envelope?.envelope_digest??null,
    authorization_state_digest:authorization_state?.state_digest??null,
  };
  out.authorization_decision_digest=digest(out);
  return out;
}
