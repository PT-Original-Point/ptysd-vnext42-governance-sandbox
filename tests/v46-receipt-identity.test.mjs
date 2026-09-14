import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLegacyReceipt,validateReceiptV46} from '../scripts/v46-receipt-validator.candidate.mjs';
const h='sha256:'+'a'.repeat(64), c='sha256:'+'b'.repeat(64), v='sha256:'+'c'.repeat(64);
const receipt={schema:'factory.receipt.v46',receipt_id:'REC-1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',run_id:'R1',task_id:'T1',attempt_id:'A1',attempt_epoch:2,contract_id:'C1',contract_sha256:h,candidate_sha256:c,verifier_sha256:v,resource_identity:'repo:1352411536@candidate',result:'PASS',evidence_refs:['E1'],unresolved_operation_ids:[],stop_requested:false};
const expected={project_id:receipt.project_id,run_id:'R1',task_id:'T1',attempt_id:'A1',attempt_epoch:2,contract_id:'C1',contract_sha256:h,candidate_sha256:c,verifier_sha256:v,resource_identity:receipt.resource_identity,required_evidence_refs:['E1'],run_terminal:false};
test('complete bound receipt is accepted',()=>assert.equal(validateReceiptV46(receipt,expected),true));
test('wrong task attempt contract candidate verifier or resource is rejected',()=>{
  for(const [k,val] of [['task_id','T2'],['attempt_id','A2'],['contract_id','C2'],['candidate_sha256','sha256:'+'d'.repeat(64)],['verifier_sha256','sha256:'+'e'.repeat(64)],['resource_identity','repo:other']]) assert.throws(()=>validateReceiptV46({...receipt,[k]:val},expected),/RECEIPT_BINDING_MISMATCH/);
});
test('PASS requires evidence and no unresolved effects or STOP',()=>{
  assert.throws(()=>validateReceiptV46({...receipt,evidence_refs:[]},expected),/EVIDENCE_REQUIRED/);
  assert.throws(()=>validateReceiptV46({...receipt,unresolved_operation_ids:['O1']},expected),/PASS_WITH_UNRESOLVED_EFFECTS/);
  assert.throws(()=>validateReceiptV46({...receipt,stop_requested:true},expected),/PASS_AFTER_STOP_REQUEST/);
});
test('legacy incomplete receipt is historical evidence only',()=>{
  const legacy={run_id:'R1',attempt_epoch:2,result:'PASS'};
  assert.equal(classifyLegacyReceipt(legacy).classification,'HISTORICAL_EVIDENCE_ONLY');
  assert.throws(()=>validateReceiptV46(legacy,expected),/RECEIPT_IDENTITY_INCOMPLETE/);
});
test('terminal run rejects a different completion receipt',()=>{
  assert.throws(()=>validateReceiptV46(receipt,{...expected,run_terminal:true,prior_terminal_receipt_id:'REC-0'}),/TERMINAL_REWRITE_REJECTED/);
  assert.equal(validateReceiptV46(receipt,{...expected,run_terminal:true,prior_terminal_receipt_id:'REC-1'}),true);
});
