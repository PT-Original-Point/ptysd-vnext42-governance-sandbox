from __future__ import annotations

class EffectPolicyError(ValueError):
    pass

def logical_identity(intent: dict) -> tuple[str,str,str]:
    return (intent['operation_id'], intent['logical_action_key'], intent['idempotency_key'])

def classify_unknown_effect(*, intent:dict, profile:dict, readback:dict, stop_requested:bool=False) -> dict:
    if readback.get('provider') != intent.get('provider') or readback.get('target') != intent.get('target'):
        return {'outcome':'PARTIAL_OR_AMBIGUOUS','next_allowed':'HUMAN_GATE','redispatch':False,'reason':'TARGET_OR_PROVIDER_MISMATCH'}
    if profile.get('query_capability') != 'EXACT_SAME_SOURCE':
        return {'outcome':'PARTIAL_OR_AMBIGUOUS','next_allowed':'HUMAN_GATE','redispatch':False,'reason':'NO_EXACT_QUERY_CAPABILITY'}
    if readback.get('auth_status') in {'FORBIDDEN','UNAUTHORIZED'}:
        return {'outcome':'PARTIAL_OR_AMBIGUOUS','next_allowed':'HUMAN_GATE','redispatch':False,'reason':'READBACK_AUTH_INCONCLUSIVE'}
    state = readback.get('state')
    if state == 'EXPECTED_POSTSTATE' and readback.get('exact_identity') is True:
        return {'outcome':'CONFIRMED','next_allowed':'CONTINUE','redispatch':False,'reason':'EXACT_POSTSTATE_READBACK'}
    if state == 'PARTIAL' or readback.get('exact_identity') is False:
        return {'outcome':'PARTIAL_OR_AMBIGUOUS','next_allowed':'WAIT','redispatch':False,'reason':'PARTIAL_OR_IDENTITY_MISMATCH'}
    if state in {'NOT_FOUND','EXPECTED_PRESTATE'}:
        proof = readback.get('negative_proof') or {}
        required = proof.get('finality') is True and proof.get('late_request_excluded') is True and proof.get('retention_valid') is True and proof.get('no_inflight_request') is True and bool(proof.get('absence_basis'))
        if not required:
            return {'outcome':'PARTIAL_OR_AMBIGUOUS','next_allowed':'WAIT','redispatch':False,'reason':'INSUFFICIENT_NEGATIVE_PROOF'}
        if intent.get('idempotency_valid') is not True or profile.get('same_key_retry_supported') is not True:
            return {'outcome':'NOT_APPLIED','next_allowed':'HUMAN_GATE','redispatch':False,'reason':'NEGATIVE_PROOF_BUT_RETRY_IDENTITY_EXPIRED'}
        return {'outcome':'NOT_APPLIED','next_allowed':'SAME_ID_RETRY','redispatch':False,'reason':'QUALIFIED_NEGATIVE_PROOF'}
    return {'outcome':'PARTIAL_OR_AMBIGUOUS','next_allowed':'WAIT','redispatch':False,'reason':'UNKNOWN_READBACK_STATE'}

def recover_unknown_effect(*args, **kwargs) -> dict:
    return classify_unknown_effect(*args, **kwargs)

def validate_handoff_identity(before:dict, after:dict) -> bool:
    return logical_identity(before) == logical_identity(after)
