import {createHash} from 'node:crypto';

function canonical(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}

export function durableFingerprint(input){
  const required=['project_id','directory','control','checkpoint','run','accepted_source','mailbox','factory','runtime','supervisor_source','workspace'];
  for(const k of required){ if(!(k in input)) throw new Error('MISSING_FINGERPRINT_FIELD:'+k); }
  const payload={
    project_id:input.project_id,
    directory:input.directory,
    control:input.control,
    checkpoint:input.checkpoint,
    run:input.run,
    accepted_source:input.accepted_source,
    mailbox:input.mailbox,
    factory:input.factory,
    runtime:input.runtime,
    supervisor_source:input.supervisor_source,
    workspace:input.workspace
  };
  const text=canonical(payload);
  return {schema:'vnext5.r4.durable-fingerprint.v1',canonical:text,digest:'sha256:'+createHash('sha256').update(text).digest('hex')};
}

