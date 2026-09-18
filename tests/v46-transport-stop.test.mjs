import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {stableHash} from '../scripts/v45-state-core.mjs';
import {
  MAX_PENDING_TRANSPORTS,
  TRANSPORT_SCOPE,
  acceptCommandDurably,
  admitTransportDelivery,
  reconstructBoundedRun,
  requestStopDurably,
  wakeBoundedDriver,
} from '../scripts/v46-bounded-driver.mjs';

const digest = n => `sha256:${String(n).repeat(64).slice(0,64)}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v46-transport-stop-'));
const contract = () => ({
  schema_version:'factory.contract.v1', contract_id:'C-V46-08B-001', project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE', revision:8,
  tasks:[{task_id:'T-STOP-001', max_attempts:3}], acceptance:['transport-stop'], incremental_usd:0
});
const command = c => ({
  schema:'factory.command.v46', command_id:'CMD-STOP-001', request_sha256:digest('8'), project_id:c.project_id,
  run_id:'RUN-STOP-001', task_id:'T-STOP-001', attempt_id:'ATTEMPT-STOP-001', attempt_epoch:9,
  contract_id:c.contract_id, contract_ref:'contracts/C-V46-08B-001.json', contract_digest:stableHash(c), contract_revision:c.revision
});
const transport = (attempt = 1, runId = 'gha-stop') => ({transport_run_id:runId, transport_run_attempt:attempt});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('V46-F17 durable STOP enters independently during long synthetic worker and converges under 60 seconds', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let childPid = null, childExitCode = null, stopAt = 0, childExitAt = 0, workerCalls = 0;
  const worker = async () => {
    workerCalls += 1;
    const stopPath = path.join(root,'runtime',cmd.run_id,'stop.json');
    const code = "const fs=require('fs');const p=process.argv[1];const t=setInterval(()=>{if(fs.existsSync(p)){clearInterval(t);process.exit(0)}},20);setTimeout(()=>process.exit(70),60000);";
    const child = spawn(process.execPath, ['-e', code, stopPath], {stdio:'ignore'});
    childPid = child.pid;
    setTimeout(() => {
      stopAt = Date.now();
      requestStopDurably(root, cmd.run_id, {stop_id:'STOP-F17-001', reason:'SYNTHETIC_LONG_WORKER_STOP'});
    }, 120);
    childExitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', codeValue => { childExitAt = Date.now(); resolve(codeValue); });
    });
    return {status:'PASS', costs:{trace:0,code:0,service:0}, raw_log:`child_pid=${childPid};exit=${childExitCode}`};
  };
  const out = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker});
  assert.equal(out.status,'STOPPED');
  assert.equal(out.run.stop_requested,true);
  assert.equal(out.run.attempt_epoch,9);
  assert.equal(childExitCode,0);
  assert.ok(Number.isInteger(childPid) && childPid > 0);
  assert.ok(stopAt > 0 && childExitAt >= stopAt);
  assert.ok(childExitAt - stopAt < 60000, `stop latency was ${childExitAt-stopAt}ms`);
  const noNewWork = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(2),worker});
  assert.equal(noNewWork.status,'STOPPED');
  assert.equal(workerCalls,1);
  assert.equal(reconstructBoundedRun(root,cmd.run_id).stop.stop_id,'STOP-F17-001');
});

test('V46-F18 ACK after STOP with possible in-flight effect is quarantined and never blindly redispatched', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let calls = 0;
  const worker = async ({run}) => {
    calls += 1;
    setTimeout(() => requestStopDurably(root, cmd.run_id, {stop_id:'STOP-F18-001', reason:'ACK_AFTER_STOP'}), 20);
    await sleep(80);
    return {
      status:'PASS', costs:{trace:0,code:0,service:0},
      operation:{operation_id:'OP-INFLIGHT-001',run_id:run.run_id,attempt_epoch:run.attempt_epoch,kind:'synthetic',provider:'local',target:'fixture',precondition:{ready:true},payload:{value:1}},
      raw_log:'synthetic provider ack after stop'
    };
  };
  const first = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1,'ack-loss'),worker});
  assert.equal(first.status,'QUARANTINED');
  assert.deepEqual(first.run.unresolved_operation_ids,['OP-INFLIGHT-001']);
  assert.deepEqual(first.run.operations,{});
  const second = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1,'ack-loss'),worker});
  assert.equal(second.status,'QUARANTINED');
  assert.equal(calls,1);
  assert.equal(second.run.attempt_epoch,9);
});

test('V46-F19 queue max is simulated at 100 and the 101st wake backpressures without losing accepted command', () => {
  const root = tmp(), c = contract(), cmd = command(c);
  acceptCommandDurably(root,cmd,c);
  let queue = null;
  for (let i=1;i<=MAX_PENDING_TRANSPORTS;i++) {
    const admitted = admitTransportDelivery(queue,{delivery_id:`D-${i}`,scope:TRANSPORT_SCOPE,signature_verified:true,transport_run_id:`gha-${i}`,transport_run_attempt:1});
    assert.equal(admitted.status,'ACCEPTED');
    queue = admitted.queue;
  }
  const overflow = admitTransportDelivery(queue,{delivery_id:'D-101',scope:TRANSPORT_SCOPE,signature_verified:true,transport_run_id:'gha-101',transport_run_attempt:1});
  assert.equal(overflow.status,'BACKPRESSURE');
  assert.equal(overflow.queue.pending.length,100);
  const intake = JSON.parse(fs.readFileSync(path.join(root,'intake','commands.json'),'utf8'));
  assert.equal(intake[cmd.command_id].attempt_epoch,9);
});

test('V46-F19 transport rerun changes transport attempt only and never increments business epoch', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let calls = 0;
  const worker = async () => {
    calls += 1;
    return {status:'WAIT',wait_state:'WAITING_RESOURCE',wait_reason:'TRANSPORT_RERUN_FIXTURE',costs:{trace:0,code:0,service:0}};
  };
  const a = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1,'same-gha-run'),worker});
  const b = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(2,'same-gha-run'),worker});
  assert.equal(a.run.attempt_epoch,9);
  assert.equal(b.run.attempt_epoch,9);
  assert.equal(calls,2);
  assert.equal(Object.keys(b.run.transport_receipts).length,2);
});

test('V46-F20 duplicate delivery dedupes while delayed drift or forged scope/signature fails closed', () => {
  const first = admitTransportDelivery(null,{delivery_id:'DELIVERY-1',scope:TRANSPORT_SCOPE,signature_verified:true,transport_run_id:'gha-1',transport_run_attempt:1});
  const duplicate = admitTransportDelivery(first.queue,{delivery_id:'DELIVERY-1',scope:TRANSPORT_SCOPE,signature_verified:true,transport_run_id:'gha-1',transport_run_attempt:1});
  assert.equal(duplicate.status,'DUPLICATE');
  assert.equal(duplicate.queue.pending.length,1);
  assert.throws(() => admitTransportDelivery(first.queue,{delivery_id:'DELIVERY-1',scope:TRANSPORT_SCOPE,signature_verified:true,transport_run_id:'gha-1',transport_run_attempt:2}),/DELIVERY_ID_ENVELOPE_MISMATCH/);
  assert.throws(() => admitTransportDelivery(null,{delivery_id:'FORGED-1',scope:TRANSPORT_SCOPE,signature_verified:false,transport_run_id:'gha-x',transport_run_attempt:1}),/TRANSPORT_SIGNATURE_REQUIRED/);
  assert.throws(() => admitTransportDelivery(null,{delivery_id:'FORGED-2',scope:'business-project',signature_verified:true,transport_run_id:'gha-x',transport_run_attempt:1}),/TRANSPORT_SCOPE_MISMATCH/);
});

test('API throttling or outage waits durably, preserves command and resumes without business epoch change', async () => {
  for (const waitReason of ['API_THROTTLED','PROVIDER_OUTAGE']) {
    const root = tmp(), c = contract(), cmd = command(c);
    let first = true;
    const worker = async () => {
      if (first) { first = false; return {status:'WAIT',wait_state:'WAITING_RESOURCE',wait_reason:waitReason,costs:{trace:0,code:0,service:0}}; }
      return {status:'PASS',costs:{trace:0,code:0,service:0}};
    };
    const waited = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1,`wait-${waitReason}`),worker});
    assert.equal(waited.status,'WAITING_RESOURCE');
    assert.equal(waited.run.attempt_epoch,9);
    const recoveredBeforeWake = reconstructBoundedRun(root,cmd.run_id);
    assert.equal(recoveredBeforeWake.intake[cmd.command_id].request_sha256,cmd.request_sha256);
    const resumed = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(2,`wait-${waitReason}`),worker});
    assert.equal(resumed.run.attempt_epoch,9);
    assert.notEqual(resumed.status,'FAILED');
  }
});
