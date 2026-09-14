import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_STAGES, MAX_TASKS, MAX_ATTEMPTS_PER_TASK,
  admitCommand, createBusinessRun, observeTransport,
  startTaskAttempt, advanceStage, completeCurrentTask, requestStop
} from '../scripts/v46-bounded-driver.mjs';

const command = {
  command_id: 'CMD-001',
  project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  contract_digest: 'sha256:contract',
  tasks: [{task_id:'T1'}, {task_id:'T2'}]
};

test('driver is fixed-stage bounded, not arbitrary DAG', () => {
  assert.deepEqual(FIXED_STAGES, ['ADMIT','PREPARE','IMPLEMENT','VERIFY','EXPORT','PUBLISH','READBACK']);
  assert.equal(MAX_TASKS, 12);
  assert.equal(MAX_ATTEMPTS_PER_TASK, 3);
});

test('intake is persisted/deduplicated by command id and exact request digest', () => {
  const accepted = admitCommand({existing:null, command});
  assert.equal(admitCommand({existing:accepted, command}), accepted);
  assert.throws(() => admitCommand({existing:accepted, command:{...command, tasks:[{task_id:'T9'}]}}), /COMMAND_ID_PAYLOAD_MISMATCH/);
});

test('task count and duplicate identities fail closed', () => {
  const tooMany = {...command, command_id:'CMD-X', tasks:Array.from({length:13},(_,i)=>({task_id:`T${i}`}))};
  assert.throws(()=>admitCommand({existing:null, command:tooMany}),/TASK_COUNT_OUT_OF_RANGE/);
  assert.throws(()=>admitCommand({existing:null, command:{...command, command_id:'CMD-Y', tasks:[{task_id:'X'},{task_id:'X'}]}}),/DUPLICATE_TASK_ID/);
});

test('transport run/attempt are observations and never become business attempt/epoch', () => {
  const accepted = admitCommand({existing:null, command});
  let run = createBusinessRun({acceptedCommand:accepted, run_id:'RUN-1', attempt_epoch:7});
  run = observeTransport(run,{transport_run_id:'gha-100',transport_attempt:1});
  run = observeTransport(run,{transport_run_id:'gha-100',transport_attempt:2});
  assert.equal(run.attempt_epoch,7);
  assert.equal(run.tasks[0].business_attempt,0);
  assert.equal(run.transport_observations.length,2);
});

test('only linear fixed stages are accepted', () => {
  const accepted = admitCommand({existing:null, command});
  let run = startTaskAttempt(createBusinessRun({acceptedCommand:accepted,run_id:'RUN-2'}));
  assert.equal(run.stage,'PREPARE');
  assert.throws(()=>advanceStage(run,'VERIFY'),/NON_LINEAR_STAGE_TRANSITION/);
  for (const stage of ['IMPLEMENT','VERIFY','EXPORT','PUBLISH','READBACK']) run=advanceStage(run,stage);
  run=completeCurrentTask(run);
  assert.equal(run.state,'READY');
  assert.equal(run.active_task_index,1);
});

test('business attempt limit is independent of transport reruns', () => {
  const single = {...command, command_id:'CMD-S', tasks:[{task_id:'T1'}]};
  const accepted = admitCommand({existing:null, command:single});
  let run=createBusinessRun({acceptedCommand:accepted,run_id:'RUN-S'});
  for (let i=0;i<3;i++) {
    run=startTaskAttempt({...run,state:'READY',stage:'ADMIT',tasks:[{...run.tasks[0],state:'PENDING'}]});
    run={...run,state:'READY',stage:'ADMIT',tasks:[{...run.tasks[0],state:'PENDING'}]};
  }
  assert.equal(run.tasks[0].business_attempt,3);
  assert.throws(()=>startTaskAttempt(run),/TASK_ATTEMPT_LIMIT/);
});

test('STOP is sticky enough to prevent a new attempt and success', () => {
  const accepted=admitCommand({existing:null,command:{...command,command_id:'CMD-STOP',tasks:[{task_id:'T1'}]}});
  let run=startTaskAttempt(createBusinessRun({acceptedCommand:accepted,run_id:'RUN-STOP'}));
  run=requestStop(run);
  assert.equal(run.stop_requested,true);
  assert.throws(()=>startTaskAttempt({...run,state:'READY'}),/STOP_BLOCKS_NEW_ATTEMPT/);
  const atReadback={...run,state:'RUNNING',stage:'READBACK',tasks:[{...run.tasks[0],state:'RUNNING'}]};
  assert.throws(()=>completeCurrentTask(atReadback),/STOP_BLOCKS_SUCCESS/);
});

test('unresolved provider effects block task success', () => {
  const accepted=admitCommand({existing:null,command:{...command,command_id:'CMD-U',tasks:[{task_id:'T1'}]}});
  const run={...startTaskAttempt(createBusinessRun({acceptedCommand:accepted,run_id:'RUN-U'})),stage:'READBACK',unresolved_operation_ids:['OP-1']};
  assert.throws(()=>completeCurrentTask(run),/UNRESOLVED_EFFECTS/);
});
