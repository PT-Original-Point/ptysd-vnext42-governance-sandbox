import test from 'node:test';
import assert from 'node:assert/strict';
import {effectFingerprint, recordOperationV46, strictHash} from '../scripts/v46-effect-identity.candidate.mjs';
const base={operation_id:'O1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',provider:'synthetic',operation_kind:'SET',target_resource_id:'resource:1',logical_scope_id:'contract:C1',precondition:{revision:7},payload:{a:1,b:[2,3]},attempt_epoch:1};

test('logical effect identity is stable across recovery epoch',()=>{
  const a=recordOperationV46({},base);
  assert.equal(recordOperationV46(a,{...base,attempt_epoch:2}),a);
  assert.equal(effectFingerprint(base),effectFingerprint({...base,attempt_epoch:99,attempt_id:'different'}));
});

test('same operation id rejects changed provider target kind precondition or payload',()=>{
  const a=recordOperationV46({},base);
  const variants=[
    {...base,provider:'other'},
    {...base,target_resource_id:'resource:alias'},
    {...base,operation_kind:'DELETE'},
    {...base,precondition:{revision:8}},
    {...base,payload:{a:2,b:[2,3]}},
  ];
  for(const v of variants) assert.throws(()=>recordOperationV46(a,v),/OPERATION_ID_INTENT_MISMATCH/);
});

test('canonical JSON is order-stable but rejects values JSON would silently alias',()=>{
  assert.equal(strictHash({b:2,a:1}),strictHash({a:1,b:2}));
  for(const bad of [{x:NaN},{x:Infinity},{x:undefined},{x:1n}]) assert.throws(()=>strictHash(bad),/INVALID_CANONICAL_JSON/);
});

test('legacy payload-only record cannot be silently promoted to full identity',()=>{
  const legacy={O1:{operation_id:'O1',payload:{a:1,b:[2,3]},payload_digest:strictHash({a:1,b:[2,3]})}};
  assert.throws(()=>recordOperationV46(legacy,base),/LEGACY_OPERATION_IDENTITY_AMBIGUOUS/);
});

test('ACK-loss recovery with a new epoch applies logical effect once',()=>{
  let ops={}; let effectCount=0;
  const apply=(op)=>{const before=ops; const after=recordOperationV46(ops,op); if(after!==before){effectCount++; ops=after;} return after;};
  apply(base); // provider applied; ACK imagined lost
  apply({...base,attempt_epoch:2}); // readback/recovery sees same identity; no new effect
  assert.equal(effectCount,1);
  assert.throws(()=>apply({...base,attempt_epoch:2,payload:{a:999}}),/OPERATION_ID_INTENT_MISMATCH/);
  assert.equal(effectCount,1);
});
