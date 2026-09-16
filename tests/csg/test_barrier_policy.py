import unittest
from barrier_policy import *

def clean():
 return {'stop_requested':False,'mission_match':True,'policy_match':True,'controller_match':True,'owner_mode':'CURRENT_OWNER_CONTINUES','unresolved_effects':[],'barrier':'CLEAN','checkpoint_readback':True,'atomic_unit':None}

class T(unittest.TestCase):
 def test_begin_requires_clean_checkpoint_readback(self):
  s=begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=True); self.assertEqual(s['last_event'],'ATOMIC_STARTED'); self.assertEqual(s['barrier'],'ACTIVE_UNIT')
 def test_crash_after_tests_before_accept_stays_started(self):
  s=begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=True); self.assertEqual(next_unit_permit(s)['reason'],'CHECKPOINT_BARRIER_NOT_CLEAN'); self.assertNotIn('last_accepted',s)
 def test_accept_requires_remote_evidence_effects(self):
  s=begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=True)
  with self.assertRaisesRegex(BarrierError,'ACCEPT_EVIDENCE_INCOMPLETE'): accept_unit(s,'U1',remote_wip_verified=True,evidence_verified=False,effects_reconciled=True,checkpoint_backend_available=True)
 def test_accept_returns_clean_and_next_permit(self):
  s=begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=True); a=accept_unit(s,'U1',remote_wip_verified=True,evidence_verified=True,effects_reconciled=True,checkpoint_backend_available=True); self.assertEqual(a['last_accepted'],'U1'); self.assertTrue(next_unit_permit(a)['permit'])
 def test_checkpoint_down_blocks_begin(self):
  with self.assertRaisesRegex(BarrierError,'BEGIN_CHECKPOINT_UNAVAILABLE'): begin_unit(clean(),'U1',checkpoint_backend_available=False,mutation_permit=True)
 def test_checkpoint_down_blocks_accept(self):
  s=begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=True)
  with self.assertRaisesRegex(BarrierError,'ACCEPT_CHECKPOINT_UNAVAILABLE'): accept_unit(s,'U1',remote_wip_verified=True,evidence_verified=True,effects_reconciled=True,checkpoint_backend_available=False)
 def test_ui_claim_pass_cannot_accept(self):
  s=begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=True); s['ui_claim_pass']=True
  with self.assertRaisesRegex(BarrierError,'ACCEPT_EVIDENCE_INCOMPLETE'): accept_unit(s,'U1',remote_wip_verified=False,evidence_verified=False,effects_reconciled=True,checkpoint_backend_available=True)
 def test_direct_tool_bypass_requires_mutation_permit(self):
  with self.assertRaisesRegex(BarrierError,'BEGIN_MUTATION_PERMIT_REQUIRED'): begin_unit(clean(),'U1',checkpoint_backend_available=True,mutation_permit=False)
 def test_unresolved_effect_blocks_next_unit(self):
  s=clean(); s['unresolved_effects']=['OP1']; self.assertEqual(next_unit_permit(s)['reason'],'UNRESOLVED_EFFECT')
 def test_stop_blocks_new_unit_but_recovery_read_allowed(self):
  s=clean(); s['stop_requested']=True; self.assertEqual(next_unit_permit(s)['reason'],'STOP_REQUESTED'); self.assertTrue(recovery_permit(s,'READBACK')); self.assertFalse(recovery_permit(s,'DISPATCH'))
 def test_recovery_only_owner_blocks_new_unit(self):
  s=clean(); s['owner_mode']='RECOVERY_ONLY'; self.assertEqual(next_unit_permit(s)['reason'],'NO_ORDINARY_WRITER'); self.assertTrue(recovery_permit(s,'CLASSIFY_EFFECT'))
 def test_rebase_blocks_new_unit(self):
  s=clean(); s['mission_match']=False; self.assertEqual(next_unit_permit(s)['reason'],'REBASE_REQUIRED')
 def test_missing_readback_blocks_even_clean_barrier(self):
  s=clean(); s['checkpoint_readback']=False; self.assertEqual(next_unit_permit(s)['reason'],'CHECKPOINT_READBACK_REQUIRED')

if __name__=='__main__': unittest.main(verbosity=2)
