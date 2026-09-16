import unittest
from checkpoint_bundle_canary import *

P='7'*40
EV_PATH='evidence/csg/csg-06a-000001.json'

def fixture():
    ev={'schema_version':'csg.evidence.v1','evidence_id':'CSG-06A-EVIDENCE-000001','project_id':'CHATGPT_GLOBAL_SKILL_GOVERNANCE','subject':{'unit_id':'CSG-06A','source_commit':{'algorithm':'sha1','hex':'8'*40},'contract_digest':'sha256:'+'9'*64},'category':'PROVIDER_READBACK','expected_set_ref':{'kind':'EXTERNAL_IMMUTABLE','provider':'GitHub','repository_id_or_resource_id':'1352411536','revision':'8'*40,'path':'tests/csg/expected-set.v1.json','digest':'sha256:'+'a'*64},'verifier_ref':{'kind':'EXTERNAL_IMMUTABLE','provider':'GitHub','repository_id_or_resource_id':'1352411536','revision':'5'*40,'path':'governance/csg/trust-root/csg-trusted-pr-verifier.mjs','digest':'sha256:'+'b'*64},'result':'PASS','observed_by':'CHATGPT_CONTROLLER','observed_at':'2026-09-16T07:45:00Z','source_refs':[{'immutable_ref':{'kind':'EXTERNAL_IMMUTABLE','provider':'GitHub','repository_id_or_resource_id':'1352411536','revision':'8'*40,'path':'artifacts/csg/csg-05-local-test-report.txt','digest':'sha256:'+'c'*64},'digest':'sha256:'+'c'*64,'size':1066,'media_type':'text/plain'}],'retention_until':None,'archive_ref':None,'data_classification':'INTERNAL','source_ancestry':['CSG-05'],'supersedes_ref':None,'payload_digest':''}
    ev['payload_digest']=payload_digest(ev)
    cp={'schema_version':'csg.checkpoint.v1','project_id':'CHATGPT_GLOBAL_SKILL_GOVERNANCE','checkpoint_seq':1,'transition_id':'CSG-06A-CANARY-001','previous_checkpoint_ref':None,'migration_anchor':{'control_ref':'refs/heads/v45/factory-control','control_sha':'0'*40},'event':{'type':'GATE_PASS','reason_code':'CSG_05_PASS','subject_id':'CSG-05'},'mission_anchor':{'ref':'github://mission','revision':'r1','declared_hash':'sha256:'+'d'*64,'canonicalization_version':'HUMAN_TEXT_V1'},'policy_anchor':{'ref':'github://policy','revision':'p1','declared_hash':'sha256:'+'e'*64,'canonicalization_version':'HUMAN_TEXT_V1'},'controller_contract':'CHAT_EXECUTION_POLICY_CONTRACT_V9_1_CANDIDATE','verifier_digest':'sha256:'+'b'*64,'lifecycle':'ACTIVE','owner':None,'run_ref':None,'task_id':'W47-06','attempt_id':'V47-W47-06-ATTEMPT-001','attempt_epoch':1,'atomic':{'wp_id':'CSG-06A','state':'CANARY_BUNDLE'},'last_accepted':{'wp_id':'CSG-05'},'remote_wip':{'ref':'refs/heads/queue/csg-05-source-20260916','commit':'8'*40},'active_job_refs':[],'unresolved_effect_refs':[],'blockers':[],'last_verified_gate':{'wp_id':'CSG-05'},'next_legal_transition':{'action':'QUALIFY_CSG_06B_OWNER_ADOPTION','unit_id':'CSG-06B','requires':['CSG-06A'],'forbidden':['PRODUCTION','BUSINESS_PROJECT']},'stop_requested':False,'barrier':'CLEAN','evidence_refs':[bundle_ref(EV_PATH,ev['payload_digest'])],'recorded_at':'2026-09-16T07:45:00Z','payload_digest':''}
    cp['payload_digest']=payload_digest(cp)
    ptr={'schema_version':'csg.pointer.v1','project_id':'CHATGPT_GLOBAL_SKILL_GOVERNANCE','binding_id':'CSG-QUEUE-CANARY','binding_generation':1,'checkpoint_seq':1,'checkpoint_path':'checkpoints/csg/000001.json','checkpoint_digest':cp['payload_digest'],'previous_control_oid':{'algorithm':'sha1','hex':P},'transition_id':'CSG-06A-CANARY-001','reader_compatibility':{'min_schema':'csg.checkpoint.v1','max_schema':'csg.checkpoint.v1'}}
    return ptr,cp,ev

class T(unittest.TestCase):
 def test_positive(self): self.assertEqual(validate_bundle(*fixture(),previous_seq=0,expected_parent_oid=P)['status'],'PASS')
 def test_half_object_missing_evidence_link(self):
  ptr,cp,ev=fixture(); cp['evidence_refs']=[]; cp['payload_digest']=payload_digest(cp); ptr['checkpoint_digest']=cp['payload_digest']
  with self.assertRaisesRegex(BundleError,'CHECKPOINT_EVIDENCE_LINK_MISSING'): validate_bundle(ptr,cp,ev,previous_seq=0,expected_parent_oid=P)
 def test_duplicate_seq(self):
  with self.assertRaisesRegex(BundleError,'CHECKPOINT_SEQ_NOT_MONOTONIC'): validate_bundle(*fixture(),previous_seq=1,expected_parent_oid=P)
 def test_immutable_overwrite(self):
  with self.assertRaisesRegex(BundleError,'IMMUTABLE_PATH_OVERWRITE'): validate_bundle(*fixture(),previous_seq=0,expected_parent_oid=P,existing_immutable_paths={'checkpoints/csg/000001.json'})
 def test_cycle(self):
  ptr,cp,ev=fixture(); ev['source_ancestry'].append('checkpoints/csg/000001.json'); ev['payload_digest']=payload_digest(ev); cp['evidence_refs']=[bundle_ref(EV_PATH,ev['payload_digest'])]; cp['payload_digest']=payload_digest(cp); ptr['checkpoint_digest']=cp['payload_digest']
  with self.assertRaisesRegex(BundleError,'BUNDLE_REFERENCE_CYCLE'): validate_bundle(ptr,cp,ev,previous_seq=0,expected_parent_oid=P)
 def test_future_self_commit(self):
  ptr,cp,ev=fixture(); cp['atomic']['proposal']='FUTURE_COMMIT_SHA'; cp['payload_digest']=payload_digest(cp); ptr['checkpoint_digest']=cp['payload_digest']
  with self.assertRaisesRegex(BundleError,'FUTURE_SELF_COMMIT_REFERENCE'): validate_bundle(ptr,cp,ev,previous_seq=0,expected_parent_oid=P)
 def test_parent_mismatch(self):
  with self.assertRaisesRegex(BundleError,'PARENT_OID_MISMATCH'): validate_bundle(*fixture(),previous_seq=0,expected_parent_oid='6'*40)

if __name__=='__main__': unittest.main(verbosity=2)
