import test from 'node:test';
import assert from 'node:assert/strict';
import {admitCommand, applyTransition, requestStop, acceptAttemptReceipt, recordOperation} from '../scripts/v45-state-core.mjs';

const run = {run_id:'R1',revision:1,state:'READY',attempt_epoch:0,stop_requested:false};

test('same command id+digest dedupes and changed payload is rejected',()=>{
  const c={command_id:'C1',request_sha256:'h1'};
  const a=admitCommand({},c);
  assert.equal(admitCommand(a,c),a);
  assert.throws(()=>admitCommand(a,{...c,request_sha256:'h2'}),/COMMAND_ID_PAYLOAD_MISMATCH/);
});

test('expected revision and epoch fence stale transitions',()=>{
  assert.throws(()=>applyTransition(run,{expected_revision:0,expected_epoch:0,next_state:'RUNNING'}),/STALE_REVISION/);
  assert.throws(()=>applyTransition(run,{expected_revision:1,expected_epoch:1,next_state:'RUNNING'}),/STALE_EPOCH/);
});

test('legal transition increments revision exactly once',()=>{
  const r=applyTransition(run,{expected_revision:1,expected_epoch:0,next_state:'RUNNING'});
  assert.equal(r.revision,2);
  assert.equal(r.state,'RUNNING');
});

test('STOP is sticky and blocks non-stop transitions',()=>{
  const s=requestStop(run,1,0);
  assert.equal(s.state,'STOPPING');
  assert.equal(s.stop_requested,true);
  assert.throws(()=>applyTransition(s,{expected_revision:2,expected_epoch:0,next_state:'RUNNING'}),/STOP_STICKY/);
});

test('stale attempt receipts and post-stop effects are rejected',()=>{
  const s=requestStop(run,1,0);
  assert.throws(()=>acceptAttemptReceipt(s,{run_id:'R1',attempt_epoch:1,external_effect_requested:false}),/STALE_ATTEMPT_RECEIPT/);
  assert.throws(()=>acceptAttemptReceipt(s,{run_id:'R1',attempt_epoch:0,external_effect_requested:true}),/STOP_BLOCKS_NEW_EFFECT/);
});

test('operation id is idempotent only for same payload',()=>{
  const a=recordOperation({}, {operation_id:'O1',payload:{x:1}});
  assert.equal(recordOperation(a,{operation_id:'O1',payload:{x:1}}),a);
  assert.throws(()=>recordOperation(a,{operation_id:'O1',payload:{x:2}}),/OPERATION_ID_PAYLOAD_MISMATCH/);
});
