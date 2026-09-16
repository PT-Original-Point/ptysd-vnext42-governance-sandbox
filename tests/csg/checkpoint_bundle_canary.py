from __future__ import annotations

import hashlib, json, re

DIGEST_RE = re.compile(r'^sha256:[0-9a-f]{64}$')
OID_RE = re.compile(r'^[0-9a-f]{40}$')

class BundleError(ValueError):
    pass

def _walk_jcs_subset(v):
    if isinstance(v, float):
        raise BundleError('JCS_SUBSET_FLOAT_FORBIDDEN')
    if isinstance(v, str) and any(ord(ch) > 0x7f for ch in v):
        raise BundleError('JCS_SUBSET_NONASCII_FORBIDDEN')
    if isinstance(v, list):
        for x in v: _walk_jcs_subset(x)
    elif isinstance(v, dict):
        for k, x in v.items():
            if any(ord(ch) > 0x7f for ch in k): raise BundleError('JCS_SUBSET_NONASCII_KEY_FORBIDDEN')
            _walk_jcs_subset(x)

def canonical_payload_bytes(v: dict) -> bytes:
    c = json.loads(json.dumps(v))
    c.pop('payload_digest', None)
    _walk_jcs_subset(c)
    return json.dumps(c, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')

def payload_digest(v: dict) -> str:
    return 'sha256:' + hashlib.sha256(canonical_payload_bytes(v)).hexdigest()

def assert_payload_digest(v: dict):
    if not DIGEST_RE.match(str(v.get('payload_digest'))): raise BundleError('INVALID_PAYLOAD_DIGEST')
    if payload_digest(v) != v['payload_digest']: raise BundleError('PAYLOAD_DIGEST_MISMATCH')

def bundle_ref(path: str, digest: str) -> dict:
    return {'kind':'BUNDLE_OBJECT','path':path,'digest':digest}

def validate_bundle(pointer: dict, checkpoint: dict, evidence: dict, *, previous_seq: int, expected_parent_oid: str, existing_immutable_paths=()):
    if checkpoint.get('schema_version') != 'csg.checkpoint.v1': raise BundleError('CHECKPOINT_SCHEMA_INVALID')
    if evidence.get('schema_version') != 'csg.evidence.v1': raise BundleError('EVIDENCE_SCHEMA_INVALID')
    if pointer.get('schema_version') != 'csg.pointer.v1': raise BundleError('POINTER_SCHEMA_INVALID')
    assert_payload_digest(evidence); assert_payload_digest(checkpoint)
    seq = checkpoint.get('checkpoint_seq')
    if seq != previous_seq + 1: raise BundleError('CHECKPOINT_SEQ_NOT_MONOTONIC')
    if pointer.get('checkpoint_seq') != seq: raise BundleError('POINTER_CHECKPOINT_SEQ_MISMATCH')
    if pointer.get('checkpoint_path') != f'checkpoints/csg/{seq:06d}.json': raise BundleError('CHECKPOINT_PATH_MISMATCH')
    if pointer.get('checkpoint_digest') != checkpoint['payload_digest']: raise BundleError('POINTER_CHECKPOINT_DIGEST_MISMATCH')
    prev = pointer.get('previous_control_oid', {})
    if prev.get('algorithm') != 'sha1' or prev.get('hex') != expected_parent_oid or not OID_RE.match(str(prev.get('hex'))): raise BundleError('PARENT_OID_MISMATCH')
    cp_path = pointer['checkpoint_path']; ev_path = f'evidence/csg/csg-06a-{seq:06d}.json'
    if cp_path in existing_immutable_paths or ev_path in existing_immutable_paths: raise BundleError('IMMUTABLE_PATH_OVERWRITE')
    refs = checkpoint.get('evidence_refs', [])
    wanted = bundle_ref(ev_path, evidence['payload_digest'])
    if wanted not in refs: raise BundleError('CHECKPOINT_EVIDENCE_LINK_MISSING')
    text = json.dumps(evidence, sort_keys=True, separators=(',', ':'))
    if cp_path in text or 'continuity/current.json' in text: raise BundleError('BUNDLE_REFERENCE_CYCLE')
    for obj in (checkpoint, evidence, pointer):
        text = json.dumps(obj, sort_keys=True, separators=(',', ':'))
        if 'FUTURE_COMMIT_SHA' in text or 'SELF_COMMIT_SHA' in text: raise BundleError('FUTURE_SELF_COMMIT_REFERENCE')
    return {'status':'PASS','checkpoint_path':cp_path,'evidence_path':ev_path,'checkpoint_digest':checkpoint['payload_digest'],'evidence_digest':evidence['payload_digest']}
