import unittest
from recovery_owner_policy import *

NOW='2026-09-16T08:30:00Z'
EXPIRED={'principal_id':'OLD','owner_generation':7,'scope':'CSG','lease_until':'2026-09-16T08:00:00Z'}
LIVE={'principal_id':'OLD','owner_generation':7,'scope':'CSG','lease_until':'2026-09-16T09:00:00Z'}
BASE=dict(provider_now=NOW,current_attempt_epoch=3,stop_requested=False,mission_match=True,policy_match=True,controller_match=True)

class T(unittest.TestCase):
 def test_read_does_not_claim(self):
  m=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job=None,**BASE); self.assertEqual(m['mode'],'CLAIM_ORDINARY_OWNER'); self.assertNotIn('transport_id',m)
 def test_two_sessions_generation_is_monotonic(self):
  a=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job=None,**BASE); b=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job=None,**BASE); self.assertEqual(a['next_owner_generation'],8); self.assertEqual(b['next_owner_generation'],8)
 def test_zombie_sender_quarantined(self):
  self.assertEqual(classify_receipt(receipt_owner_generation=7,current_owner_generation=8,receipt_attempt_epoch=3,current_attempt_epoch=3,receipt_mission_revision='M',current_mission_revision='M'),'QUARANTINE_STALE_OWNER')
 def test_stale_attempt_quarantined(self):
  self.assertEqual(classify_receipt(receipt_owner_generation=8,current_owner_generation=8,receipt_attempt_epoch=2,current_attempt_epoch=3,receipt_mission_revision='M',current_mission_revision='M'),'QUARANTINE_STALE_ATTEMPT')
 def test_old_mission_late_quarantined(self):
  self.assertEqual(classify_receipt(receipt_owner_generation=8,current_owner_generation=8,receipt_attempt_epoch=3,current_attempt_epoch=3,receipt_mission_revision='OLD',current_mission_revision='NEW'),'QUARANTINE_STALE_MISSION')
 def test_pending_expired_owner_enters_recovery_only_no_deadlock(self):
  m=resume_mode(owner=EXPIRED,unresolved_effects=['op1'],live_job=None,**BASE); self.assertEqual(m['mode'],'RECOVERY_ONLY'); self.assertEqual(m['next_owner_generation'],8); self.assertTrue(m['preserve_pending']); self.assertEqual(authorize_action(m['mode'],'READBACK'),'ALLOW'); self.assertEqual(authorize_action(m['mode'],'DISPATCH'),'DENY_RECOVERY_ONLY')
 def test_live_job_adoption_preserves_attempt_no_redispatch(self):
  m=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job={'state':'IN_PROGRESS','attempt_epoch':3},**BASE); self.assertEqual(m['mode'],'ADOPT_LIVE_JOB'); self.assertFalse(m['redispatch']); self.assertEqual(m['attempt_epoch'],3)
 def test_live_owner_continues_without_generation_bump(self):
  m=resume_mode(owner=LIVE,unresolved_effects=[],live_job={'state':'IN_PROGRESS','attempt_epoch':3},**BASE); self.assertEqual(m['owner_generation'],7); self.assertEqual(m['mode'],'CURRENT_OWNER_CONTINUES')
 def test_worker_completed_controller_gone_readback_only(self):
  m=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job={'state':'COMPLETED','attempt_epoch':3},**BASE); self.assertEqual(m['mode'],'ADOPT_COMPLETED_RESULT_READBACK'); self.assertEqual(authorize_action(m['mode'],'DISPATCH'),'DENY_NON_WRITER_MODE')
 def test_client_clock_cannot_override_provider_time(self):
  self.assertFalse(owner_expired(LIVE,NOW)); self.assertTrue(owner_expired(EXPIRED,NOW))
 def test_stop_blocks_writer(self):
  kw=dict(BASE); kw['stop_requested']=True; m=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job=None,**kw); self.assertEqual(m['mode'],'OBSERVER_STOPPED'); self.assertFalse(m['ordinary_writer'])
 def test_rebase_blocks_writer(self):
  kw=dict(BASE); kw['mission_match']=False; m=resume_mode(owner=EXPIRED,unresolved_effects=[],live_job=None,**kw); self.assertEqual(m['mode'],'REBASE_REQUIRED')
 def test_transport_identity_is_not_owner_identity(self):
  c=claim_tuple(principal_id='P',owner_generation=8,attempt_id='A',attempt_epoch=3,transport_id='T'); self.assertNotEqual(c['principal_id'],c['transport_id']); self.assertEqual(c['owner_generation'],8)

if __name__=='__main__': unittest.main(verbosity=2)
