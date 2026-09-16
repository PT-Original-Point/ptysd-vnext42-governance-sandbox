import unittest
from effect_recovery_policy import *

INTENT={'operation_id':'OP-001','logical_action_key':'github-ref-update:repo1352411536:queue','idempotency_key':'stable-key-001','idempotency_valid':True,'provider':'GitHub','target':'refs/heads/queue/csg-continuity-repair-20260916'}
PROFILE={'query_capability':'EXACT_SAME_SOURCE','same_key_retry_supported':True}

def rb(state, **kw):
 d={'provider':'GitHub','target':INTENT['target'],'state':state,'exact_identity':True,'auth_status':'OK'}; d.update(kw); return d

def negative(**kw):
 d={'finality':True,'absence_basis':'exact ref still at prestate','late_request_excluded':True,'retention_valid':True,'no_inflight_request':True}; d.update(kw); return d

class T(unittest.TestCase):
 def test_ack_lost_confirmed_no_resend(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('EXPECTED_POSTSTATE')); self.assertEqual(r['outcome'],'CONFIRMED'); self.assertFalse(r['redispatch'])
 def test_not_found_alone_is_not_not_applied(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('NOT_FOUND')); self.assertEqual(r['outcome'],'PARTIAL_OR_AMBIGUOUS')
 def test_403_is_inconclusive(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('NOT_FOUND',auth_status='FORBIDDEN')); self.assertEqual(r['next_allowed'],'HUMAN_GATE')
 def test_no_query_api_is_ambiguous(self):
  r=recover_unknown_effect(intent=INTENT,profile={'query_capability':'NONE','same_key_retry_supported':False},readback=rb('EXPECTED_PRESTATE')); self.assertEqual(r['outcome'],'PARTIAL_OR_AMBIGUOUS')
 def test_full_negative_proof_allows_same_identity_retry_candidate(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('EXPECTED_PRESTATE',negative_proof=negative())); self.assertEqual(r['outcome'],'NOT_APPLIED'); self.assertEqual(r['next_allowed'],'SAME_ID_RETRY'); self.assertFalse(r['redispatch'])
 def test_key_expired_never_regenerates_retry(self):
  x=dict(INTENT,idempotency_valid=False); r=recover_unknown_effect(intent=x,profile=PROFILE,readback=rb('EXPECTED_PRESTATE',negative_proof=negative())); self.assertEqual(r['outcome'],'NOT_APPLIED'); self.assertEqual(r['next_allowed'],'HUMAN_GATE')
 def test_late_request_not_excluded_is_ambiguous(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('EXPECTED_PRESTATE',negative_proof=negative(late_request_excluded=False))); self.assertEqual(r['outcome'],'PARTIAL_OR_AMBIGUOUS')
 def test_inflight_request_is_ambiguous(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('EXPECTED_PRESTATE',negative_proof=negative(no_inflight_request=False))); self.assertEqual(r['outcome'],'PARTIAL_OR_AMBIGUOUS')
 def test_wrong_target_fails_closed(self):
  x=rb('EXPECTED_POSTSTATE'); x['target']='wrong'; r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=x); self.assertEqual(r['next_allowed'],'HUMAN_GATE')
 def test_partial_effect_never_retries(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('PARTIAL')); self.assertEqual(r['outcome'],'PARTIAL_OR_AMBIGUOUS'); self.assertFalse(r['redispatch'])
 def test_stop_inflight_still_readback_no_dispatch(self):
  r=recover_unknown_effect(intent=INTENT,profile=PROFILE,readback=rb('EXPECTED_POSTSTATE'),stop_requested=True); self.assertEqual(r['outcome'],'CONFIRMED'); self.assertFalse(r['redispatch'])
 def test_handoff_preserves_operation_identity(self):
  after=dict(INTENT,session_id='NEW'); before=dict(INTENT,session_id='OLD'); self.assertTrue(validate_handoff_identity(before,after))
 def test_handoff_key_change_detected(self):
  after=dict(INTENT,idempotency_key='new-key'); self.assertFalse(validate_handoff_identity(INTENT,after))

if __name__=='__main__': unittest.main(verbosity=2)
