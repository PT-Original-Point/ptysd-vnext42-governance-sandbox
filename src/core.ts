import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export type Envelope = {
  schema: 'PTYSD_TASK_ENVELOPE_V1'; task_id: string;
  project_id: string; interrupt_epoch: number; objective: string;
  provider_write: false; allowed_paths: string[]; evidence_required: string[];
};

type Runtime = {
  interrupt_epoch: number; stopped: boolean; pending_side_effect: string | null;
  active_task: string | null; active_worker: string | null;
  worker_lease_generation: number; worker_lease_expires_at_ms: number;
  recovery_required: boolean;
};

const stable = (v:any):any => Array.isArray(v) ? v.map(stable) :
  v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = (v:any) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const fail = (m:string):never => { throw new Error(m); };

export class Supervisor {
  db: DatabaseSync; projectId: string; clock: () => number;
  constructor(dbPath:string, projectId='CHATGPT_GLOBAL_SKILL_GOVERNANCE', clock=()=>Date.now()) {
    this.projectId=projectId; this.clock=clock; this.db=new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS runtime(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(task_id TEXT PRIMARY KEY, state TEXT NOT NULL, envelope TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);`);
    if (!this.db.prepare('SELECT 1 x FROM runtime WHERE id=1').get()) {
      const r:Runtime={interrupt_epoch:0,stopped:false,pending_side_effect:null,active_task:null,active_worker:null,worker_lease_generation:0,worker_lease_expires_at_ms:0,recovery_required:false};
      this.db.prepare('INSERT INTO runtime(id,data) VALUES(1,?)').run(JSON.stringify(r));
      this.event('INIT',{project_id:this.projectId});
    }
  }
  runtime():Runtime { return JSON.parse((this.db.prepare('SELECT data FROM runtime WHERE id=1').get() as any).data); }
  private save(r:Runtime){ this.db.prepare('UPDATE runtime SET data=? WHERE id=1').run(JSON.stringify(r)); }
  private event(kind:string, detail:any){ this.db.prepare('INSERT INTO events(ts_ms,kind,detail) VALUES(?,?,?)').run(this.clock(),kind,JSON.stringify(detail)); }
  close(){ this.db.close(); }

  validateEnvelope(e:Envelope){
    const r=this.runtime();
    if(e.schema!=='PTYSD_TASK_ENVELOPE_V1') fail('BAD_ENVELOPE_SCHEMA');
    if(e.project_id!==this.projectId) fail('PROJECT_MISMATCH');
    if(e.provider_write!==false) fail('WORKER_PROVIDER_WRITE_FORBIDDEN');
    if(!e.task_id || !e.objective || !Array.isArray(e.evidence_required) || e.evidence_required.length===0) fail('INVALID_ENVELOPE');
    if(e.interrupt_epoch!==r.interrupt_epoch) fail('STALE_INTERRUPT_EPOCH');
  }
  ingest(e:Envelope){
    this.validateEnvelope(e);
    if(this.db.prepare('SELECT 1 x FROM tasks WHERE task_id=?').get(e.task_id)) fail('TASK_ALREADY_EXISTS');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO tasks(task_id,state,envelope) VALUES(?,?,?)').run(e.task_id,'QUEUED',JSON.stringify(e));
      this.event('TASK_PERSISTED',{task_id:e.task_id,interrupt_epoch:e.interrupt_epoch});
      this.db.exec('COMMIT');
    } catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }
  setPending(operationId:string){ const r=this.runtime(); r.pending_side_effect=operationId; this.save(r); this.event('PENDING_SET',{operation_id:operationId}); }
  clearPending(operationId:string){ const r=this.runtime(); if(r.pending_side_effect!==operationId) fail('PENDING_ID_MISMATCH'); r.pending_side_effect=null; this.save(r); this.event('PENDING_CLEARED',{operation_id:operationId}); }

  dispatch(taskId:string, workerId:string, ttlMs=300000){
    const r=this.runtime();
    if(r.stopped) fail('HUMAN_STOP_ACTIVE');
    if(r.pending_side_effect) fail('PENDING_SIDE_EFFECT_BARRIER');
    if(r.active_task || r.active_worker) fail('ACTIVE_WORKER_CONFLICT');
    const row=this.db.prepare('SELECT state,envelope FROM tasks WHERE task_id=?').get(taskId) as any;
    if(!row) fail('TASK_NOT_FOUND'); if(row.state!=='QUEUED') fail('ILLEGAL_TASK_TRANSITION');
    const e=JSON.parse(row.envelope) as Envelope; if(e.interrupt_epoch!==r.interrupt_epoch) fail('STALE_INTERRUPT_EPOCH');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      r.active_task=taskId; r.active_worker=workerId; r.worker_lease_generation++; r.worker_lease_expires_at_ms=this.clock()+ttlMs; r.recovery_required=false;
      this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('RUNNING',taskId); this.save(r);
      this.event('WORKER_DISPATCHED',{task_id:taskId,worker_id:workerId,lease_generation:r.worker_lease_generation});
      this.db.exec('COMMIT');
    } catch(err){ this.db.exec('ROLLBACK'); throw err; }
  }
  heartbeat(workerId:string, ttlMs=300000){
    const r=this.runtime(); if(r.stopped) fail('HUMAN_STOP_ACTIVE'); if(r.active_worker!==workerId) fail('WORKER_NOT_OWNER');
    if(r.worker_lease_expires_at_ms<=this.clock()) fail('WORKER_LEASE_EXPIRED');
    r.worker_lease_expires_at_ms=this.clock()+ttlMs; this.save(r); this.event('WORKER_HEARTBEAT',{worker_id:workerId});
  }

  interrupt(reason='INTERRUPT'){
    const r=this.runtime();
    if(r.active_task) this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('INTERRUPTED',r.active_task);
    const old={task:r.active_task,worker:r.active_worker}; r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0; r.recovery_required=false; this.save(r);
    this.event('WORKER_INTERRUPTED',{reason,...old});
  }
  stop(){
    const r=this.runtime(); r.interrupt_epoch++;
    if(r.active_task) this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('INTERRUPTED',r.active_task);
    r.stopped=true; r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0; r.recovery_required=false; this.save(r);
    this.event('HUMAN_STOP',{interrupt_epoch:r.interrupt_epoch});
  }
  resume(){ const r=this.runtime(); r.stopped=false; this.save(r); this.event('HUMAN_RESUME',{interrupt_epoch:r.interrupt_epoch}); }
  tick(){
    const r=this.runtime();
    if(!r.stopped && r.active_worker && r.worker_lease_expires_at_ms>0 && r.worker_lease_expires_at_ms<=this.clock()){
      if(r.active_task) this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('LEASE_EXPIRED',r.active_task);
      const stale={task:r.active_task,worker:r.active_worker,generation:r.worker_lease_generation}; r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0; r.recovery_required=true; this.save(r); this.event('EXECUTOR_STALE',stale); return stale;
    }
    return null;
  }

  complete(taskId:string, workerId:string, evidence:string[]){
    const r=this.runtime(); if(r.stopped) fail('HUMAN_STOP_ACTIVE');
    if(r.active_task!==taskId || r.active_worker!==workerId) fail('WORKER_NOT_OWNER');
    if(r.worker_lease_expires_at_ms<=this.clock()) fail('WORKER_LEASE_EXPIRED');
    const row=this.db.prepare('SELECT state,envelope FROM tasks WHERE task_id=?').get(taskId) as any;
    if(!row || row.state!=='RUNNING') fail('ILLEGAL_TASK_TRANSITION');
    const e=JSON.parse(row.envelope) as Envelope;
    for(const required of e.evidence_required) if(!evidence.includes(required)) fail(`EVIDENCE_MISSING:${required}`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE tasks SET state=?,evidence=? WHERE task_id=?').run('COMPLETED',JSON.stringify([...evidence].sort()),taskId);
      r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0; r.recovery_required=false; this.save(r);
      this.event('TASK_COMPLETED',{task_id:taskId,evidence:[...evidence].sort()}); this.db.exec('COMMIT');
    } catch(err){ this.db.exec('ROLLBACK'); throw err; }
  }
  snapshot(){
    const tasks=(this.db.prepare('SELECT task_id,state,envelope,evidence FROM tasks ORDER BY task_id').all() as any[]).map(x=>({task_id:x.task_id,state:x.state,envelope:JSON.parse(x.envelope),evidence:JSON.parse(x.evidence)}));
    return {project_id:this.projectId,runtime:this.runtime(),tasks};
  }
  stateHash(){ return hash(this.snapshot()); }
  events(){ return this.db.prepare('SELECT id,ts_ms,kind,detail FROM events ORDER BY id').all(); }
  journalMode(){ return (this.db.prepare('PRAGMA journal_mode').get() as any).journal_mode; }
}

export const providerSecretKeys=(env:Record<string,string|undefined>)=>{
  const forbidden=['GITHUB_TOKEN','GH_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','OPENAI_API_KEY','ANTHROPIC_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'];
  return forbidden.filter(k=>Boolean(env[k]));
};
