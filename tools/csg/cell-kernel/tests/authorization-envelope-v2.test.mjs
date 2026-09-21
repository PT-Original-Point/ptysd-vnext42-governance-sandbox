import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORIZATION_ENVELOPE_V2_SCHEMA,
  AUTHORIZATION_STATE_SCHEMA,
  HUMAN_RESERVATION_PERMIT_V2_SCHEMA,
  compileAuthorizationEnvelopeV2,
  compileAuthorizationState,
  validateAuthorizationEnvelopeV2,
  advanceAuthorizationState,
  suspendAuthorizationState,
  compileHumanReservationPermitV2,
  validateHumanReservationPermitV2,
  evaluateAuthorizationV2,
} from '../authorization-envelope-v2.mjs';

const M='sha256:'+'1'.repeat(64);
const mission={project_id:'P',revision:'M1',hash:M};

const envelopeSource=(extra={})=>({
  authorization_id:'AUTH-002',
  authorization_generation:2,
  supersedes:'AUTH-001',
  project_id:'P',
  mission_revision:'M1',
  mission_hash:M,
  valid_until_mission_revision:'M1',
  scope_tags:['GOVERNANCE_HARDENING'],
  allowed_mutation_classes:['LOCAL_EXECUTION','PROVIDER_EFFECT','HUMAN_RESERVED'],
  forbidden_actions:['PRODUCTION'],
  human_reservations:['CODEX_LAST_MILE'],
  human_authorization_ref:'checkpoint://human-authorization',
  issued_at:'2026-09-21T10:00:00Z',
  revoked_at:null,
  revocation_ref:null,
  ...extra,
});

const initialState=()=>compileAuthorizationState({
  project_id:'P',
  mission_revision:'M1',
  mission_hash:M,
  status:'ACTIVE',
  current_authorization_id:'AUTH-001',
  authorization_generation:1,
  previous_state_digest:null,
  supersedes:null,
  revoked_authorization_ids:[],
  human_authorization_ref:'checkpoint://human-authorization-1',
  recorded_at:'2026-09-21T09:00:00Z',
},mission);

const state2=()=>{
  const p=initialState();
  return advanceAuthorizationState(p,p.state_digest,{
    project_id:'P',
    mission_revision:'M1',
    mission_hash:M,
    status:'ACTIVE',
    current_authorization_id:'AUTH-002',
    authorization_generation:2,
    previous_state_digest:p.state_digest,
    supersedes:'AUTH-001',
    revoked_authorization_ids:['AUTH-001'],
    human_authorization_ref:'checkpoint://human-authorization-2',
    recorded_at:'2026-09-21T10:00:00Z',
  },mission);
};

const request={effect_class:'LOCAL_EXECUTION',action_id:'GOV_REPAIR',authorization_scope_tag:'GOVERNANCE_HARDENING'};

test('v2 envelope and CAS generation state are deterministic and current',()=>{
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const state=state2();
  assert.equal(env.schema,AUTHORIZATION_ENVELOPE_V2_SCHEMA);
  assert.equal(state.schema,AUTHORIZATION_STATE_SCHEMA);
  assert.equal(state.authorization_generation,2);
  assert.equal(validateAuthorizationEnvelopeV2(env,mission,state),true);
  const out=evaluateAuthorizationV2({envelope:env,current_mission:mission,authorization_state:state,identity:{project_id:'P'},request});
  assert.equal(out.authorized,true);
  assert.equal(out.authorization_generation,2);
});

test('state transition is exact previous-digest CAS and generation+1 only',()=>{
  const p=initialState();
  const source={
    project_id:'P',mission_revision:'M1',mission_hash:M,status:'ACTIVE',
    current_authorization_id:'AUTH-002',authorization_generation:2,
    previous_state_digest:p.state_digest,supersedes:'AUTH-001',
    revoked_authorization_ids:['AUTH-001'],
    human_authorization_ref:'checkpoint://human-authorization-2',recorded_at:'2026-09-21T10:00:00Z',
  };
  assert.throws(()=>advanceAuthorizationState(p,'sha256:'+'9'.repeat(64),source,mission),/AUTHORIZATION_STATE_CAS_MISMATCH/);
  assert.throws(()=>advanceAuthorizationState(p,p.state_digest,{...source,authorization_generation:3},mission),/AUTHORIZATION_GENERATION_MUST_INCREMENT_ONCE/);
  assert.throws(()=>advanceAuthorizationState(p,p.state_digest,{...source,previous_state_digest:'sha256:'+'8'.repeat(64)},mission),/AUTHORIZATION_PREVIOUS_STATE_DIGEST_MISMATCH/);
  assert.throws(()=>advanceAuthorizationState(p,p.state_digest,{...source,supersedes:'AUTH-OTHER'},mission),/AUTHORIZATION_SUPERSEDES_CHAIN_MISMATCH/);
});

test('authorization history cannot drop a revoked predecessor',()=>{
  const p=initialState();
  assert.throws(()=>advanceAuthorizationState(p,p.state_digest,{
    project_id:'P',mission_revision:'M1',mission_hash:M,status:'ACTIVE',
    current_authorization_id:'AUTH-002',authorization_generation:2,
    previous_state_digest:p.state_digest,supersedes:'AUTH-001',revoked_authorization_ids:[],
    human_authorization_ref:'x',recorded_at:'2026-09-21T10:00:00Z',
  },mission),/AUTHORIZATION_REVOCATION_HISTORY_LOST/);
});

test('emergency suspension removes current mutation authority without mission change',()=>{
  const s=state2();
  const suspended=suspendAuthorizationState(s,s.state_digest,{
    human_authorization_ref:'checkpoint://emergency-stop',
    recorded_at:'2026-09-21T10:05:00Z',
  },mission);
  assert.equal(suspended.status,'SUSPENDED');
  assert.equal(suspended.current_authorization_id,null);
  assert.equal(suspended.authorization_generation,3);
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  assert.throws(()=>validateAuthorizationEnvelopeV2(env,mission,suspended),/AUTHORIZATION_STATE_NOT_ACTIVE/);
});

test('old generation is stale even when mission is unchanged',()=>{
  const old=compileAuthorizationEnvelopeV2(envelopeSource({authorization_id:'AUTH-001',authorization_generation:1,supersedes:null}),mission);
  const state=state2();
  assert.throws(()=>validateAuthorizationEnvelopeV2(old,mission,state),/AUTHORIZATION_REVOKED|AUTHORIZATION_NOT_CURRENT|AUTHORIZATION_GENERATION_STALE/);
});

test('explicit envelope revocation fails closed',()=>{
  const revoked=compileAuthorizationEnvelopeV2(envelopeSource({revoked_at:'2026-09-21T10:05:00Z',revocation_ref:'checkpoint://revoke-auth-002'}),mission);
  assert.throws(()=>validateAuthorizationEnvelopeV2(revoked,mission,state2()),/AUTHORIZATION_REVOKED/);
});

test('generation-bound HumanReservationPermit becomes stale after authorization rotation',()=>{
  const state=state2();
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const permit=compileHumanReservationPermitV2({
    permit_id:'PERMIT-002',permit_generation:2,project_id:'P',mission_revision:'M1',mission_hash:M,
    action_id:'CODEX_LAST_MILE',human_authorization_ref:'checkpoint://human-codex',issued_at:'2026-09-21T10:01:00Z',
  },mission,state,env);
  assert.equal(permit.schema,HUMAN_RESERVATION_PERMIT_V2_SCHEMA);
  assert.equal(validateHumanReservationPermitV2(permit,mission,'CODEX_LAST_MILE',state,env),true);

  const state3=advanceAuthorizationState(state,state.state_digest,{
    project_id:'P',mission_revision:'M1',mission_hash:M,status:'ACTIVE',
    current_authorization_id:'AUTH-003',authorization_generation:3,
    previous_state_digest:state.state_digest,supersedes:'AUTH-002',
    revoked_authorization_ids:['AUTH-001','AUTH-002'],
    human_authorization_ref:'checkpoint://human-authorization-3',recorded_at:'2026-09-21T10:02:00Z',
  },mission);
  const env3=compileAuthorizationEnvelopeV2(envelopeSource({
    authorization_id:'AUTH-003',authorization_generation:3,supersedes:'AUTH-002',issued_at:'2026-09-21T10:02:00Z',
  }),mission);
  assert.throws(()=>validateHumanReservationPermitV2(permit,mission,'CODEX_LAST_MILE',state3,env3),/HUMAN_PERMIT_AUTHORIZATION_ID_STALE|HUMAN_PERMIT_GENERATION_STALE|HUMAN_PERMIT_STATE_STALE/);
});

test('v2 human reservation evaluation requires v2 generation-bound permit',()=>{
  const state=state2();
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const reserved={effect_class:'HUMAN_RESERVED',action_id:'CODEX_LAST_MILE',authorization_scope_tag:'GOVERNANCE_HARDENING'};
  const noPermit=evaluateAuthorizationV2({envelope:env,current_mission:mission,authorization_state:state,identity:{project_id:'P'},request:reserved});
  assert.equal(noPermit.authorized,false);
  assert.ok(noPermit.reason_codes.some(x=>x.includes('HUMAN_PERMIT_V2_REQUIRED')));
  const permit=compileHumanReservationPermitV2({
    permit_id:'PERMIT-002',permit_generation:2,project_id:'P',mission_revision:'M1',mission_hash:M,
    action_id:'CODEX_LAST_MILE',human_authorization_ref:'checkpoint://human-codex',issued_at:'2026-09-21T10:01:00Z',
  },mission,state,env);
  const yes=evaluateAuthorizationV2({envelope:env,current_mission:mission,authorization_state:state,identity:{project_id:'P'},request:reserved,human_reservation_permit:permit});
  assert.equal(yes.authorized,true);
});

test('mission change stales generation-aware authorization state',()=>{
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const state=state2();
  const changed={project_id:'P',revision:'M2',hash:'sha256:'+'2'.repeat(64)};
  assert.throws(()=>validateAuthorizationEnvelopeV2(env,changed,state),/AUTHORIZATION_STATE_MISSION_STALE|AUTHORIZATION_MISSION_REVISION_STALE/);
});
