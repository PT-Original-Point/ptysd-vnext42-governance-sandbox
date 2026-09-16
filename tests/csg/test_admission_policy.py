import copy
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
import sys
sys.path.insert(0, str(ROOT))
from directory.lib.admission_policy import AdmissionError, bind, get_exact_project, new_state, normalize_name, permit_ordinary_unit, reserve, retire

CAP = json.loads((ROOT / 'directory/capabilities/governance-admission-capability.fixture.json').read_text())
ANCHOR = {
    'mission_ref': 'github://1352411536/governance/v47/current-mission.json@10474f110b5b18d7d7b52e621f05904cad5dd5f8',
    'mission_revision': '20260916T001525+0800',
    'mission_hash': 'sha256:22433b31a85a57ef0874bfa2e5d75f43aa4c5b1ffa48784bf6a7e2e0cf1c7a44',
    'policy_ref': 'github://1352411536/governance/v47/current-execution-policy.json@10474f110b5b18d7d7b52e621f05904cad5dd5f8',
    'policy_revision': '20260916T001525+0800-EP68',
    'policy_hash': 'sha256:fc905c2658719d370167e6a199c31a2562fc630a67ef150b650af320eed4929f',
    'canonical_control_ref': 'github://1352411536/refs/heads/v45/factory-control',
    'runtime_type': 'GITHUB_ACTIONS_BOUNDED',
    'controller_contract_version': 'CHAT_EXECUTION_POLICY_CONTRACT_V9_1_CANDIDATE',
}
REC = {'project_id':'CHATGPT_GLOBAL_SKILL_GOVERNANCE','project_name':'全自動軟體工廠','project_status':'RESERVED','expected_prestate':'NOT_FOUND'}

class AdmissionTests(unittest.TestCase):
    def test_reserve_then_bind_then_permit(self):
        s = new_state(); self.assertEqual(reserve(s, REC, CAP)['status'], 'RESERVED')
        self.assertEqual(permit_ordinary_unit(s, REC['project_id'])['reason'], 'PROJECT_NOT_BOUND')
        self.assertEqual(bind(s, REC['project_id'], ANCHOR, 1, CAP)['status'], 'BOUND')
        self.assertEqual(permit_ordinary_unit(s, REC['project_id'])['status'], 'PERMITTED')

    def test_reserve_is_reentrant_same_identity(self):
        s = new_state(); reserve(s, REC, CAP)
        r = reserve(s, REC, CAP)
        self.assertEqual(r['status'], 'RESERVED_IDEMPOTENT'); self.assertEqual(r['directory_revision'], 1)

    def test_two_project_ids_same_normalized_name_only_one_wins(self):
        s = new_state(); reserve(s, REC, CAP)
        other = dict(REC, project_id='OTHER')
        cap = dict(CAP, project_ids=['CHATGPT_GLOBAL_SKILL_GOVERNANCE','OTHER'])
        self.assertEqual(reserve(s, other, cap), {'status':'CAS_CONFLICT','reason':'NORMALIZED_NAME_ALREADY_BOUND'})

    def test_unicode_nfkc_casefold_collision_is_detected(self):
        self.assertEqual(normalize_name('Ａ'), normalize_name('a'))
        s = new_state(); cap = dict(CAP, project_ids=['P1','P2'])
        reserve(s, {'project_id':'P1','project_name':'Ａ','project_status':'RESERVED','expected_prestate':'NOT_FOUND'}, cap)
        r = reserve(s, {'project_id':'P2','project_name':'a','project_status':'RESERVED','expected_prestate':'NOT_FOUND'}, cap)
        self.assertEqual(r['reason'], 'NORMALIZED_NAME_ALREADY_BOUND')

    def test_wrong_project_capability_denied(self):
        s = new_state(); other = dict(REC, project_id='OTHER')
        with self.assertRaisesRegex(AdmissionError, 'PROJECT_SCOPE_NOT_AUTHORIZED'): reserve(s, other, CAP)

    def test_missing_human_gate_denied(self):
        s = new_state(); bad = dict(CAP, authorization_gate='NOPE')
        with self.assertRaisesRegex(AdmissionError, 'HUMAN_ADMISSION_GATE_REQUIRED'): reserve(s, REC, bad)

    def test_bind_requires_full_anchor(self):
        s = new_state(); reserve(s, REC, CAP)
        with self.assertRaisesRegex(AdmissionError, 'ANCHOR_MISSING_FIELDS'): bind(s, REC['project_id'], {'mission_ref':'x'}, 1, CAP)

    def test_stale_bind_revision_rejected(self):
        s = new_state(); reserve(s, REC, CAP)
        r = bind(s, REC['project_id'], ANCHOR, 9, CAP)
        self.assertEqual(r['reason'], 'DIRECTORY_REVISION_MISMATCH')

    def test_crash_between_reserve_and_bind_is_recoverable(self):
        s = new_state(); reserve(s, REC, CAP)
        self.assertEqual(reserve(s, REC, CAP)['status'], 'RESERVED_IDEMPOTENT')
        self.assertEqual(bind(s, REC['project_id'], ANCHOR, 1, CAP)['status'], 'BOUND')

    def test_bound_retry_same_anchor_is_idempotent(self):
        s = new_state(); reserve(s, REC, CAP); bind(s, REC['project_id'], ANCHOR, 1, CAP)
        r = bind(s, REC['project_id'], ANCHOR, 2, CAP)
        self.assertEqual(r['status'], 'BOUND_IDEMPOTENT'); self.assertEqual(r['directory_revision'], 2)

    def test_cross_project_exact_get_does_not_leak(self):
        s = new_state(); reserve(s, REC, CAP)
        self.assertEqual(get_exact_project(s, 'OTHER'), {'status':'NOT_FOUND','project_id':'OTHER'})

    def test_retire_requires_capability_and_revision(self):
        s = new_state(); reserve(s, REC, CAP); bind(s, REC['project_id'], ANCHOR, 1, CAP)
        self.assertEqual(retire(s, REC['project_id'], 2, CAP)['status'], 'RETIRED')
        self.assertEqual(permit_ordinary_unit(s, REC['project_id'])['reason'], 'PROJECT_NOT_BOUND')

if __name__ == '__main__': unittest.main()
