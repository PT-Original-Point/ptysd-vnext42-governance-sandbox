from __future__ import annotations

class BarrierError(ValueError): pass

def next_unit_permit(state: dict) -> dict:
    if state.get('stop_requested'):
        return {'permit':False,'reason':'STOP_REQUESTED'}
    if state.get('mission_match') is not True or state.get('policy_match') is not True or state.get('controller_match') is not True:
        return {'permit':False,'reason':'REBASE_REQUIRED'}
    if state.get('owner_mode') not in {'CLAIM_ORDINARY_OWNER','CURRENT_OWNER_CONTINUES','ADOPT_LIVE_JOB'}:
        return {'permit':False,'reason':'NO_ORDINARY_WRITER'}
    if state.get('unresolved_effects'):
        return {'permit':False,'reason':'UNRESOLVED_EFFECT'}
    if state.get('barrier') != 'CLEAN':
        return {'permit':False,'reason':'CHECKPOINT_BARRIER_NOT_CLEAN'}
    if state.get('checkpoint_readback') is not True:
        return {'permit':False,'reason':'CHECKPOINT_READBACK_REQUIRED'}
    return {'permit':True,'reason':'CLEAN'}

def begin_unit(state: dict, unit_id: str, *, checkpoint_backend_available: bool, mutation_permit: bool) -> dict:
    p=next_unit_permit(state)
    if not p['permit']: raise BarrierError('BEGIN_DENIED:'+p['reason'])
    if not checkpoint_backend_available: raise BarrierError('BEGIN_CHECKPOINT_UNAVAILABLE')
    if not mutation_permit: raise BarrierError('BEGIN_MUTATION_PERMIT_REQUIRED')
    out=dict(state); out['barrier']='ACTIVE_UNIT'; out['atomic_unit']=unit_id; out['checkpoint_readback']=True; out['last_event']='ATOMIC_STARTED'; return out

def accept_unit(state: dict, unit_id: str, *, remote_wip_verified: bool, evidence_verified: bool, effects_reconciled: bool, checkpoint_backend_available: bool) -> dict:
    if state.get('barrier')!='ACTIVE_UNIT' or state.get('atomic_unit')!=unit_id: raise BarrierError('ACCEPT_NO_MATCHING_STARTED_UNIT')
    if not (remote_wip_verified and evidence_verified and effects_reconciled): raise BarrierError('ACCEPT_EVIDENCE_INCOMPLETE')
    if not checkpoint_backend_available: raise BarrierError('ACCEPT_CHECKPOINT_UNAVAILABLE')
    out=dict(state); out['barrier']='CLEAN'; out['atomic_unit']=None; out['last_accepted']=unit_id; out['checkpoint_readback']=True; out['last_event']='ATOMIC_ACCEPTED'; return out

def recovery_permit(state:dict, action:str) -> bool:
    if action in {'READBACK','CLASSIFY_EFFECT','WRITE_RECOVERY_RECEIPT'}:
        return True
    return False
