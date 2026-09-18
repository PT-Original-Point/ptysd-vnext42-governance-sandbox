import {stableHash} from './v45-state-core.mjs';

const TERMINAL = new Set(['STOPPED','QUARANTINED','SUCCEEDED','FAILED']);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REQUIRED_STRINGS = ['receipt_id','project_id','run_id','task_id','attempt_id','contract_ref','contract_digest','candidate_digest','verifier_digest','receipt_identity_digest'];
const IDENTITY_FIELDS = ['project_id','run_id','task_id','attempt_id','attempt_epoch','contract_ref','contract_digest','candidate_digest','verifier_digest'];

export function receiptIdentityMaterial(receipt) {
  return Object.fromEntries(IDENTITY_FIELDS.map(k => [k, receipt[k]]));
}

export function receiptIdentityDigest(receipt) {
  return stableHash(receiptIdentityMaterial(receipt));
}

export function validateReceiptV46(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('INVALID_RECEIPT');
  if (receipt.schema !== 'factory.receipt.v46') throw new Error('UNSUPPORTED_RECEIPT_SCHEMA');
  for (const field of REQUIRED_STRINGS) if (typeof receipt[field] !== 'string' || receipt[field].trim() === '') throw new Error(`MISSING_RECEIPT_${field.toUpperCase()}`);
  if (!Number.isInteger(receipt.attempt_epoch) || receipt.attempt_epoch < 0) throw new Error('INVALID_RECEIPT_ATTEMPT_EPOCH');
  for (const field of ['contract_digest','candidate_digest','verifier_digest','receipt_identity_digest']) if (!SHA256.test(receipt[field])) throw new Error(`INVALID_RECEIPT_${field.toUpperCase()}`);
  if (!['PASS','FAIL'].includes(receipt.result)) throw new Error('INVALID_RECEIPT_RESULT');
  if (!['SUCCEEDED','WIP_CHECKPOINT'].includes(receipt.claim_kind)) throw new Error('INVALID_RECEIPT_CLAIM_KIND');
  if (!Array.isArray(receipt.evidence_refs) || receipt.evidence_refs.length < 1 || receipt.evidence_refs.some(x => typeof x !== 'string' || !x)) throw new Error('MISSING_RECEIPT_EVIDENCE');
  if (!Array.isArray(receipt.test_evidence_refs) || receipt.test_evidence_refs.length < 1 || receipt.test_evidence_refs.some(x => typeof x !== 'string' || !x)) throw new Error('MISSING_RECEIPT_TEST_EVIDENCE');
  if (!Array.isArray(receipt.unresolved_operation_ids)) throw new Error('INVALID_RECEIPT_UNRESOLVED_OPERATIONS');
  if (receipt.receipt_identity_digest !== receiptIdentityDigest(receipt)) throw new Error('RECEIPT_IDENTITY_DIGEST_MISMATCH');
  if (receipt.claim_kind === 'WIP_CHECKPOINT') {
    if (typeof receipt.remote_wip_ref !== 'string' || !receipt.remote_wip_ref) throw new Error('WIP_REMOTE_REF_REQUIRED');
    if (receipt.provider_readback?.verified !== true || receipt.provider_readback?.exact_match !== true) throw new Error('WIP_PROVIDER_READBACK_REQUIRED');
  }
  return true;
}

export function readReceiptCompat(receipt) {
  if (receipt?.schema === 'factory.receipt.v46') return {verified:true, legacy:false, receipt};
  return {
    verified:false,
    legacy:true,
    receipt,
    fabricated_fields:[],
    reason:'LEGACY_RECEIPT_REQUIRES_EXPLICIT_REVALIDATION',
  };
}

export function admitCompletion(run, receipt, expected) {
  validateReceiptV46(receipt);
  if (receipt.result !== 'PASS') throw new Error('RECEIPT_NOT_PASS');
  for (const field of IDENTITY_FIELDS) if (receipt[field] !== expected[field]) throw new Error(`RECEIPT_IDENTITY_MISMATCH_${field.toUpperCase()}`);
  if (receipt.unresolved_operation_ids.length !== 0) throw new Error('UNRESOLVED_EFFECTS_BLOCK_COMPLETION');
  if (receipt.claim_kind === 'SUCCEEDED') {
    if (TERMINAL.has(run.state)) throw new Error('TERMINAL_RUN_REWRITE');
    if (run.run_id !== receipt.run_id) throw new Error('RUN_MISMATCH');
    if (run.attempt_epoch !== receipt.attempt_epoch) throw new Error('STALE_ATTEMPT_RECEIPT');
  }
  return {accepted:true, claim_kind:receipt.claim_kind, receipt_id:receipt.receipt_id};
}
