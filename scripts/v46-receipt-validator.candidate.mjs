const SHA=/^sha256:[0-9a-f]{64}$/;
const REQUIRED=['schema','receipt_id','project_id','run_id','task_id','attempt_id','attempt_epoch','contract_id','contract_sha256','candidate_sha256','verifier_sha256','resource_identity','result','evidence_refs','unresolved_operation_ids','stop_requested'];
export function classifyLegacyReceipt(receipt){
  const missing=REQUIRED.filter(k=>!(k in receipt));
  return missing.length?{classification:'HISTORICAL_EVIDENCE_ONLY',missing}:{classification:'V46_COMPLETE',missing:[]};
}
export function validateReceiptV46(receipt, expected){
  const legacy=classifyLegacyReceipt(receipt);
  if(legacy.classification!=='V46_COMPLETE') throw new Error('RECEIPT_IDENTITY_INCOMPLETE');
  if(receipt.schema!=='factory.receipt.v46') throw new Error('RECEIPT_SCHEMA_MISMATCH');
  for(const k of ['contract_sha256','candidate_sha256','verifier_sha256']) if(!SHA.test(receipt[k])) throw new Error(`INVALID_DIGEST:${k}`);
  if(!Number.isInteger(receipt.attempt_epoch)||receipt.attempt_epoch<0) throw new Error('INVALID_ATTEMPT_EPOCH');
  if(!Array.isArray(receipt.evidence_refs)||receipt.evidence_refs.length===0) throw new Error('EVIDENCE_REQUIRED');
  if(!Array.isArray(receipt.unresolved_operation_ids)) throw new Error('INVALID_UNRESOLVED_OPERATIONS');
  const bindings=['project_id','run_id','task_id','attempt_id','attempt_epoch','contract_id','contract_sha256','candidate_sha256','verifier_sha256','resource_identity'];
  for(const k of bindings) if(receipt[k]!==expected[k]) throw new Error(`RECEIPT_BINDING_MISMATCH:${k}`);
  for(const ref of expected.required_evidence_refs||[]) if(!receipt.evidence_refs.includes(ref)) throw new Error(`EVIDENCE_MISSING:${ref}`);
  if(receipt.result==='PASS'&&receipt.unresolved_operation_ids.length) throw new Error('PASS_WITH_UNRESOLVED_EFFECTS');
  if(receipt.result==='PASS'&&receipt.stop_requested) throw new Error('PASS_AFTER_STOP_REQUEST');
  if(expected.run_terminal&&expected.prior_terminal_receipt_id!==receipt.receipt_id) throw new Error('TERMINAL_REWRITE_REJECTED');
  return true;
}
