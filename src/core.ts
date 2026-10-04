import { DatabaseSync } from 'node:sqlite';
import { createHash, verify as verifySignature, type KeyObject } from 'node:crypto';

export type Envelope = {
  schema: 'PTYSD_TASK_ENVELOPE_V1'; task_id: string;
  project_id: string; interrupt_epoch: number; objective: string;
  provider_write: false; allowed_paths: string[]; evidence_required: string[];
  attempt_id?: string; attempt_epoch?: number; owner_generation: number; provider?: string;
  owner_principal_id: string; owner_session_id: string; provider_session_id: string;
};

type RecoveryContext = {
  task_id: string; attempt_id: string; attempt_epoch: number;
  owner_generation: number; fingerprint: string; provider: string;
  owner_principal_id: string; owner_session_id: string; provider_session_id: string;
};

type Runtime = {
  interrupt_epoch: number; stopped: boolean; pending_side_effect: string | null;
  active_task: string | null; active_worker: string | null;
  worker_lease_generation: number; worker_lease_expires_at_ms: number;
  recovery_required: boolean; recovery_context: RecoveryContext | null;
};

export type RecoveryObservation = {
  observation_id: string; status: 'OBSERVED_EMPTY' | 'OBSERVED_JOB';
  project_id: string; provider: string; task_id: string; provider_job_id: string | null;
  owner_principal_id: string; owner_session_id: string; provider_session_id: string;
  attempt_id: string; attempt_epoch: number; owner_generation: number;
  fingerprint: string; observed_at: string; source: string; state: string;
  evidence_ref: string; evidence_digest: string;
  local_liveness_observation?: LocalLivenessObservation;
  reconciled_terminal?: boolean; reconciliation_ref?: string;
};

export type LocalLivenessComponent = {
  observation_id: string; provider_observation_id: string;
  project_id: string; provider: string; task_id: string;
  attempt_id: string; attempt_epoch: number; owner_generation: number;
  fingerprint: string; observed_at: string; source: string; state: string;
  owner_principal_id: string; owner_session_id: string; provider_session_id: string;
  provider_job_id?: string | null;
  supervisor_id?: string; heartbeat_id?: string; heartbeat_at_utc?: string;
  boot_identity?: string; process_identity?: string; service_identity?: string; task_identity?: string;
  heartbeat_evidence_ref?: string; heartbeat_evidence_digest?: string;
};

export type LocalLivenessObservation = {
  observation_id: string; provider_observation_id: string;
  project_id: string; provider: string; task_id: string;
  attempt_id: string; attempt_epoch: number; owner_generation: number;
  fingerprint: string; observed_at: string; source: string;
  owner_principal_id: string; owner_session_id: string; provider_session_id: string;
  evidence_ref: string; evidence_digest: string;
  components: {
    os_process: LocalLivenessComponent;
    provider_agent_session: LocalLivenessComponent;
    supervisor_heartbeat: LocalLivenessComponent;
  };
};

type RecoveryEvidencePublicKey = string | Buffer | KeyObject;
export type RecoveryEvidenceKeySet = {
  providerPublicKeys: Readonly<Record<string,RecoveryEvidencePublicKey>>;
  localPublicKeys: Readonly<Record<string,RecoveryEvidencePublicKey>>;
  supervisorHeartbeatPublicKeys: Readonly<Record<string,RecoveryEvidencePublicKey>>;
};
export type RecoveryEvidenceTrust = {
  // This reader must address the immutable evidence store selected by the trusted host composition root.
  readEvidence: (reference:string) => Uint8Array | undefined;
  // Long-lived Supervisors must resolve one fresh, internally consistent trust-root snapshot per recovery attempt.
  readCurrentTrustRoots: () => RecoveryEvidenceKeySet;
};
const MAX_RECOVERY_OBSERVATION_AGE_MS = 30_000;
const RECONCILED_TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);
const LOCAL_LIVENESS_COMPONENTS = {
  os_process: {source:'local-os-process-readback', state:'ABSENT'},
  provider_agent_session: {source:'provider-agent-session-readback', state:'TERMINAL'},
  supervisor_heartbeat: {source:'host-supervisor-heartbeat-readback', state:'EXPIRED'},
} as const;
const stable = (v:any):any => Array.isArray(v) ? v.map(stable) :
  v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = (v:any) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const canonicalJson = (v:any) => JSON.stringify(stable(v));
const fail = (m:string):never => { throw new Error(m); };
const isRecord = (v:any):v is Record<string,any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUtcTimestamp = (value:unknown) => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const isFreshUtc = (value:unknown, now:number) => {
  if (!isUtcTimestamp(value)) return false;
  const observedAt=Date.parse(value), age=now-observedAt;
  return Number.isFinite(observedAt) && age>=0 && age<=MAX_RECOVERY_OBSERVATION_AGE_MS;
};

export class Supervisor {
  db: DatabaseSync; projectId: string; clock: () => number;
  private readonly recoveryEvidenceTrust?:RecoveryEvidenceTrust;
  constructor(dbPath:string, projectId='CHATGPT_GLOBAL_SKILL_GOVERNANCE', clock=()=>Date.now(), recoveryEvidenceTrust?:RecoveryEvidenceTrust) {
    this.recoveryEvidenceTrust=recoveryEvidenceTrust;
    this.projectId=projectId; this.clock=clock; this.db=new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS runtime(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(task_id TEXT PRIMARY KEY, state TEXT NOT NULL, envelope TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_receipts(receipt_id TEXT PRIMARY KEY, resolved_at_ms INTEGER NOT NULL, detail TEXT NOT NULL);`);
    if (!this.db.prepare('SELECT 1 x FROM runtime WHERE id=1').get()) {
      const r:Runtime={interrupt_epoch:0,stopped:false,pending_side_effect:null,active_task:null,active_worker:null,worker_lease_generation:0,worker_lease_expires_at_ms:0,recovery_required:false,recovery_context:null};
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('INSERT INTO runtime(id,data) VALUES(1,?)').run(JSON.stringify(r));
        this.event('INIT',{project_id:this.projectId});
        this.db.exec('COMMIT');
      } catch(err) { this.db.exec('ROLLBACK'); throw err; }
    }
  }
  runtime():Runtime {
    const r = JSON.parse((this.db.prepare('SELECT data FROM runtime WHERE id=1').get() as any).data) as Runtime;
    if (r.recovery_context === undefined) r.recovery_context = null;
    return r;
  }
  private save(r:Runtime){ this.db.prepare('UPDATE runtime SET data=? WHERE id=1').run(JSON.stringify(r)); }
  private event(kind:string, detail:any){ this.db.prepare('INSERT INTO events(ts_ms,kind,detail) VALUES(?,?,?)').run(this.clock(),kind,JSON.stringify(detail)); }
  private executionIdentity(taskId:string, envelope:Envelope):RecoveryContext {
    const attemptId = envelope.attempt_id ?? `${taskId}:attempt:${envelope.attempt_epoch ?? envelope.interrupt_epoch}`;
    const attemptEpoch = envelope.attempt_epoch ?? envelope.interrupt_epoch;
    const provider = envelope.provider ?? 'local-supervisor';
    // Canonical owner identity comes from the validated task envelope; the
    // local worker lease counter is process-local and is tracked separately.
    const ownerGeneration = envelope.owner_generation;
    // Bind recovery to the broker's OWNER_BINDING_SHA256_V1 identity bytes.
    // For this contract owner_scope is the task id; worker/runtime envelope
    // serialization must not change the producer-consumer identity binding.
    const fingerprint = createHash('sha256').update([
      envelope.project_id, provider, taskId, attemptId, String(attemptEpoch),
      String(ownerGeneration), envelope.owner_principal_id, taskId,
    ].join('\n'), 'utf8').digest('hex');
    return {
      task_id:taskId,attempt_id:attemptId,attempt_epoch:attemptEpoch,owner_generation:ownerGeneration,
      fingerprint,provider,
      owner_principal_id:envelope.owner_principal_id,
      owner_session_id:envelope.owner_session_id,
      provider_session_id:envelope.provider_session_id,
    };
  }
  private beginInterruptedRecovery(r:Runtime) {
    if (!r.active_task || !r.active_worker) return;
    const row = this.db.prepare('SELECT envelope FROM tasks WHERE task_id=?').get(r.active_task) as any;
    if (!row) fail('ACTIVE_TASK_IDENTITY_MISSING');
    const envelope = JSON.parse(row.envelope) as Envelope;
    r.recovery_context = this.executionIdentity(r.active_task,envelope);
    r.recovery_required = true;
  }
  private validateLocalLivenessObservation(
    local:LocalLivenessObservation|undefined,
    providerObservation:RecoveryObservation,
    expected:RecoveryContext,
    now:number,
  ) {
    if (!isRecord(local)) fail('LOCAL_OWNER_LIVENESS_REQUIRED');
    if (local.provider_observation_id !== providerObservation.observation_id) fail('LOCAL_OWNER_LIVENESS_PROVIDER_OBSERVATION_MISMATCH');
    if (typeof local.observation_id !== 'string' || !local.observation_id || local.observation_id === providerObservation.observation_id ||
        local.source !== 'authorized-cross-source-liveness-readback' ||
        typeof local.evidence_ref !== 'string' || !local.evidence_ref ||
        typeof local.evidence_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(local.evidence_digest)) {
      fail('LOCAL_OWNER_LIVENESS_EVIDENCE_IDENTITY_REQUIRED');
    }
    const identity={
      project_id:this.projectId,
      provider:expected.provider,
      task_id:expected.task_id,
      attempt_id:expected.attempt_id,
      attempt_epoch:expected.attempt_epoch,
      owner_generation:expected.owner_generation,
      fingerprint:expected.fingerprint,
      owner_principal_id:expected.owner_principal_id,
      owner_session_id:expected.owner_session_id,
      provider_session_id:expected.provider_session_id,
    };
    for (const [key,value] of Object.entries(identity)) {
      if (local[key] !== value) fail('LOCAL_OWNER_LIVENESS_IDENTITY_MISMATCH');
    }
    if (!isFreshUtc(local.observed_at,now)) fail('LOCAL_OWNER_LIVENESS_STALE');
    if (!isRecord(local.components) ||
        Object.keys(local.components).sort().join(',') !== 'os_process,provider_agent_session,supervisor_heartbeat') {
      fail('LOCAL_OWNER_LIVENESS_COMPONENTS_INVALID');
    }
    const observationIds=new Set([local.observation_id,providerObservation.observation_id]);
    for (const [name,requirement] of Object.entries(LOCAL_LIVENESS_COMPONENTS)) {
      const component=local.components[name];
      if (!isRecord(component)) fail('LOCAL_OWNER_LIVENESS_COMPONENTS_INVALID');
      if (typeof component.observation_id !== 'string' || !component.observation_id || observationIds.has(component.observation_id)) fail('LOCAL_OWNER_LIVENESS_OBSERVATION_ID_REUSED');
      observationIds.add(component.observation_id);
      if (component.provider_observation_id !== providerObservation.observation_id) fail('LOCAL_OWNER_LIVENESS_PROVIDER_OBSERVATION_MISMATCH');
      for (const [key,value] of Object.entries(identity)) {
        if (component[key] !== value) fail('LOCAL_OWNER_LIVENESS_IDENTITY_MISMATCH');
      }
      if (component.source !== requirement.source) fail('LOCAL_OWNER_LIVENESS_SOURCE_MISMATCH');
      if (component.state !== requirement.state) fail('LOCAL_OWNER_LIVENESS_STATE_MISMATCH');
      if (!isFreshUtc(component.observed_at,now)) fail('LOCAL_OWNER_LIVENESS_STALE');
    }
    const providerSession=local.components.provider_agent_session;
    if (!expected.provider_session_id ||
        providerSession.provider_session_id !== expected.provider_session_id ||
        providerSession.provider_job_id !== providerObservation.provider_job_id) {
      fail('PROVIDER_SESSION_BINDING_MISMATCH');
    }
    const heartbeat=local.components.supervisor_heartbeat;
    if (typeof heartbeat.supervisor_id !== 'string' || !heartbeat.supervisor_id ||
        typeof heartbeat.heartbeat_id !== 'string' || !heartbeat.heartbeat_id ||
        !isFreshUtc(heartbeat.observed_at,now) ||
        !isFreshUtc(heartbeat.heartbeat_at_utc,now) ||
        typeof heartbeat.boot_identity !== 'string' || !heartbeat.boot_identity ||
        typeof heartbeat.process_identity !== 'string' || !heartbeat.process_identity ||
        typeof heartbeat.service_identity !== 'string' || !heartbeat.service_identity ||
        heartbeat.task_identity !== expected.task_id ||
        typeof heartbeat.heartbeat_evidence_ref !== 'string' || !heartbeat.heartbeat_evidence_ref ||
        typeof heartbeat.heartbeat_evidence_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(heartbeat.heartbeat_evidence_digest)) {
      fail('SUPERVISOR_HEARTBEAT_EVIDENCE_REQUIRED');
    }
  }
  private verifySignedRecoveryEvidence(
    reference:string,
    digest:string,
    schema:string,
    keys:Readonly<Record<string,RecoveryEvidencePublicKey>>,
    expectedPayload:Record<string,unknown>,
  ) {
    const trust=this.recoveryEvidenceTrust;
    if (!trust) fail('TRUSTED_RECOVERY_EVIDENCE_SOURCE_UNAVAILABLE');
    let raw:Uint8Array|undefined;
    try { raw=trust.readEvidence(reference); } catch { fail('RECOVERY_EVIDENCE_UNAVAILABLE'); }
    if (!(raw instanceof Uint8Array) || raw.byteLength===0 || raw.byteLength>1_048_576) fail('RECOVERY_EVIDENCE_UNAVAILABLE');
    const bytes=Buffer.from(raw);
    const actualDigest='sha256:'+createHash('sha256').update(bytes).digest('hex');
    if (actualDigest!==digest) fail('RECOVERY_EVIDENCE_DIGEST_MISMATCH');
    let record:any;
    try { record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { fail('RECOVERY_EVIDENCE_INVALID'); }
    if (!isRecord(record) ||
        Object.keys(record).sort().join(',')!=='issuer_key_id,payload,schema,signature' ||
        record.schema!==schema || typeof record.issuer_key_id!=='string' || !isRecord(record.payload) ||
        typeof record.signature!=='string') fail('RECOVERY_EVIDENCE_INVALID');
    const key=keys[record.issuer_key_id];
    if (!key) fail('RECOVERY_EVIDENCE_UNTRUSTED');
    const signature=Buffer.from(record.signature,'base64');
    if (signature.length!==64 || signature.toString('base64')!==record.signature) fail('RECOVERY_EVIDENCE_INVALID');
    const signedBody={schema:record.schema,issuer_key_id:record.issuer_key_id,payload:record.payload};
    let valid=false;
    try { valid=verifySignature(null,Buffer.from(canonicalJson(signedBody)),key,signature); } catch { valid=false; }
    if (!valid) fail('RECOVERY_EVIDENCE_UNTRUSTED');
    if (canonicalJson(record.payload)!==canonicalJson(expectedPayload)) fail('RECOVERY_EVIDENCE_PAYLOAD_MISMATCH');
  }
  private verifyRecoveryEvidence(observation:RecoveryObservation) {
    const local=observation.local_liveness_observation;
    if (!local) fail('LOCAL_OWNER_LIVENESS_REQUIRED');
    if (!this.recoveryEvidenceTrust) fail('TRUSTED_RECOVERY_EVIDENCE_SOURCE_UNAVAILABLE');
    let currentKeys:RecoveryEvidenceKeySet;
    try {
      currentKeys=this.recoveryEvidenceTrust.readCurrentTrustRoots();
    } catch {
      fail('RECOVERY_TRUST_ROOTS_UNAVAILABLE');
    }
    const {local_liveness_observation:_local,evidence_digest:_digest,...providerPayload}=observation;
    this.verifySignedRecoveryEvidence(
      observation.evidence_ref,observation.evidence_digest,'PTYSD_PROVIDER_LIVENESS_EVIDENCE_V1',
      currentKeys.providerPublicKeys,providerPayload,
    );
    const {evidence_digest:_localDigest,...localPayload}=local;
    this.verifySignedRecoveryEvidence(
      local.evidence_ref,local.evidence_digest,'PTYSD_LOCAL_LIVENESS_EVIDENCE_V1',
      currentKeys.localPublicKeys,localPayload,
    );
    const heartbeat=local.components.supervisor_heartbeat;
    const {heartbeat_evidence_ref:_heartbeatRef,heartbeat_evidence_digest:_heartbeatDigest,...heartbeatPayload}=heartbeat;
    this.verifySignedRecoveryEvidence(
      heartbeat.heartbeat_evidence_ref!,heartbeat.heartbeat_evidence_digest!,
      'PTYSD_SUPERVISOR_HEARTBEAT_EVIDENCE_V1',
      currentKeys.supervisorHeartbeatPublicKeys,heartbeatPayload,
    );
  }
  close(){ this.db.close(); }

  validateEnvelope(e:Envelope){
    const r=this.runtime();
    if(e.schema!=='PTYSD_TASK_ENVELOPE_V1') fail('BAD_ENVELOPE_SCHEMA');
    if(e.project_id!==this.projectId) fail('PROJECT_MISMATCH');
    if(e.provider_write!==false) fail('WORKER_PROVIDER_WRITE_FORBIDDEN');
    if(!e.task_id || !e.objective || !Array.isArray(e.evidence_required) || e.evidence_required.length===0) fail('INVALID_ENVELOPE');
    if(e.interrupt_epoch!==r.interrupt_epoch) fail('STALE_INTERRUPT_EPOCH');
    if(!Number.isSafeInteger(e.owner_generation) || e.owner_generation<1 || e.owner_generation>2147483647) fail('OWNER_GENERATION_REQUIRED');
    if(e.attempt_id !== undefined && !e.attempt_id) fail('INVALID_ATTEMPT_ID');
    if(e.attempt_epoch !== undefined && (!Number.isSafeInteger(e.attempt_epoch) || e.attempt_epoch < 0)) fail('INVALID_ATTEMPT_EPOCH');
    if(e.provider !== undefined && !e.provider) fail('INVALID_PROVIDER');
    for (const value of [e.owner_principal_id,e.owner_session_id,e.provider_session_id]) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail('EXACT_EXECUTION_SESSION_IDENTITY_REQUIRED');
    }
  }
  ingest(e:Envelope){
    this.validateEnvelope(e);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.db.prepare('SELECT 1 x FROM tasks WHERE task_id=?').get(e.task_id)) fail('TASK_ALREADY_EXISTS');
      this.db.prepare('INSERT INTO tasks(task_id,state,envelope) VALUES(?,?,?)').run(e.task_id,'QUEUED',JSON.stringify(e));
      this.event('TASK_PERSISTED',{task_id:e.task_id,interrupt_epoch:e.interrupt_epoch});
      this.db.exec('COMMIT');
    } catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }
  setPending(operationId:string){
    const r=this.runtime(); if(!operationId) fail('PENDING_ID_REQUIRED');
    this.db.exec('BEGIN IMMEDIATE');
    try { r.pending_side_effect=operationId; this.save(r); this.event('PENDING_SET',{operation_id:operationId}); this.db.exec('COMMIT'); }
    catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }
  clearPending(operationId:string){
    const r=this.runtime(); if(r.pending_side_effect!==operationId) fail('PENDING_ID_MISMATCH');
    this.db.exec('BEGIN IMMEDIATE');
    try { r.pending_side_effect=null; this.save(r); this.event('PENDING_CLEARED',{operation_id:operationId}); this.db.exec('COMMIT'); }
    catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }

  dispatch(taskId:string, workerId:string, ttlMs=300000){
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r=this.runtime();
      if(r.stopped) fail('HUMAN_STOP_ACTIVE');
      if(r.pending_side_effect) fail('PENDING_SIDE_EFFECT_BARRIER');
      if(r.recovery_required) fail('RECOVERY_REQUIRED');
      if(r.active_task || r.active_worker) fail('ACTIVE_WORKER_CONFLICT');
      if(!workerId || !Number.isSafeInteger(ttlMs) || ttlMs<=0) fail('INVALID_DISPATCH');
      const row=this.db.prepare('SELECT state,envelope FROM tasks WHERE task_id=?').get(taskId) as any;
      if(!row) fail('TASK_NOT_FOUND'); if(row.state!=='QUEUED') fail('ILLEGAL_TASK_TRANSITION');
      const e=JSON.parse(row.envelope) as Envelope; if(e.interrupt_epoch!==r.interrupt_epoch) fail('STALE_INTERRUPT_EPOCH');
      r.active_task=taskId; r.active_worker=workerId; r.worker_lease_generation++; r.worker_lease_expires_at_ms=this.clock()+ttlMs;
      this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('RUNNING',taskId); this.save(r);
      this.event('WORKER_DISPATCHED',{task_id:taskId,worker_id:workerId,lease_generation:r.worker_lease_generation});
      this.db.exec('COMMIT');
    } catch(err){ this.db.exec('ROLLBACK'); throw err; }
  }
  heartbeat(workerId:string, ttlMs=300000){
    const r=this.runtime(); if(r.stopped) fail('HUMAN_STOP_ACTIVE'); if(r.active_worker!==workerId) fail('WORKER_NOT_OWNER');
    if(r.recovery_required) fail('RECOVERY_REQUIRED');
    if(r.worker_lease_expires_at_ms<=this.clock()) fail('WORKER_LEASE_EXPIRED');
    this.db.exec('BEGIN IMMEDIATE');
    try { r.worker_lease_expires_at_ms=this.clock()+ttlMs; this.save(r); this.event('WORKER_HEARTBEAT',{worker_id:workerId}); this.db.exec('COMMIT'); }
    catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }

  interrupt(reason='INTERRUPT'){
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r=this.runtime();
      if(r.active_task) {
        this.beginInterruptedRecovery(r);
        this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('INTERRUPTED',r.active_task);
      }
      const old={task:r.active_task,worker:r.active_worker};
      r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0;
      this.save(r); this.event('WORKER_INTERRUPTED',{reason,...old,recovery_required:r.recovery_required});
      this.db.exec('COMMIT');
    } catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }
  stop(){
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r=this.runtime(); r.interrupt_epoch++;
      if(r.active_task) {
        this.beginInterruptedRecovery(r);
        this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('INTERRUPTED',r.active_task);
      }
      r.stopped=true; r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0;
      this.save(r); this.event('HUMAN_STOP',{interrupt_epoch:r.interrupt_epoch,recovery_required:r.recovery_required});
      this.db.exec('COMMIT');
    } catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }
  resume(){
    const r=this.runtime();
    this.db.exec('BEGIN IMMEDIATE');
    try { r.stopped=false; this.save(r); this.event('HUMAN_RESUME',{interrupt_epoch:r.interrupt_epoch,recovery_required:r.recovery_required}); this.db.exec('COMMIT'); }
    catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }
  tick(){
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r=this.runtime();
      if(!r.stopped && r.active_worker && r.worker_lease_expires_at_ms>0 && r.worker_lease_expires_at_ms<=this.clock()){
        if(!r.active_task) fail('ACTIVE_TASK_IDENTITY_MISSING');
        const row=this.db.prepare('SELECT state,envelope FROM tasks WHERE task_id=?').get(r.active_task) as any;
        if(!row || row.state!=='RUNNING') fail('ACTIVE_TASK_STATE_MISMATCH');
        const stale={task:r.active_task,worker:r.active_worker,generation:r.worker_lease_generation};
        const envelope=JSON.parse(row.envelope) as Envelope;
        r.recovery_context=this.executionIdentity(r.active_task,envelope);
        r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0; r.recovery_required=true;
        this.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('LEASE_EXPIRED',stale.task);
        this.save(r); this.event('EXECUTOR_STALE',{...stale,recovery_context:r.recovery_context});
        this.db.exec('COMMIT'); return stale;
      }
      this.db.exec('COMMIT'); return null;
    } catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }

  resolveRecovery(observation:RecoveryObservation){
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r=this.runtime();
      if(!r.recovery_required) fail('RECOVERY_NOT_REQUIRED');
      if(r.active_task || r.active_worker) fail('ACTIVE_EXECUTION_CONFLICT');
      if(r.pending_side_effect!==null) fail('PENDING_SIDE_EFFECT_BARRIER');
      const expected=r.recovery_context;
      if(!expected) fail('RECOVERY_CONTEXT_MISSING');
      if (!expected.owner_principal_id || !expected.owner_session_id || !expected.provider_session_id) fail('RECOVERY_SESSION_IDENTITY_REQUIRED');
      if(!observation || typeof observation!=='object') fail('LIVE_OBSERVATION_REQUIRED');
      if(observation.project_id!==this.projectId) fail('RECOVERY_IDENTITY_MISMATCH');
      if(observation.task_id!==expected.task_id || observation.attempt_id!==expected.attempt_id || observation.attempt_epoch!==expected.attempt_epoch || observation.owner_generation!==expected.owner_generation || observation.fingerprint!==expected.fingerprint || observation.provider!==expected.provider || observation.owner_principal_id!==expected.owner_principal_id || observation.owner_session_id!==expected.owner_session_id || observation.provider_session_id!==expected.provider_session_id) fail('RECOVERY_IDENTITY_MISMATCH');
      if(typeof observation.observation_id!=='string' || !observation.observation_id || typeof observation.source!=='string' || !observation.source || typeof observation.evidence_ref!=='string' || !observation.evidence_ref || typeof observation.evidence_digest!=='string' || !/^sha256:[0-9a-f]{64}$/.test(observation.evidence_digest)) fail('DURABLE_EVIDENCE_IDENTITY_REQUIRED');
      if(!isUtcTimestamp(observation.observed_at)) fail('UTC_REQUIRED');
      const observedAt=Date.parse(observation.observed_at);
      const now=this.clock();
      const age=now-observedAt;
      if(!Number.isFinite(observedAt) || age<0 || age>MAX_RECOVERY_OBSERVATION_AGE_MS) fail('LIVE_OBSERVATION_STALE');
      if(observation.status==='OBSERVED_EMPTY') {
        if(observation.provider_job_id!==null || observation.state!=='NONE') fail('LIVE_JOB_RECONCILIATION_REQUIRED');
      } else if(observation.status==='OBSERVED_JOB') {
        if(!observation.provider_job_id || !RECONCILED_TERMINAL_STATES.has(observation.state) || observation.reconciled_terminal!==true || !observation.reconciliation_ref) fail('LIVE_JOB_RECONCILIATION_REQUIRED');
      } else fail('INVALID_LIVE_JOB_OBSERVATION');
      this.validateLocalLivenessObservation(observation.local_liveness_observation,observation,expected,now);
      this.verifyRecoveryEvidence(observation);

      const resolvedAt=this.clock();
      const detail={result:'RESOLVED',project_id:this.projectId,recovery_context:expected,observation,evidence_ref:observation.evidence_ref,evidence_digest:observation.evidence_digest,resolved_at_ms:resolvedAt};
      const receiptId=`RECOVERY-${hash(detail)}`;
      const receipt={receipt_id:receiptId,...detail};
      this.db.prepare('INSERT INTO recovery_receipts(receipt_id,resolved_at_ms,detail) VALUES(?,?,?)').run(receiptId,resolvedAt,JSON.stringify(receipt));
      this.event('RECOVERY_RESOLVED',receipt);
      r.recovery_required=false; r.recovery_context=null; this.save(r);
      this.db.exec('COMMIT');
      return receipt;
    } catch(err) { this.db.exec('ROLLBACK'); throw err; }
  }

  complete(taskId:string, workerId:string, evidence:string[]){
    const r=this.runtime(); if(r.stopped) fail('HUMAN_STOP_ACTIVE');
    if(r.recovery_required) fail('RECOVERY_REQUIRED');
    if(r.active_task!==taskId || r.active_worker!==workerId) fail('WORKER_NOT_OWNER');
    if(r.worker_lease_expires_at_ms<=this.clock()) fail('WORKER_LEASE_EXPIRED');
    const row=this.db.prepare('SELECT state,envelope FROM tasks WHERE task_id=?').get(taskId) as any;
    if(!row || row.state!=='RUNNING') fail('ILLEGAL_TASK_TRANSITION');
    const e=JSON.parse(row.envelope) as Envelope;
    for(const required of e.evidence_required) if(!evidence.includes(required)) fail(`EVIDENCE_MISSING:${required}`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE tasks SET state=?,evidence=? WHERE task_id=?').run('COMPLETED',JSON.stringify([...evidence].sort()),taskId);
      r.active_task=null; r.active_worker=null; r.worker_lease_expires_at_ms=0; this.save(r);
      this.event('TASK_COMPLETED',{task_id:taskId,evidence:[...evidence].sort()}); this.db.exec('COMMIT');
    } catch(err){ this.db.exec('ROLLBACK'); throw err; }
  }
  snapshot(){
    const tasks=(this.db.prepare('SELECT task_id,state,envelope,evidence FROM tasks ORDER BY task_id').all() as any[]).map(x=>({task_id:x.task_id,state:x.state,envelope:JSON.parse(x.envelope),evidence:JSON.parse(x.evidence)}));
    return {project_id:this.projectId,runtime:this.runtime(),tasks};
  }
  stateHash(){ return hash(this.snapshot()); }
  events(){ return this.db.prepare('SELECT id,ts_ms,kind,detail FROM events ORDER BY id').all(); }
  recoveryReceipts(){ return this.db.prepare('SELECT receipt_id,resolved_at_ms,detail FROM recovery_receipts ORDER BY resolved_at_ms,receipt_id').all(); }
  journalMode(){ return (this.db.prepare('PRAGMA journal_mode').get() as any).journal_mode; }
}

export const providerSecretKeys=(env:Record<string,string|undefined>)=>{
  const forbidden=['GITHUB_TOKEN','GH_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','OPENAI_API_KEY','ANTHROPIC_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'];
  return forbidden.filter(k=>Boolean(env[k]));
};
