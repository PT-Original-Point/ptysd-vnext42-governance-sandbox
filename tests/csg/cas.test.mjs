import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTopologyCasProposal,classifyProviderUpdate,reconcileAckLoss} from '../../scripts/csg-git-cas.mjs';
const P='4'.repeat(40),C1='5'.repeat(40),C2='6'.repeat(40),T0='7'.repeat(40),T1='8'.repeat(40);

test('01 proposal requires exact direct parent and force=false',()=>{
 const p=buildTopologyCasProposal({beforeOid:P,proposalParentOid:P,baseTreeOid:T0,afterTreeOid:T1,afterOid:C1,force:false});
 assert.equal(p.beforeOid,P);assert.equal(p.force,false);
});
test('02 stale proposal parent is rejected before dispatch',()=>assert.throws(()=>buildTopologyCasProposal({beforeOid:C1,proposalParentOid:P,baseTreeOid:T0,afterTreeOid:T1,afterOid:C2,force:false}),/DIRECT_PARENT_REQUIRED/));
test('03 force=true is never emitted',()=>assert.throws(()=>buildTopologyCasProposal({beforeOid:P,proposalParentOid:P,baseTreeOid:T0,afterTreeOid:T1,afterOid:C1,force:true}),/FORCE_FORBIDDEN/));
test('04 ACK loss is reconciled by exact tuple readback',()=>{assert.equal(reconcileAckLoss({beforeOid:P,afterOid:C1,currentOid:C1}),'CONFIRMED');assert.equal(reconcileAckLoss({beforeOid:P,afterOid:C1,currentOid:P}),'NOT_APPLIED');assert.equal(reconcileAckLoss({beforeOid:P,afterOid:C1,currentOid:C2}),'PARTIAL_OR_AMBIGUOUS');});
test('05 provider stale sibling rejection is classified without retry',()=>assert.equal(classifyProviderUpdate({status:'NON_FAST_FORWARD_REJECTED',currentOid:C1,beforeOid:P,afterOid:C2}),'STALE_REJECTED_CURRENT_ADVANCED'));
