from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

HEX40 = re.compile(r'^[0-9a-f]{40}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')

class RemoteWipError(ValueError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_artifact_record(record: dict, payload: bytes | None = None) -> None:
    required = {'path', 'git_blob_sha', 'size', 'sha256', 'kind', 'retention'}
    missing = sorted(required - set(record))
    if missing:
        raise RemoteWipError('ARTIFACT_MISSING_FIELDS:' + ','.join(missing))
    if not HEX40.match(str(record['git_blob_sha'])):
        raise RemoteWipError('GIT_BLOB_SHA_INVALID')
    if not isinstance(record['size'], int) or record['size'] < 0:
        raise RemoteWipError('ARTIFACT_SIZE_INVALID')
    if not HEX64.match(str(record['sha256'])):
        raise RemoteWipError('ARTIFACT_SHA256_INVALID')
    if record['retention'] != 'GIT_OBJECT_REACHABLE_FROM_REMOTE_REF':
        raise RemoteWipError('RETENTION_NOT_DURABLE')
    locator = record.get('locator', {})
    if locator.get('type') not in {'GITHUB_REPO_PATH_AT_COMMIT', 'GITHUB_GIT_BLOB'}:
        raise RemoteWipError('NON_DURABLE_OR_EXPIRED_LOCATOR')
    if record.get('lfs', False) and record.get('lfs_object_available') is not True:
        raise RemoteWipError('LFS_OBJECT_MISSING')
    if payload is not None:
        if len(payload) != record['size']:
            raise RemoteWipError('RAW_BLOB_TRUNCATED_OR_SIZE_MISMATCH')
        if sha256_bytes(payload) != record['sha256']:
            raise RemoteWipError('RAW_BLOB_SHA256_MISMATCH')


def validate_manifest(manifest: dict) -> None:
    required = {'schema', 'repository_id', 'repository_full_name', 'remote_ref', 'source_commit', 'source_tree', 'artifacts', 'readback'}
    missing = sorted(required - set(manifest))
    if missing:
        raise RemoteWipError('MANIFEST_MISSING_FIELDS:' + ','.join(missing))
    if manifest['schema'] != 'CSG_REMOTE_WIP_MANIFEST_V1':
        raise RemoteWipError('MANIFEST_SCHEMA_INVALID')
    if not HEX40.match(str(manifest['source_commit'])) or not HEX40.match(str(manifest['source_tree'])):
        raise RemoteWipError('SOURCE_OID_INVALID')
    if not str(manifest['remote_ref']).startswith('refs/heads/'):
        raise RemoteWipError('REMOTE_REF_INVALID')
    if not manifest['artifacts']:
        raise RemoteWipError('NO_REQUIRED_ARTIFACTS')
    kinds = {a.get('kind') for a in manifest['artifacts']}
    if 'SOURCE' not in kinds or 'RAW_TEST_REPORT' not in kinds:
        raise RemoteWipError('SOURCE_AND_RAW_TEST_REPORT_REQUIRED')
    for artifact in manifest['artifacts']:
        validate_artifact_record(artifact)
    rb = manifest['readback']
    if rb.get('provider') != 'GitHub' or rb.get('same_source') is not True or rb.get('all_required_artifacts_read') is not True:
        raise RemoteWipError('READBACK_NOT_PROVEN')
    if rb.get('observed_ref_head') != manifest['source_commit']:
        raise RemoteWipError('REF_HEAD_SOURCE_COMMIT_MISMATCH')


def classify_remote_head(manifest: dict, current_remote_head: str, accepted_head: str | None) -> str:
    if current_remote_head != manifest['source_commit']:
        return 'REMOTE_AHEAD_OR_DRIFT_REQUIRES_RECONCILIATION'
    if accepted_head is None or accepted_head != manifest['source_commit']:
        return 'DURABLE_WIP_NOT_ACCEPTED'
    return 'ACCEPTED_REMOTE_WIP'


def qualify_provider_result(*, success: bool, same_source_readback: bool, manifest_valid: bool) -> str:
    if not success:
        return 'PROVIDER_WRITE_FAILED'
    if not same_source_readback:
        return 'SUCCESS_WITHOUT_READBACK_NOT_QUALIFIED'
    if not manifest_valid:
        return 'READBACK_MANIFEST_INVALID'
    return 'QUALIFIED_DURABLE_WIP'
