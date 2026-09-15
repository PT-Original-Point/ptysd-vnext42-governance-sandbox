import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stableHash} from '../scripts/v45-state-core.mjs';
import {receiptIdentityDigest} from '../scripts/v46-receipt-admission.mjs';
import {PHASES, MAX_TASKS, MAX_ATTEMPTS, validateBoundedContract, validateAcceptedCommand, wakeBoundedDriver, reconstructBoundedRun} from '../scripts/v46-bounded-driver.mjs';

const digest = n => `sha256:${String(n).repeat(64).slice(0,64)}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v46-driver-'));
const contract = () => ({
  schema_version:'factory.contract.v1', contract_id:'C-V46-08A-001', project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE', revision:7,
  tasks:[{task_id:'T-001', max_attempts:3},{task_id:'T-002', max_attempts:2}],
  acceptance:['bounded-success'], incremental_usd:0
});
const command = c => ({
  schema:'factory.command.v46', command_id:'CMD-001', request_sha256:digest('a'), project_id:c.project_id,
  run_id:'RUN-001', task_id:'T-001', attempt_id:'ATTEMPT-001', attempt_epoch:4,
  contract_id:c.contract_id, contract_ref:'contracts/C-V46-08A-001.json', contract_digest:stableHash(c), contract_revision:c.revision
});
const transport = n => ({transport_run_id:`gha-${n}`, transport_run_attempt:n});
const expected = () => ({candidate_digest:digest('b'), verifier_digest:digest('c')});
function receiptFor(cmd, overrides = {}) {
  const r = {
    schema:'factory.receipt.v46', receipt_id:'RCP-001', project_id:cmd.project_id, run_id:cmd.run_id,
    task_id:cmd.task_id, attempt_id:cmd.attempt_id, attempt_epoch:cmd.attempt_epoch,
    contract_ref:cmd.contract_ref, contract_digest:cmd.contract_digest,
    candidate_digest:digest('b'), verifier_digest:digest('c'), result:'PASS', claim_kind:'SUCCEEDED',
    evidence_refs:['evidence://driver'], test_evidence_refs:['tests://driver'], unresolved_operation_ids:[],
    ...overrides
  };
  r.receipt_identity_digest = receiptIdentityDigest(r);
  return r;
}

function passingWorker(cmd, before = () => {}) {
  return async ({phase, run}) => {
    before({phase, run});
    if (phase === 'READBACK') return {status:'PASS', receipt:receiptFor(cmd), costs:{trace:0,code:0,service:0}, raw_log:'readback pass'};
    return {status:'PASS', costs:{trace:0,code:0,service:0}, raw_log:`${phase} pass`};
  };
}

async function driveToSuccess(root, c, cmd, worker = passingWorker(cmd)) {
  let last;
  for (let n = 1; n <= 6; n++) last = await wakeBoundedDriver({root, contract:c, command:cmd, transport:transport(n), worker, expectedReceiptIdentity:expected()});
  return last;
}

test('fixed phase vocabulary and hard bounds are frozen', () => {
  assert.deepEqual(PHASES, ['ADMIT','PREPARE','IMPLEMENT','VERIFY','EXPORT','PUBLISH','READBACK']);
  assert.equal(MAX_TASKS, 12);
  assert.equal(MAX_ATTEMPTS, 3);
});
test('accepted command is durable before first worker invocation', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let observed = false;
  const worker = passingWorker(cmd, () => {
    const intake = JSON.parse(fs.readFileSync(path.join(root,'intake','commands.json'),'utf8'));
    assert.equal(intake[cmd.command_id].contract_digest, cmd.contract_digest);
    observed = true;
  });
  await wakeBoundedDriver({root, contract:c, command:cmd, transport:transport(1), worker, expectedReceiptIdentity:expected()});
  assert.equal(observed, true);
});

test('finite driver reaches SUCCEEDED through all seven phases', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  const out = await driveToSuccess(root, c, cmd);
  assert.equal(out.status, 'SUCCEEDED');
  assert.deepEqual(out.run.completed_phases, PHASES);
  assert.equal(out.run.phase, 'COMPLETE');
});

test('duplicate transport wake does not call worker twice or change business epoch', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let calls = 0;
  const worker = passingWorker(cmd, () => { calls += 1; });
  const first = await wakeBoundedDriver({root, contract:c, command:cmd, transport:transport(1), worker, expectedReceiptIdentity:expected()});
  const second = await wakeBoundedDriver({root, contract:c, command:cmd, transport:transport(1), worker, expectedReceiptIdentity:expected()});
  assert.equal(first.run.attempt_epoch, 4);
  assert.equal(second.run.attempt_epoch, 4);
  assert.equal(second.duplicate, true);
  assert.equal(calls, 1);
});
test('WAITING_RESOURCE preserves phase and resumes on a later transport wake', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let waited = false;
  const worker = async ({phase}) => {
    if (phase === 'IMPLEMENT' && !waited) {
      waited = true;
      return {status:'WAIT', wait_state:'WAITING_RESOURCE', wait_reason:'SYNTHETIC_RESOURCE_WAIT', costs:{trace:0,code:0,service:0}};
    }
    if (phase === 'READBACK') return {status:'PASS', receipt:receiptFor(cmd), costs:{trace:0,code:0,service:0}};
    return {status:'PASS', costs:{trace:0,code:0,service:0}};
  };
  await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker,expectedReceiptIdentity:expected()});
  const wait = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(2),worker,expectedReceiptIdentity:expected()});
  assert.equal(wait.status, 'WAITING_RESOURCE');
  assert.equal(wait.run.phase, 'IMPLEMENT');
  const resumed = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(3),worker,expectedReceiptIdentity:expected()});
  assert.equal(resumed.run.phase, 'VERIFY');
  assert.equal(resumed.run.attempt_epoch, 4);
});

test('worker callback crash is fail closed and same transport is not redispatched', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let calls = 0;
  const worker = async () => { calls += 1; throw new Error('synthetic crash'); };
  await assert.rejects(() => wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker,expectedReceiptIdentity:expected()}), /synthetic crash/);
  const retry = await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker,expectedReceiptIdentity:expected()});
  assert.equal(retry.status, 'WAITING_CONTROLLER');
  assert.equal(retry.ambiguous, true);
  assert.equal(calls, 1);
});
test('missing or mismatched formal contract is rejected before worker execution', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  let calls = 0;
  const worker = async () => { calls += 1; return {status:'PASS'}; };
  await assert.rejects(() => wakeBoundedDriver({root,contract:{},command:cmd,transport:transport(1),worker}), /FORMAL_CONTRACT_REQUIRED/);
  const drift = structuredClone(c); drift.revision = 8;
  await assert.rejects(() => wakeBoundedDriver({root,contract:drift,command:cmd,transport:transport(2),worker}), /CONTRACT_REVISION_MISMATCH|CONTRACT_DIGEST_MISMATCH/);
  assert.equal(calls, 0);
});

test('more than 12 tasks or more than 3 attempts is rejected', () => {
  const tooMany = contract();
  tooMany.tasks = Array.from({length:13}, (_,i) => ({task_id:`T-${i}`,max_attempts:1}));
  assert.throws(() => validateBoundedContract(tooMany), /INVALID_TASK_COUNT/);
  const tooManyAttempts = contract();
  tooManyAttempts.tasks[0].max_attempts = 4;
  assert.throws(() => validateBoundedContract(tooManyAttempts), /INVALID_MAX_ATTEMPTS/);
});

test('runtime, checkpoint and raw log are separate durable surfaces', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker:passingWorker(cmd),expectedReceiptIdentity:expected()});
  assert.equal(fs.existsSync(path.join(root,'runtime',cmd.run_id,'run.json')), true);
  assert.equal(fs.existsSync(path.join(root,'runtime',cmd.run_id,'checkpoint.json')), true);
  assert.equal(fs.readdirSync(path.join(root,'runtime',cmd.run_id,'raw')).length, 1);
  assert.equal(fs.existsSync(path.join(root,'intake','commands.json')), true);
});
test('accepted command and checkpoint reconstruct after a new driver instance', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker:passingWorker(cmd),expectedReceiptIdentity:expected()});
  const recovered = reconstructBoundedRun(root, cmd.run_id);
  assert.equal(recovered.run.contract_digest, cmd.contract_digest);
  assert.equal(recovered.checkpoint.run_id, cmd.run_id);
  assert.equal(recovered.intake[cmd.command_id].attempt_id, cmd.attempt_id);
});

test('nonzero incremental trace/code/service cost fails closed', async () => {
  for (const key of ['trace','code','service']) {
    const root = tmp(), c = contract(), cmd = command(c);
    const worker = async () => ({status:'PASS', costs:{trace:0,code:0,service:0,[key]:0.01}});
    await assert.rejects(() => wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker,expectedReceiptIdentity:expected()}), /INCREMENTAL_PAID_COST_FORBIDDEN/);
  }
});

test('READBACK requires trusted candidate/verifier identity, not worker self-assertion', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  const worker = passingWorker(cmd);
  for (let n=1; n<=5; n++) await wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(n),worker,expectedReceiptIdentity:expected()});
  const wrong = {...expected(), verifier_digest:digest('d')};
  await assert.rejects(() => wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(6),worker,expectedReceiptIdentity:wrong}), /RECEIPT_IDENTITY_MISMATCH_VERIFIER_DIGEST/);
});

test('effect permit rejects stale epoch before operation is recorded', async () => {
  const root = tmp(), c = contract(), cmd = command(c);
  const worker = async ({run}) => ({status:'PASS', costs:{trace:0,code:0,service:0}, operation:{operation_id:'OP-1',run_id:run.run_id,attempt_epoch:run.attempt_epoch-1,kind:'synthetic',provider:'local',target:'fixture',precondition:{ok:true},payload:{value:1}}});
  await assert.rejects(() => wakeBoundedDriver({root,contract:c,command:cmd,transport:transport(1),worker,expectedReceiptIdentity:expected()}), /STALE_EFFECT_PERMIT/);
  const recovered = reconstructBoundedRun(root, cmd.run_id);
  assert.deepEqual(recovered.run.operations, {});
});
test('candidate workflow is dispatch-only, read-only and exact-SHA bound', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/factory-bounded.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /contents: read/);
  assert.match(yml, /control_sha:/);
  assert.match(yml, /ref: \$\{\{ inputs\.control_sha \}\}/);
  assert.match(yml, /persist-credentials: false/);
  assert.match(yml, /group: PTYSD-V46-CONTROL-TRUSTED/);
  assert.doesNotMatch(yml, /contents: write|actions: write|pull-requests: write|secrets\./);
  assert.doesNotMatch(yml, /^\s*(push|pull_request|schedule):/m);
});
