import { createHash } from 'node:crypto';

export const AUTHORIZATION_ENVELOPE_SCHEMA = 'v49.authorization-envelope.v1';
export const HUMAN_RESERVATION_PERMIT_SCHEMA = 'v49.human-reservation-permit.v1';
export const AUTHORIZABLE_EFFECT_CLASSES = Object.freeze(['LOCAL_PREPARATION','LOCAL_EXECUTION','PROVIDER_EFFECT','HUMAN_RESERVED']);

const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_RE=/^sha256:[0-9a-f]{64}$/;
const EFFECT_SET=new Set(AUTHORIZABLE_EFFECT_CLASSES);
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const digest=v=>`sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const fail=(code,detail='')=>{throw new Error(detail?`${code}:${detail}`:code);};
const reqId=(v,n)=>{if(typeof v!=='string'||!ID_RE.test(v))fail(`INVALID_${n}`);return v;};
const reqText=(v,n,max=512)=>{if(typeof v!=='string'||!v||Buffer.byteLength(v,'utf8')>max)fail(`INVALID_${n}`);return v;};
const reqDigest=(v,n)=>{if(typeof v!=='string'||!DIGEST_RE.test(v))fail(`INVALID_${n}`);return v;};
const list=(v,n,{allowEmpty=true}={})=>{
  if(!Array.isArray(v)||(!allowEmpty&&v.length===0))fail(`INVALID_${n}`);
  const out=[];
  for(const item of v){const x=reqId(item,n);if(!out.includes(x))out.push(x);}
  return out.sort();
};
const clone=v=>structuredClone(v);

function envelopePayload(envelope){const x=clone(envelope);delete x.envelope_digest;return x;}
function permitPayload(permit){const x=clone(permit);delete x.permit_digest;return x;}
function missionTuple(mission){
  if(!mission||typeof mission!=='object'||Array.isArray(mission))fail('CURRENT_MISSION_REQUIRED');
  return {
    project_id:reqId(mission.project_id,'MISSION_PROJECT_ID'),
    revision:reqText(mission.revision,'MISSION_REVISION',256),
    hash:reqDigest(mission.hash,'MISSION_HASH'),
  };
}

export function compileAuthorizationEnvelope(source,currentMission){
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
  const conflict=forbidden.find(x=>reservations.includes(x));
  if(conflict)fail('FORBIDDEN_RESERVATION_COLLISION',conflict);
  const envelope={
    schema:AUTHORIZATION_ENVELOPE_SCHEMA,
    authorization_id:reqId(source.authorization_id,'AUTHORIZATION_ID'),
    project_id:projectId,
    mission_revision:missionRevision,
    mission_hash:missionHash,
    valid_until_mission_revision:validUntil,
    scope_tags:scopeTags,
    allowed_mutation_classes:allowed,
    forbidden_actions:forbidden,
    human_reservations:reservations,
    human_authorization_ref:reqText(source.human_authorization_ref,'HUMAN_AUTHORIZATION_REF',1024),
    issued_at:reqText(source.issued_at,'ISSUED_AT',128),
  };
  return {...envelope,envelope_digest:digest(envelope)};
}

export function validateAuthorizationEnvelope(envelope,currentMission){
  if(!envelope||envelope.schema!==AUTHORIZATION_ENVELOPE_SCHEMA)fail('AUTHORIZATION_ENVELOPE_SCHEMA_MISMATCH');
  const claimed=reqDigest(envelope.envelope_digest,'AUTHORIZATION_ENVELOPE_DIGEST');
  if(digest(envelopePayload(envelope))!==claimed)fail('AUTHORIZATION_ENVELOPE_DIGEST_MISMATCH');
  const mission=missionTuple(currentMission);
  if(envelope.project_id!==mission.project_id)fail('AUTHORIZATION_PROJECT_MISMATCH');
  if(envelope.mission_revision!==mission.revision||envelope.valid_until_mission_revision!==mission.revision)fail('AUTHORIZATION_MISSION_REVISION_STALE');
  if(envelope.mission_hash!==mission.hash)fail('AUTHORIZATION_MISSION_HASH_STALE');
  list(envelope.scope_tags,'SCOPE_TAG',{allowEmpty:false});
  const allowed=list(envelope.allowed_mutation_classes,'ALLOWED_MUTATION_CLASS',{allowEmpty:false});
  for(const effect of allowed)if(!EFFECT_SET.has(effect))fail('INVALID_ALLOWED_MUTATION_CLASS',effect);
  list(envelope.forbidden_actions??[],'FORBIDDEN_ACTION');
  list(envelope.human_reservations??[],'HUMAN_RESERVATION');
  return true;
}

export function compileHumanReservationPermit(source,currentMission){
  if(!source||typeof source!=='object'||Array.isArray(source))fail('HUMAN_RESERVATION_SOURCE_REQUIRED');
  const mission=missionTuple(currentMission);
  if(reqId(source.project_id,'PROJECT_ID')!==mission.project_id)fail('HUMAN_PERMIT_PROJECT_MISMATCH');
  if(reqText(source.mission_revision,'MISSION_REVISION',256)!==mission.revision)fail('HUMAN_PERMIT_MISSION_STALE');
  if(reqDigest(source.mission_hash,'MISSION_HASH')!==mission.hash)fail('HUMAN_PERMIT_MISSION_HASH_STALE');
  const permit={
    schema:HUMAN_RESERVATION_PERMIT_SCHEMA,
    permit_id:reqId(source.permit_id,'PERMIT_ID'),
    project_id:mission.project_id,
    mission_revision:mission.revision,
    mission_hash:mission.hash,
    action_id:reqId(source.action_id,'ACTION_ID'),
    human_authorization_ref:reqText(source.human_authorization_ref,'HUMAN_AUTHORIZATION_REF',1024),
    issued_at:reqText(source.issued_at,'ISSUED_AT',128),
  };
  return {...permit,permit_digest:digest(permit)};
}

export function validateHumanReservationPermit(permit,currentMission,actionId){
  if(!permit||permit.schema!==HUMAN_RESERVATION_PERMIT_SCHEMA)fail('HUMAN_PERMIT_REQUIRED');
  const claimed=reqDigest(permit.permit_digest,'HUMAN_PERMIT_DIGEST');
  if(digest(permitPayload(permit))!==claimed)fail('HUMAN_PERMIT_DIGEST_MISMATCH');
  const mission=missionTuple(currentMission);
  if(permit.project_id!==mission.project_id)fail('HUMAN_PERMIT_PROJECT_MISMATCH');
  if(permit.mission_revision!==mission.revision||permit.mission_hash!==mission.hash)fail('HUMAN_PERMIT_MISSION_STALE');
  if(permit.action_id!==actionId)fail('HUMAN_PERMIT_ACTION_MISMATCH');
  return true;
}

export function evaluateAuthorization({envelope,current_mission,identity,request,human_reservation_permit=null}={}){
  if(!request||typeof request!=='object'||Array.isArray(request))return {authorized:false,reason_codes:['AUTHORIZATION_REQUEST_REQUIRED']};
  if(request.effect_class==='READ_ONLY')return {authorized:true,envelope_required:false,human_reservation_required:false};
  const reasons=[];
  try{validateAuthorizationEnvelope(envelope,current_mission);}catch(error){reasons.push(String(error.message));}
  const actionId=typeof request.action_id==='string'&&ID_RE.test(request.action_id)?request.action_id:null;
  const scopeTag=typeof request.authorization_scope_tag==='string'&&ID_RE.test(request.authorization_scope_tag)?request.authorization_scope_tag:null;
  if(!identity||identity.project_id!==envelope?.project_id)reasons.push('AUTHORIZATION_IDENTITY_PROJECT_MISMATCH');
  if(!actionId)reasons.push('AUTHORIZATION_ACTION_ID_REQUIRED');
  if(!scopeTag)reasons.push('AUTHORIZATION_SCOPE_TAG_REQUIRED');
  if(request.effect_class!=='READ_ONLY'&&!EFFECT_SET.has(request.effect_class))reasons.push('AUTHORIZATION_EFFECT_CLASS_INVALID');
  if(envelope&&EFFECT_SET.has(request.effect_class)&&!envelope.allowed_mutation_classes?.includes(request.effect_class))reasons.push('AUTHORIZATION_MUTATION_CLASS_DENY');
  if(scopeTag&&envelope&&!envelope.scope_tags?.includes(scopeTag))reasons.push('AUTHORIZATION_SCOPE_DENY');
  if(actionId&&envelope?.forbidden_actions?.includes(actionId))reasons.push('AUTHORIZATION_ACTION_FORBIDDEN');
  const reservationRequired=request.effect_class==='HUMAN_RESERVED'||(actionId&&envelope?.human_reservations?.includes(actionId));
  if(reservationRequired){
    try{validateHumanReservationPermit(human_reservation_permit,current_mission,actionId);}catch(error){reasons.push(String(error.message));}
  }
  const unique=[...new Set(reasons)].sort();
  const out={authorized:unique.length===0,envelope_required:true,human_reservation_required:reservationRequired,reason_codes:unique,authorization_id:envelope?.authorization_id??null,envelope_digest:envelope?.envelope_digest??null};
  out.authorization_decision_digest=digest(out);
  return out;
}
