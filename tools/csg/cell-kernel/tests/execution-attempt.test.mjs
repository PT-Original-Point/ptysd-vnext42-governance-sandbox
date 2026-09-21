import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_ATTEMPT_SCHEMA,createExecutionAttempt,assertExecutionAttemptCurrent,beginExecutionDispatch,
  recordExecutionDispatchOutcome,recordExecutionReadback,createRetryExecutionAttempt,
} from '../execution-attempt.mjs';

const H='sha256:'+'1'.repeat(64);
const A='sha256:'+'2'.repeat(64);
const AS='sha256:'+'3'.repeat(64);
const fence=(extra={})=>({
  project_id:'P',mission_revision:'M1',mission_hash:H,authorization_envelope_digest:A,authorization_generation:2,authorization_state_digest:AS,
  run_id:'R',atomic_unit_id:'U',attempt_id:'ATTEMPT-001',attempt_epoch:1,operation_id:'OP-001',
  now:'2026-09-21T05:40:00Z',...extra,
});
const spec=(extra={})=>({
  project_id:'P',mission_revision:'M1',mission_hash:H,authorization_envelope_digest:A,authorization_generation:2,authorization_state_digest:AS,
  run_id:'R',atomic_unit_id:'U',attempt_id:'ATTEMPT-001',attempt_epoch:1,operation_id:'OP-001',
  started_at:'2026-09-21T05:39:00Z',deadline:'2026-09-21T05:50:00Z',
  executor:'CHAT',tool:'GITHUB',route:'CONNECTOR',mutation_class:'PROVIDER_EFFECT',
  provider_precondition:{kind:'REVISION',resource:'github://repo/ref',revision:'abc123'},
  idempotency_key:'idem-op-001',...extra,
});
const dispatched=()=>beginExecutionDispatch(createExecutionAttempt(spec(),fence()),fence());

test('attempt is deterministic, sealed, and exact-fence current',()=>{
  const a=createExecutionAttempt(spec(),fence()),b=createExecutionAttempt(spec(),fence());
  assert.equal(a.schema,EXECUTION_ATTEMPT_SCHEMA);assert.equal(a.attempt_digest,b.attempt_digest);
  assert.equal(a.state,'READY');assert.equal(assertExecutionAttemptCurrent(a,fence()),true);
});
test('mission, project, authorization and epoch are hard fences',()=>{
  const a=createExecutionAttempt(spec(),fence());
  for(const [patch,code] of [
    [{project_id:'Q'},'STALE_PROJECT'],[{mission_revision:'M2'},'STALE_MISSION_REVISION'],
    [{authorization_envelope_digest:'sha256:'+'4'.repeat(64)},'STALE_AUTHORIZATION_ENVELOPE'],
    [{authorization_generation:3},'STALE_AUTHORIZATION_GENERATION'],
    [{authorization_state_digest:'sha256:'+'5'.repeat(64)},'STALE_AUTHORIZATION_STATE'],
    [{attempt_epoch:2},'STALE_EPOCH'],
  ]) assert.throws(()=>assertExecutionAttemptCurrent(a,fence(patch)),new RegExp(code));
});
test('tamper is rejected',()=>{
  const a=createExecutionAttempt(spec(),fence());a.route='OTHER';
  assert.throws(()=>assertExecutionAttemptCurrent(a,fence()),/EXECUTION_ATTEMPT_DIGEST_MISMATCH/);
});
test('dispatch is exactly once and deadline fenced',()=>{
  const a=createExecutionAttempt(spec(),fence());const d=beginExecutionDispatch(a,fence());
  assert.equal(d.state,'DISPATCHING');assert.equal(d.dispatch_count,1);
  assert.throws(()=>beginExecutionDispatch(d,fence()),/DUPLICATE_DISPATCH_DENIED/);
  const late=createExecutionAttempt(spec(),fence({now:'2026-09-21T05:50:00Z'}));
  assert.throws(()=>beginExecutionDispatch(late,fence({now:'2026-09-21T05:50:00Z'})),/ATTEMPT_DEADLINE_EXPIRED/);
});
test('provider ACK is not completion and requires same-source readback',()=>{
  const a=recordExecutionDispatchOutcome(dispatched(),fence(),{classification:'ACKNOWLEDGED',observed_at:'2026-09-21T05:41:00Z'});
  assert.equal(a.state,'READBACK_REQUIRED');assert.equal(a.side_effect_state,'PENDING');assert.equal(a.readback_state,'REQUIRED');
  assert.throws(()=>beginExecutionDispatch(a,fence()),/READBACK_REQUIRED_BEFORE_RETRY/);
  const done=recordExecutionReadback(a,fence(),{classification:'CONFIRMED_APPLIED',observed_at:'2026-09-21T05:42:00Z',provider_observation_ref:'github://repo/readback@rev2'});
  assert.equal(done.state,'COMPLETED');assert.equal(done.side_effect_state,'APPLIED');assert.equal(done.readback_state,'CONFIRMED_APPLIED');
});
test('unknown dispatch enters recovery and blind retry is mechanically denied',()=>{
  const a=recordExecutionDispatchOutcome(dispatched(),fence(),{classification:'UNKNOWN',observed_at:'2026-09-21T05:41:00Z'});
  assert.equal(a.state,'RECOVERY_REQUIRED');assert.equal(a.side_effect_state,'UNKNOWN');assert.equal(a.readback_state,'REQUIRED');
  assert.throws(()=>beginExecutionDispatch(a,fence()),/READBACK_REQUIRED_BEFORE_RETRY/);
});
test('partial or ambiguous readback remains recovery required',()=>{
  let a=recordExecutionDispatchOutcome(dispatched(),fence(),{classification:'UNKNOWN',observed_at:'2026-09-21T05:41:00Z'});
  a=recordExecutionReadback(a,fence(),{classification:'PARTIAL_OR_AMBIGUOUS',observed_at:'2026-09-21T05:42:00Z',provider_observation_ref:'provider://obs/partial'});
  assert.equal(a.state,'RECOVERY_REQUIRED');assert.equal(a.side_effect_state,'PARTIAL_OR_AMBIGUOUS');
  assert.throws(()=>beginExecutionDispatch(a,fence()),/READBACK_REQUIRED_BEFORE_RETRY/);
});
test('confirmed not applied permits only epoch+1 retry with same operation and idempotency key',()=>{
  let a=recordExecutionDispatchOutcome(dispatched(),fence(),{classification:'UNKNOWN',observed_at:'2026-09-21T05:41:00Z'});
  a=recordExecutionReadback(a,fence(),{classification:'CONFIRMED_NOT_APPLIED',observed_at:'2026-09-21T05:42:00Z',provider_observation_ref:'provider://obs/not-applied'});
  assert.equal(a.state,'FAILED');assert.equal(a.side_effect_state,'NOT_APPLIED');
  const nf=fence({attempt_id:'ATTEMPT-002',attempt_epoch:2,now:'2026-09-21T05:43:00Z'});
  const retry=createRetryExecutionAttempt(a,{
    attempt_id:'ATTEMPT-002',attempt_epoch:2,started_at:'2026-09-21T05:43:00Z',deadline:'2026-09-21T05:55:00Z',
    provider_precondition:{kind:'REVISION',resource:'github://repo/ref',revision:'abc124'},
    recovery_observation_ref:'provider://obs/not-applied',
  },nf);
  assert.equal(retry.retry_of_attempt_id,'ATTEMPT-001');assert.equal(retry.operation_id,'OP-001');assert.equal(retry.idempotency_key,'idem-op-001');
  assert.equal(assertExecutionAttemptCurrent(retry,nf),true);
  assert.throws(()=>assertExecutionAttemptCurrent(a,nf),/STALE_ATTEMPT/);
});
test('retry rejects skipped epoch, changed operation/idempotency, or mismatched recovery evidence',()=>{
  let a=recordExecutionDispatchOutcome(dispatched(),fence(),{classification:'UNKNOWN',observed_at:'2026-09-21T05:41:00Z'});
  a=recordExecutionReadback(a,fence(),{classification:'CONFIRMED_NOT_APPLIED',observed_at:'2026-09-21T05:42:00Z',provider_observation_ref:'provider://obs/not-applied'});
  const common={attempt_id:'ATTEMPT-002',attempt_epoch:2,started_at:'2026-09-21T05:43:00Z',deadline:'2026-09-21T05:55:00Z',provider_precondition:{kind:'REVISION',resource:'x',revision:'2'},recovery_observation_ref:'provider://obs/not-applied'};
  assert.throws(()=>createRetryExecutionAttempt(a,{...common,attempt_epoch:3},fence({attempt_id:'ATTEMPT-002',attempt_epoch:3,now:'2026-09-21T05:43:00Z'})),/RETRY_EPOCH_MUST_INCREMENT_ONCE/);
  assert.throws(()=>createRetryExecutionAttempt(a,{...common,operation_id:'OP-OTHER'},fence({attempt_id:'ATTEMPT-002',attempt_epoch:2,now:'2026-09-21T05:43:00Z'})),/RETRY_OPERATION_ID_MISMATCH/);
  assert.throws(()=>createRetryExecutionAttempt(a,{...common,idempotency_key:'different'},fence({attempt_id:'ATTEMPT-002',attempt_epoch:2,now:'2026-09-21T05:43:00Z'})),/RETRY_IDEMPOTENCY_KEY_MISMATCH/);
  assert.throws(()=>createRetryExecutionAttempt(a,{...common,recovery_observation_ref:'provider://obs/wrong'},fence({attempt_id:'ATTEMPT-002',attempt_epoch:2,now:'2026-09-21T05:43:00Z'})),/RETRY_OBSERVATION_REF_MISMATCH/);
});
test('synchronous rejection before any effect is terminal NOT_APPLIED and can retry without provider readback',()=>{
  let a=recordExecutionDispatchOutcome(dispatched(),fence(),{classification:'REJECTED_BEFORE_EFFECT',observed_at:'2026-09-21T05:41:00Z'});
  assert.equal(a.state,'FAILED');assert.equal(a.side_effect_state,'NOT_APPLIED');assert.equal(a.readback_state,'NOT_REQUIRED');
  const nf=fence({attempt_id:'ATTEMPT-002',attempt_epoch:2,now:'2026-09-21T05:42:00Z'});
  const retry=createRetryExecutionAttempt(a,{attempt_id:'ATTEMPT-002',attempt_epoch:2,started_at:'2026-09-21T05:42:00Z',deadline:'2026-09-21T05:55:00Z',provider_precondition:{kind:'REVISION',resource:'x',revision:'2'}},nf);
  assert.equal(retry.attempt_epoch,2);
});
