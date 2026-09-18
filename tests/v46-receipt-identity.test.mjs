import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptIdentityDigest, validateReceiptV46, readReceiptCompat, admitCompletion} from '../scripts/v46-receipt-admission.mjs';

const H = ch => 'sha256:' + ch.repeat(64);
const run = {run_id:'R1',state:'VERIFYING',attempt_epoch:2,unresolved_operation_ids:[]};
function makeReceipt(overrides={}) {
  const r={
    schema:'factory.receipt.v46', receipt_id:'RCPT-1', project_id:'P1', run_id:'R1', task_id:'T1', attempt_id:'A2', attempt_epoch:2,
    contract_ref:'contracts/C1.json', contract_digest:H('a'), candidate_digest:H('b'), verifier_digest:H('c'),
    result:'PASS', claim_kind:'SUCCEEDED', evidence_refs:['evidence/result.json'], test_evidence_refs:['evidence/tests.json'], unresolved_operation_ids:[], helper_success:true,
    ...overrides,
  };
  r.receipt_identity_digest=receiptIdentityDigest(r);
  return r;
}
const expected=Object.fromEntries(['project_id','run_id','task_id','attempt_id','attempt_epoch','contract_ref','contract_digest','candidate_digest','verifier_digest'].map(k=>[k,makeReceipt()[k]]));

test('valid full-identity SUCCEEDED receipt is admitted',()=>{
  const r=makeReceipt(); assert.equal(validateReceiptV46(r),true); assert.equal(admitCompletion(run,r,expected).accepted,true);
});

test('wrong task attempt contract candidate verifier identities are rejected',()=>{
  for(const [field,value] of [['task_id','T2'],['attempt_id','A3'],['attempt_epoch',3],['contract_ref','contracts/C2.json'],['contract_digest',H('d')],['candidate_digest',H('e')],['verifier_digest',H('f')]]){
    const r=makeReceipt({[field]:value});
    assert.throws(()=>admitCompletion(run,r,expected),/RECEIPT_IDENTITY_MISMATCH/);
  }
});

test('missing candidate verifier contract digests fail closed',()=>{
  for(const field of ['contract_digest','candidate_digest','verifier_digest']){
    const r=makeReceipt(); delete r[field];
    assert.throws(()=>validateReceiptV46(r),/MISSING_RECEIPT_/);
  }
});

test('helper_success true cannot replace evidence',()=>{
  const a=makeReceipt({evidence_refs:[]}); a.receipt_identity_digest=receiptIdentityDigest(a);
  const b=makeReceipt({test_evidence_refs:[]}); b.receipt_identity_digest=receiptIdentityDigest(b);
  assert.throws(()=>admitCompletion(run,a,expected),/MISSING_RECEIPT_EVIDENCE/);
  assert.throws(()=>admitCompletion(run,b,expected),/MISSING_RECEIPT_TEST_EVIDENCE/);
});

test('unresolved effects block SUCCEEDED admission',()=>{
  const r=makeReceipt({unresolved_operation_ids:['OP-UNKNOWN']}); r.receipt_identity_digest=receiptIdentityDigest(r);
  assert.throws(()=>admitCompletion(run,r,expected),/UNRESOLVED_EFFECTS_BLOCK_COMPLETION/);
});

test('receipt identity digest detects bound-field tampering',()=>{
  const r=makeReceipt(); r.task_id='TAMPERED';
  assert.throws(()=>validateReceiptV46(r),/RECEIPT_IDENTITY_DIGEST_MISMATCH/);
});

test('WIP requires exact provider readback and remote ref',()=>{
  let r=makeReceipt({claim_kind:'WIP_CHECKPOINT',remote_wip_ref:'refs/heads/wip/R1',provider_readback:{verified:true,exact_match:true}}); r.receipt_identity_digest=receiptIdentityDigest(r);
  assert.equal(admitCompletion(run,r,expected).accepted,true);
  r=makeReceipt({claim_kind:'WIP_CHECKPOINT',remote_wip_ref:'refs/heads/wip/R1',provider_readback:{verified:true,exact_match:false}}); r.receipt_identity_digest=receiptIdentityDigest(r);
  assert.throws(()=>admitCompletion(run,r,expected),/WIP_PROVIDER_READBACK_REQUIRED/);
});

test('legacy receipt reader never fabricates missing v46 evidence',()=>{
  const legacy={schema:'factory.receipt.v1',receipt_id:'OLD',run_id:'R1',task_id:'T1',attempt_id:'A1',attempt_epoch:1,result:'PASS',evidence_refs:['e.json']};
  const x=readReceiptCompat(legacy);
  assert.equal(x.verified,false); assert.equal(x.legacy,true); assert.deepEqual(x.fabricated_fields,[]);
  assert.equal('candidate_digest' in x.receipt,false); assert.equal('verifier_digest' in x.receipt,false); assert.equal('test_evidence_refs' in x.receipt,false);
});

test('terminal run cannot be rewritten by a later PASS receipt',()=>{
  const r=makeReceipt();
  assert.throws(()=>admitCompletion({...run,state:'SUCCEEDED'},r,expected),/TERMINAL_RUN_REWRITE/);
  assert.throws(()=>admitCompletion({...run,state:'FAILED'},r,expected),/TERMINAL_RUN_REWRITE/);
});

test('stale attempt epoch cannot complete current run',()=>{
  const r=makeReceipt({attempt_epoch:1}); r.receipt_identity_digest=receiptIdentityDigest(r);
  const staleExpected={...expected,attempt_epoch:1};
  assert.throws(()=>admitCompletion(run,r,staleExpected),/STALE_ATTEMPT_RECEIPT/);
});
