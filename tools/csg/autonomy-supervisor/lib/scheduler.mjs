export const UNIT_STATES = Object.freeze([
  'READY','RUNNING','WAITING_EXTERNAL','WAITING_HUMAN','DONE','FAILED_RETRYABLE','FAILED_TERMINAL'
]);

function normPriority(v){
  const n=Number(v);
  return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;
}

export function selectNextUnit(units){
  if(!Array.isArray(units)) throw new TypeError('units must be an array');
  for(const u of units){
    if(!u || typeof u.id!=='string' || !UNIT_STATES.includes(u.state)) throw new Error('INVALID_UNIT');
  }
  const running=units.filter(u=>u.state==='RUNNING');
  if(running.length>1) return {decision:'INVARIANT_VIOLATION',reason:'MULTIPLE_RUNNING_UNITS',units:running.map(x=>x.id)};
  if(running.length===1) return {decision:'KEEP_RUNNING',unit:running[0].id};

  const ready=units.filter(u=>u.state==='READY').sort((a,b)=>normPriority(a.priority)-normPriority(b.priority)||a.id.localeCompare(b.id));
  if(ready.length) return {decision:'DISPATCH',unit:ready[0].id};

  const retryable=units.filter(u=>u.state==='FAILED_RETRYABLE' && u.retry_allowed===true).sort((a,b)=>normPriority(a.priority)-normPriority(b.priority)||a.id.localeCompare(b.id));
  if(retryable.length) return {decision:'RETRY_BOUNDED',unit:retryable[0].id};

  const remaining=units.filter(u=>u.state!=='DONE');
  if(remaining.length===0) return {decision:'ALL_DONE'};

  const human=remaining.filter(u=>u.state==='WAITING_HUMAN');
  const external=remaining.filter(u=>u.state==='WAITING_EXTERNAL');
  const terminal=remaining.filter(u=>u.state==='FAILED_TERMINAL');
  const exhausted=remaining.filter(u=>u.state==='FAILED_RETRYABLE' && u.retry_allowed!==true);

  if(human.length===remaining.length) return {decision:'WAITING_HUMAN',units:human.map(x=>x.id)};
  if(external.length===remaining.length) return {decision:'WAITING_EXTERNAL_NO_READY',units:external.map(x=>x.id)};
  if(terminal.length+exhausted.length===remaining.length) return {decision:'FAILED_NO_LEGAL_ACTION',units:remaining.map(x=>x.id)};

  return {decision:'NO_LEGAL_ACTION_MIXED',units:remaining.map(x=>x.id)};
}

export function goalMayBeBlocked(units){
  const next=selectNextUnit(units);
  return ['WAITING_HUMAN','WAITING_EXTERNAL_NO_READY','FAILED_NO_LEGAL_ACTION','NO_LEGAL_ACTION_MIXED'].includes(next.decision);
}

