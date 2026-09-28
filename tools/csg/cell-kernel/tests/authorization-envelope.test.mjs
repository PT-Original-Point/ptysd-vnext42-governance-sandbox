import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileAuthorizationEnvelope,validateAuthorizationEnvelope,compileHumanReservationPermit,evaluateAuthorization,
  AUTHORIZATION_ENVELOPE_SCHEMA,HUMAN_RESERVATION_PERMIT_SCHEMA,
} from '../authorization-envelope.mjs';

const mission={project_id:'P',revision:'M1',hash:'sha256:'+'1'.repeat(64)};
const source=()=>({
  authorization_id:'AUTH-001',project_id:'P',mission_revision:'M1',mission_hash:mission.hash,valid_until_mission_revision:'M1',
  scope_tags:['CURRENT_MISSION_PLAN'],allowed_mutation_classes:['LOCAL_PREPARATION','LOCAL_EXECUTION','PROVIDER_EFFECT'],
  forbidden_actions:['PRODUCTION_FINAL_AUTHORIZATION'],human_reservations:['CODEX_LAST_MILE'],
  human_authorization_ref:'canonical://human/directive/20260921',issued_at:'2026-09-21T05:31:00Z',
});
const identity={project_id:'P',run_id:'R',task_id:'T',attempt_id:'A',attempt_epoch:1};
const request=(extra={})=>({effect_class:'LOCAL_EXECUTION',action_id:'BUILD_TEST',authorization_scope_tag:'CURRENT_MISSION_PLAN',...extra});

test('authorization envelope compiles deterministically and is mission bound',()=>{
  const a=compileAuthorizationEnvelope(source(),mission),b=compileAuthorizationEnvelope(source(),mission);
  assert.equal(a.schema,AUTHORIZATION_ENVELOPE_SCHEMA); assert.equal(a.envelope_digest,b.envelope_digest);
  assert.equal(validateAuthorizationEnvelope(a,mission),true);
});
test('mission revision change invalidates durable envelope',()=>{
  const a=compileAuthorizationEnvelope(source(),mission);
  assert.throws(()=>validateAuthorizationEnvelope(a,{...mission,revision:'M2'}),/AUTHORIZATION_MISSION_REVISION_STALE/);
});
test('tampering is rejected',()=>{
  const a=compileAuthorizationEnvelope(source(),mission); a.scope_tags.push('OTHER');
  assert.throws(()=>validateAuthorizationEnvelope(a,mission),/AUTHORIZATION_ENVELOPE_DIGEST_MISMATCH/);
});
test('wrong project and scope fail closed',()=>{
  const a=compileAuthorizationEnvelope(source(),mission);
  let x=evaluateAuthorization({envelope:a,current_mission:mission,identity:{...identity,project_id:'Q'},request:request()});
  assert.equal(x.authorized,false); assert.ok(x.reason_codes.includes('AUTHORIZATION_IDENTITY_PROJECT_MISMATCH'));
  x=evaluateAuthorization({envelope:a,current_mission:mission,identity,request:request({authorization_scope_tag:'OTHER'})});
  assert.equal(x.authorized,false); assert.ok(x.reason_codes.includes('AUTHORIZATION_SCOPE_DENY'));
});
test('mutation class and forbidden action fail closed',()=>{
  const a=compileAuthorizationEnvelope(source(),mission);
  let x=evaluateAuthorization({envelope:a,current_mission:mission,identity,request:request({effect_class:'HUMAN_RESERVED',action_id:'PRODUCTION_FINAL_AUTHORIZATION'})});
  assert.equal(x.authorized,false); assert.ok(x.reason_codes.includes('AUTHORIZATION_ACTION_FORBIDDEN'));
  x=evaluateAuthorization({envelope:a,current_mission:mission,identity,request:request({effect_class:'HUMAN_RESERVED',action_id:'OTHER_RESERVED'})});
  assert.equal(x.authorized,false); assert.ok(x.reason_codes.includes('AUTHORIZATION_MUTATION_CLASS_DENY'));
});
test('legacy boolean cannot bypass a human reservation',()=>{
  const a=compileAuthorizationEnvelope(source(),mission);
  const x=evaluateAuthorization({envelope:a,current_mission:mission,identity,request:request({effect_class:'HUMAN_RESERVED',action_id:'CODEX_LAST_MILE',human_permit_granted:true})});
  assert.equal(x.authorized,false); assert.ok(x.reason_codes.some(c=>c.startsWith('HUMAN_PERMIT_REQUIRED')));
});
test('exact mission-bound reservation permit can authorize a reserved action when class is allowed',()=>{
  const s=source(); s.allowed_mutation_classes.push('HUMAN_RESERVED');
  const a=compileAuthorizationEnvelope(s,mission);
  const permit=compileHumanReservationPermit({permit_id:'PERMIT-001',project_id:'P',mission_revision:'M1',mission_hash:mission.hash,action_id:'CODEX_LAST_MILE',human_authorization_ref:'canonical://human/directive/codex',issued_at:'2026-09-21T05:32:00Z'},mission);
  assert.equal(permit.schema,HUMAN_RESERVATION_PERMIT_SCHEMA);
  const x=evaluateAuthorization({envelope:a,current_mission:mission,identity,request:request({effect_class:'HUMAN_RESERVED',action_id:'CODEX_LAST_MILE'}),human_reservation_permit:permit});
  assert.equal(x.authorized,true); assert.equal(x.human_reservation_required,true);
});
test('read-only remains envelope-free',()=>{
  const x=evaluateAuthorization({identity,request:{effect_class:'READ_ONLY'}});
  assert.equal(x.authorized,true); assert.equal(x.envelope_required,false);
});
