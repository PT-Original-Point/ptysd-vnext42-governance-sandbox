const OID=/^[0-9a-f]{40}$/;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function oid(v,name){if(typeof v!=='string'||!OID.test(v))fail(`INVALID_${name}`);return v;}

export function buildTopologyCasProposal({beforeOid,proposalParentOid,baseTreeOid,afterTreeOid,afterOid,force=false}){
  oid(beforeOid,'BEFORE_OID'); oid(proposalParentOid,'PROPOSAL_PARENT_OID'); oid(baseTreeOid,'BASE_TREE_OID'); oid(afterTreeOid,'AFTER_TREE_OID'); oid(afterOid,'AFTER_OID');
  if(force!==false) fail('FORCE_FORBIDDEN');
  if(proposalParentOid!==beforeOid) fail('DIRECT_PARENT_REQUIRED');
  return {beforeOid,proposalParentOid,baseTreeOid,afterTreeOid,afterOid,force:false,mutation:'UPDATE_REF_FAST_FORWARD_ONLY'};
}
export function reconcileAckLoss({beforeOid,afterOid,currentOid}){
  oid(beforeOid,'BEFORE_OID'); oid(afterOid,'AFTER_OID'); oid(currentOid,'CURRENT_OID');
  if(currentOid===afterOid)return 'CONFIRMED';
  if(currentOid===beforeOid)return 'NOT_APPLIED';
  return 'PARTIAL_OR_AMBIGUOUS';
}
export function classifyProviderUpdate({status,currentOid,beforeOid,afterOid}){
  if(status==='SUCCESS')return currentOid===afterOid?'CONFIRMED':'PARTIAL_OR_AMBIGUOUS';
  if(status==='NON_FAST_FORWARD_REJECTED')return currentOid===beforeOid?'NOT_APPLIED':'STALE_REJECTED_CURRENT_ADVANCED';
  return reconcileAckLoss({beforeOid,afterOid,currentOid});
}
