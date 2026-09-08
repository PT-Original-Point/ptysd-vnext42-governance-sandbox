import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor, providerSecretKeys, type Envelope } from '../src/core.ts';

const project='CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ptysd-b0-'));
const env=(id='T1',epoch=0):Envelope=>({schema:'PTYSD_TASK_ENVELOPE_V1',task_id:id,project_id:project,interrupt_epoch:epoch,objective:'test',provider_write:false,allowed_paths:['sandbox/**'],evidence_required:['TEST_PASS']});
const throws=(fn:()=>any,msg:string)=>assert.throws(fn,new RegExp(msg));

test('WAL + persist-before-dispatch + deterministic hash',()=>{
  const d=tmp(), db=path.join(d,'s.db'), s=new Supervisor(db); assert.equal(s.journalMode(),'wal'); s.ingest(env());
  const kinds=(s.events() as any[]).map(x=>x.kind); assert.deepEqual(kinds.slice(0,2),['INIT','TASK_PERSISTED']);
  const h1=s.stateHash(); s.close(); const r=new Supervisor(db); assert.equal(r.stateHash(),h1); r.dispatch('T1','W1',60000);
  const kinds2=(r.events() as any[]).map(x=>x.kind); assert.ok(kinds2.indexOf('TASK_PERSISTED')<kinds2.indexOf('WORKER_DISPATCHED')); r.close();
});

test('single worker + pending barrier + evidence completion',()=>{
  const s=new Supervisor(path.join(tmp(),'s.db')); s.ingest(env('A')); s.ingest(env('B'));
  s.setPending('OP-1'); throws(()=>s.dispatch('A','W1'),'PENDING_SIDE_EFFECT_BARRIER'); s.clearPending('OP-1');
  s.dispatch('A','W1',60000); throws(()=>s.dispatch('B','W2'),'ACTIVE_WORKER_CONFLICT');
  throws(()=>s.complete('A','W1',[]),'EVIDENCE_MISSING'); s.complete('A','W1',['TEST_PASS']);
  assert.equal(s.snapshot().tasks.find(x=>x.task_id==='A')?.state,'COMPLETED'); s.close();
});

test('STOP increments epoch and permanently rejects old envelope',()=>{
  const s=new Supervisor(path.join(tmp(),'s.db')); s.ingest(env('A',0)); s.dispatch('A','W1',60000); s.stop();
  assert.equal(s.runtime().interrupt_epoch,1); assert.equal(s.runtime().stopped,true); s.resume();
  throws(()=>s.ingest(env('OLD',0)),'STALE_INTERRUPT_EPOCH'); s.ingest(env('NEW',1)); s.dispatch('NEW','W2',60000); s.close();
});

test('interrupt releases worker without changing epoch',()=>{
  const s=new Supervisor(path.join(tmp(),'s.db')); s.ingest(env()); s.dispatch('T1','W1',60000); s.interrupt('TEST');
  assert.equal(s.runtime().interrupt_epoch,0); assert.equal(s.runtime().active_worker,null); assert.equal(s.snapshot().tasks[0].state,'INTERRUPTED'); s.close();
});

test('crash restart preserves lease then expiry only reduces capability',()=>{
  let t=1000; const d=tmp(), db=path.join(d,'s.db'); let s=new Supervisor(db,project,()=>t);
  s.ingest(env()); s.dispatch('T1','W1',100); const before=s.stateHash(); s.close();
  s=new Supervisor(db,project,()=>t); assert.equal(s.stateHash(),before); assert.equal(s.runtime().active_worker,'W1');
  t=1200; const stale=s.tick() as any; assert.equal(stale.worker,'W1'); assert.equal(s.runtime().active_worker,null); assert.equal(s.runtime().recovery_required,true);
  assert.equal(s.snapshot().tasks[0].state,'LEASE_EXPIRED'); s.close();
});

test('worker provider credential guard',()=>{
  assert.deepEqual(providerSecretKeys({PATH:'x'}),[]);
  assert.deepEqual(providerSecretKeys({PATH:'x',GITHUB_TOKEN:'secret'}),['GITHUB_TOKEN']);
});

test('runtime manifest disables provider write and carries no worker credentials',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'config','runtime-manifest.json'),'utf8'));
  assert.equal(manifest.provider_write_enabled,false); assert.deepEqual(manifest.worker_provider_credentials,[]); assert.equal(manifest.active_workers_max,1);
});

test('expired lease cannot be revived by heartbeat or completion',()=>{
  let t=1000; const s=new Supervisor(path.join(tmp(),'s.db'),project,()=>t); s.ingest(env()); s.dispatch('T1','W1',100); t=1101;
  throws(()=>s.heartbeat('W1',100),'WORKER_LEASE_EXPIRED'); throws(()=>s.complete('T1','W1',['TEST_PASS']),'WORKER_LEASE_EXPIRED');
  const stale=s.tick() as any; assert.equal(stale.worker,'W1'); assert.equal(s.runtime().recovery_required,true); s.close();
});
