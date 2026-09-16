import copy
import hashlib
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from directory.lib.remote_wip_qualifier import RemoteWipError, classify_remote_head, qualify_provider_result, validate_artifact_record, validate_manifest

SOURCE = b'print("source")\n'
REPORT = b'{"pass":5,"fail":0}\n'

def artifact(path, payload, kind='SOURCE'):
    return {
        'path': path,
        'git_blob_sha': 'a' * 40,
        'size': len(payload),
        'sha256': hashlib.sha256(payload).hexdigest(),
        'kind': kind,
        'retention': 'GIT_OBJECT_REACHABLE_FROM_REMOTE_REF',
        'locator': {'type': 'GITHUB_REPO_PATH_AT_COMMIT'},
    }

def manifest():
    return {
        'schema': 'CSG_REMOTE_WIP_MANIFEST_V1',
        'repository_id': 1352411536,
        'repository_full_name': 'PT-Original-Point/ptysd-vnext42-governance-sandbox',
        'remote_ref': 'refs/heads/queue/csg-continuity-repair-20260916',
        'source_commit': 'b' * 40,
        'source_tree': 'c' * 40,
        'artifacts': [artifact('src.py', SOURCE), artifact('report.json', REPORT, 'RAW_TEST_REPORT')],
        'readback': {'provider':'GitHub','same_source':True,'all_required_artifacts_read':True,'observed_ref_head':'b'*40},
    }

class RemoteWipTests(unittest.TestCase):
    def test_valid_manifest_requires_source_and_raw_report(self):
        validate_manifest(manifest())

    def test_truncated_raw_blob_rejected(self):
        rec = artifact('src.py', SOURCE)
        with self.assertRaisesRegex(RemoteWipError, 'TRUNCATED_OR_SIZE_MISMATCH'):
            validate_artifact_record(rec, SOURCE[:-1])

    def test_expired_or_ephemeral_url_not_accepted_as_locator(self):
        rec = artifact('src.py', SOURCE); rec['locator'] = {'type':'TEMPORARY_SIGNED_URL','expires_at':'past'}
        with self.assertRaisesRegex(RemoteWipError, 'NON_DURABLE_OR_EXPIRED_LOCATOR'):
            validate_artifact_record(rec)

    def test_lfs_pointer_without_object_is_rejected(self):
        rec = artifact('large.bin', b'x'); rec['lfs'] = True; rec['lfs_object_available'] = False
        with self.assertRaisesRegex(RemoteWipError, 'LFS_OBJECT_MISSING'):
            validate_artifact_record(rec)

    def test_provider_success_without_readback_not_qualified(self):
        self.assertEqual(qualify_provider_result(success=True, same_source_readback=False, manifest_valid=True), 'SUCCESS_WITHOUT_READBACK_NOT_QUALIFIED')

    def test_remote_ahead_never_autoaccepts(self):
        m = manifest()
        self.assertEqual(classify_remote_head(m, 'd'*40, None), 'REMOTE_AHEAD_OR_DRIFT_REQUIRES_RECONCILIATION')
        self.assertEqual(classify_remote_head(m, m['source_commit'], None), 'DURABLE_WIP_NOT_ACCEPTED')

    def test_source_only_manifest_is_rejected(self):
        m = manifest(); m['artifacts'] = [artifact('README.md', b'readme', 'SOURCE')]
        with self.assertRaisesRegex(RemoteWipError, 'SOURCE_AND_RAW_TEST_REPORT_REQUIRED'):
            validate_manifest(m)

if __name__ == '__main__':
    unittest.main(verbosity=2)
