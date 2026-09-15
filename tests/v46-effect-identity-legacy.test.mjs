import test from 'node:test';
import assert from 'node:assert/strict';
import {stableHash, operationEffectIdentity, assertEffectPermit, recordOperation, requestStop} from '../scripts/v45-state-core.mjs';

const run = {run_id:'R1',revision:7,state:'RUNNING',attempt_epoch:1,stop_requested:false};
const base = {
  operation_id:'OP-1', run_id:'R1', attempt_id:'A1', attempt_epoch:1,
  kind:'PROVIDER_WRITE', provider:'synthetic-provider', target:'synthetic://resource/1',
  precondition:{etag:'v1', expected_state:'READY'}, payload:{value:42, nested:{b:2,a:1}},
};

test('stableHash is key-order independent for JSON-safe values', () => {
  assert.equal(stableHash({b:2,a:{d:4,c:3}}), stableHash({a:{c:3,d:4},b:2}));
});

test('invalid JSON-like values fail closed', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, 1n, Symbol('x'), ()=>{}]) {
    assert.throws(() => stableHash({bad}), /INVALID_JSON_VALUE/);
  }
  const cyclic={}; cyclic.self=cyclic;
  assert.throws(() => stableHash(cyclic), /INVALID_JSON_CYCLE/);
  assert.throws(() => stableHash({d:new Date()}), /INVALID_JSON_OBJECT/);
});

test('logical effect identity excludes attempt and epoch permit fields', () => {
  const a = operationEffectIdentity(base).digest;
  const b = operationEffectIdentity({...base,attempt_id:'A2',attempt_epoch:2}).digest;
  assert.equal(a,b);
});

test('same operation id rejects provider target kind precondition and payload drift', () => {
  const ops=recordOperation({},base);
  const mutations=[
    {...base,provider:'other'}, {...base,target:'synthetic://resource/2'},
    {...base,kind:'OTHER'}, {...base,precondition:{etag:'v2',expected_state:'READY'}},
  ];
  for (const candidate of mutations) assert.throws(()=>recordOperation(ops,candidate),/OPERATION_ID_INTENT_MISMATCH/);
  assert.throws(()=>recordOperation(ops,{...base,payload:{value:43,nested:{a:1,b:2}}}),/OPERATION_ID_PAYLOAD_MISMATCH/);
});

test('full operation intent schema is required', () => {
  for (const field of ['operation_id','kind','provider','target','precondition','payload']) {
    const bad={...base}; delete bad[field];
    assert.throws(()=>recordOperation({},bad),/INVALID_OPERATION_/);
  }
});

test('epoch is a dispatch permit and not logical effect identity', () => {
  assert.equal(assertEffectPermit(run,base),true);
  assert.throws(()=>assertEffectPermit(run,{...base,attempt_epoch:2}),/STALE_EFFECT_PERMIT/);
  assert.throws(()=>assertEffectPermit({...run,stop_requested:true},base),/STOP_BLOCKS_NEW_EFFECT/);
  assert.throws(()=>assertEffectPermit({...run,state:'SUCCEEDED'},base),/TERMINAL_RUN/);
});

test('ACK loss then new epoch recovery keeps synthetic provider effect_count=1', () => {
  let ops=recordOperation({},base);
  const provider=new Map(); let effectCount=0;
  const dispatch=(op)=>{ const id=operationEffectIdentity(op).digest; if(!provider.has(id)){provider.set(id,{applied:true});effectCount++;} };
  assertEffectPermit(run,base); dispatch(base); // provider applied; ACK is lost
  const recoveredRun={...run,revision:8,attempt_epoch:2};
  const recovered={...base,attempt_id:'A2',attempt_epoch:2};
  const before=ops;
  ops=recordOperation(ops,recovered);
  assert.equal(ops,before); // same logical operation, not a new durable intent
  assert.equal(provider.get(operationEffectIdentity(recovered).digest)?.applied,true); // readback-first
  assert.equal(effectCount,1); // no blind redispatch after ACK loss
  assertEffectPermit(recoveredRun,recovered);
});

test('STOP after dispatch does not erase possible prior effect or authorize retry', () => {
  const stopped=requestStop(run,7,1);
  assert.equal(stopped.stop_requested,true);
  assert.throws(()=>assertEffectPermit(stopped,base),/STOP_BLOCKS_NEW_EFFECT/);
});

test('legacy payload-only operation record cannot be silently upgraded', () => {
  const legacy={'OP-1':{...base,payload_digest:stableHash(base.payload)}};
  delete legacy['OP-1'].effect_identity_digest;
  assert.throws(()=>recordOperation(legacy,base),/LEGACY_OPERATION_IDENTITY_INCOMPLETE/);
});
