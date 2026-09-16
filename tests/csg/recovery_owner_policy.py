from __future__ import annotations
from datetime import datetime, timezone

class OwnerPolicyError(ValueError):
    pass

READ_ACTIONS = {'READBACK','CLASSIFY_EFFECT','WRITE_RECOVERY_RECEIPT'}
ORDINARY_ACTIONS = {'DISPATCH','NEW_ATOMIC_UNIT','CANONICAL_ACCEPT'}

def parse_utc(v: str) -> datetime:
    if not v.endswith('Z'):
        raise OwnerPolicyError('UTC_REQUIRED')
    return datetime.fromisoformat(v[:-1] + '+00:00').astimezone(timezone.utc)

def owner_expired(owner: dict | None, provider_now: str) -> bool:
    if owner is None:
        return True
    return parse_utc(provider_now) >= parse_utc(owner['lease_until'])

def classify_receipt(*, receipt_owner_generation:int, current_owner_generation:int, receipt_attempt_epoch:int, current_attempt_epoch:int, receipt_mission_revision:str, current_mission_revision:str) -> str:
    if receipt_mission_revision != current_mission_revision:
        return 'QUARANTINE_STALE_MISSION'
    if receipt_attempt_epoch != current_attempt_epoch:
        return 'QUARANTINE_STALE_ATTEMPT'
    if receipt_owner_generation != current_owner_generation:
        return 'QUARANTINE_STALE_OWNER'
    return 'CURRENT_RECEIPT'

def resume_mode(*, owner:dict|None, provider_now:str, unresolved_effects:list, live_job:dict|None, current_attempt_epoch:int, stop_requested:bool, mission_match:bool, policy_match:bool, controller_match:bool) -> dict:
    if stop_requested:
        return {'mode':'OBSERVER_STOPPED','ordinary_writer':False}
    if not (mission_match and policy_match and controller_match):
        return {'mode':'REBASE_REQUIRED','ordinary_writer':False}
    expired = owner_expired(owner, provider_now)
    if unresolved_effects:
        return {'mode':'RECOVERY_ONLY','ordinary_writer':False,'next_owner_generation':(owner or {}).get('owner_generation',0)+1,'preserve_pending':True}
    if live_job and live_job.get('attempt_epoch') == current_attempt_epoch and live_job.get('state') in {'QUEUED','IN_PROGRESS'}:
        if expired:
            return {'mode':'ADOPT_LIVE_JOB','ordinary_writer':True,'next_owner_generation':(owner or {}).get('owner_generation',0)+1,'redispatch':False,'attempt_epoch':current_attempt_epoch}
        return {'mode':'CURRENT_OWNER_CONTINUES','ordinary_writer':True,'owner_generation':owner['owner_generation'],'redispatch':False}
    if live_job and live_job.get('attempt_epoch') == current_attempt_epoch and live_job.get('state') == 'COMPLETED':
        return {'mode':'ADOPT_COMPLETED_RESULT_READBACK','ordinary_writer':False,'redispatch':False,'attempt_epoch':current_attempt_epoch}
    if expired:
        return {'mode':'CLAIM_ORDINARY_OWNER','ordinary_writer':True,'next_owner_generation':(owner or {}).get('owner_generation',0)+1}
    return {'mode':'CURRENT_OWNER_CONTINUES','ordinary_writer':True,'owner_generation':owner['owner_generation']}

def authorize_action(mode: str, action: str) -> str:
    if mode == 'RECOVERY_ONLY':
        return 'ALLOW' if action in READ_ACTIONS else 'DENY_RECOVERY_ONLY'
    if mode in {'OBSERVER_STOPPED','REBASE_REQUIRED','ADOPT_COMPLETED_RESULT_READBACK'}:
        return 'ALLOW' if action == 'READBACK' else 'DENY_NON_WRITER_MODE'
    if mode in {'ADOPT_LIVE_JOB','CLAIM_ORDINARY_OWNER','CURRENT_OWNER_CONTINUES'}:
        return 'ALLOW'
    raise OwnerPolicyError('UNKNOWN_MODE')

def claim_tuple(*, principal_id:str, owner_generation:int, attempt_id:str, attempt_epoch:int, transport_id:str) -> dict:
    return {'principal_id':principal_id,'owner_generation':owner_generation,'attempt_id':attempt_id,'attempt_epoch':attempt_epoch,'transport_id':transport_id}
