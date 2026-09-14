import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSPORT_QUEUE_MAX, enqueueTransport, persistStop,
  applyTransportObservation, classifyTransportFailure, canStartBusinessAttempt
} from '../scripts/v46-transport-guard.mjs';

const run=()=>({
  project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  run_id:'RUN-08B',revision:10,attempt_epoch:4,state:'RUNNING',
  active_task_index:0,stop_requested:false,unresolved_operation_ids:[],transport_observations:[]
});

test('queue max is modeled as 100 pending without creating real jobs',()=>{
  let q=[];
  for(let i=0;i<TRANSPORT_QUEUE_MAX;i++) q=enqueueTransport(q,{transport_run_id:`gha-${i}`,transport_attempt:1}).queue;
  assert.equal(q.length,100);
  assert.throws(()=>enqueueTransport(q,{transport_run_id:'gha-overflow',transport_attempt:1}),/TRANSPORT_QUEUE_FULL/);
});

test('duplicate transport delivery dedupes and does not consume queue capacity',()=>{
  let q=[];
  const e={transport_run_id:'gha-1',transport_attempt:1};
  q=enqueueTransport(q,e).queue;
  const r=enqueueTransport(q,e);
  assert.equal(r.duplicate,true);
  assert.equal(r.queue.length,1);
});

test('transport rerun does not change business epoch or task index',()=>{
  let r=run();
  r=applyTransportObservation(r,{transport_run_id:'gha-2',transport_attempt:1,status:'FAILED'});
  r=applyTransportObservation(r,{transport_run_id:'gha-2',transport_attempt:2,status:'RUNNING'});
  assert.equal(r.attempt_epoch,4);
  assert.equal(r.active_task_index,0);
  assert.equal(r.transport_observations.length,2);
});

test('STOP is independent of transport attempt and preserves business epoch',()=>{
  const before=run();
  const after=persistStop(before,{project_id:before.project_id,run_id:before.run_id,expected_epoch:4});
  assert.equal(after.stop_requested,true);
  assert.equal(after.state,'STOPPING');
  assert.equal(after.attempt_epoch,4);
  assert.equal(after.revision,11);
  assert.equal(persistStop(after,{project_id:after.project_id,run_id:after.run_id,expected_epoch:4}),after);
});

test('stale or cross-project STOP fails closed',()=>{
  const r=run();
  assert.throws(()=>persistStop(r,{project_id:'OTHER',run_id:r.run_id,expected_epoch:4}),/STOP_PROJECT_MISMATCH/);
  assert.throws(()=>persistStop(r,{project_id:r.project_id,run_id:r.run_id,expected_epoch:3}),/STALE_STOP_EPOCH/);
});

test('throttle/outage/event loss wait on canonical readback without business mutation',()=>{
  const r=run();
  for (const failure of ['THROTTLED','OUTAGE','EVENT_LOST']) {
    const c=classifyTransportFailure(r,failure);
    assert.equal(c.business_state_unchanged,true);
    assert.equal(c.attempt_epoch,4);
    assert.equal(c.action,'WAIT_AND_READ_CANONICAL');
  }
});

test('STOP and unresolved effects both block a new business attempt',()=>{
  assert.deepEqual(canStartBusinessAttempt({...run(),stop_requested:true}),{allowed:false,reason:'STOP_BLOCKS_NEW_ATTEMPT'});
  assert.deepEqual(canStartBusinessAttempt({...run(),unresolved_operation_ids:['OP-1']}),{allowed:false,reason:'UNRESOLVED_EFFECTS'});
  assert.equal(canStartBusinessAttempt(run()).allowed,true);
});
