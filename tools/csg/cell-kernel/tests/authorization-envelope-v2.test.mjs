import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORIZATION_ENVELOPE_V2_SCHEMA,
  AUTHORIZATION_STATE_SCHEMA,
  compileAuthorizationEnvelopeV2,
  compileAuthorizationState,
  validateAuthorizationEnvelopeV2,
  evaluateAuthorizationV2,
} from '../authorization-envelope-v2.mjs';
import { validateHumanReservationPermit } from '../authorization-envelope.mjs';

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
  allowed_mutation_classes:['LOCAL_EXECUTION','PROVIDER_EFFECT'],
  forbidden_actions:['PRODUCTION'],
  human_reservations:['CODEX_LAST_MILE'],
  human_authorization_ref:'checkpoint://human-authorization',
  issued_at:'2026-09-21T10:00:00Z',
  revoked_at:null,
  revocation_ref:null,
  ...extra,
});
const stateSource=(extra={})=>({
  project_id:'P',
  mission_revision:'M1',
  mission_hash:M,
  current_authorization_id:'AUTH-002',
  authorization_generation:2,
  supersedes:'AUTH-001',
  revoked_authorization_ids:['AUTH-001'],
  human_authorization_ref:'checkpoint://human-authorization',
  recorded_at:'2026-09-21T10:00:00Z',
  ...extra,
});
const request={effect_class:'LOCAL_EXECUTION',action_id:'GOV_REPAIR',authorization_scope_tag:'GOVERNANCE_HARDENING'};

test('v2 envelope and generation state are deterministic and current',()=>{
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const state=compileAuthorizationState(stateSource(),mission);
  assert.equal(env.schema,AUTHORIZATION_ENVELOPE_V2_SCHEMA);
  assert.equal(state.schema,AUTHORIZATION_STATE_SCHEMA);
  assert.equal(validateAuthorizationEnvelopeV2(env,mission,state),true);
  const out=evaluateAuthorizationV2({envelope:env,current_mission:mission,authorization_state:state,identity:{project_id:'P'},request,validate_human_reservation_permit:validateHumanReservationPermit});
  assert.equal(out.authorized,true);
  assert.equal(out.authorization_generation,2);
});

test('old generation is stale even when mission is unchanged',()=>{
  const old=compileAuthorizationEnvelopeV2(envelopeSource({authorization_id:'AUTH-001',authorization_generation:1,supersedes:null}),mission);
  const state=compileAuthorizationState(stateSource(),mission);
  assert.throws(()=>validateAuthorizationEnvelopeV2(old,mission,state),/AUTHORIZATION_REVOKED|AUTHORIZATION_NOT_CURRENT|AUTHORIZATION_GENERATION_STALE/);
});

test('generation mismatch fails closed without mission change',()=>{
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const state=compileAuthorizationState(stateSource({authorization_generation:3}),mission);
  assert.throws(()=>validateAuthorizationEnvelopeV2(env,mission,state),/AUTHORIZATION_GENERATION_STALE/);
});

test('explicit revocation fails closed',()=>{
  const revoked=compileAuthorizationEnvelopeV2(envelopeSource({revoked_at:'2026-09-21T10:05:00Z',revocation_ref:'checkpoint://revoke-auth-002'}),mission);
  const state=compileAuthorizationState(stateSource({current_authorization_id:'AUTH-003',authorization_generation:3,revoked_authorization_ids:['AUTH-001','AUTH-002']}),mission);
  assert.throws(()=>validateAuthorizationEnvelopeV2(revoked,mission,state),/AUTHORIZATION_REVOKED/);
});

test('authorization state cannot mark current authorization revoked',()=>{
  assert.throws(()=>compileAuthorizationState(stateSource({revoked_authorization_ids:['AUTH-002']}),mission),/CURRENT_AUTHORIZATION_CANNOT_BE_REVOKED/);
});

test('mission change still stales generation-aware authorization',()=>{
  const env=compileAuthorizationEnvelopeV2(envelopeSource(),mission);
  const state=compileAuthorizationState(stateSource(),mission);
  const changed={project_id:'P',revision:'M2',hash:'sha256:'+'2'.repeat(64)};
  assert.throws(()=>validateAuthorizationEnvelopeV2(env,changed,state),/AUTHORIZATION_STATE_MISSION_STALE|AUTHORIZATION_MISSION_REVISION_STALE/);
});
