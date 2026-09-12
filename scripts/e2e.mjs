import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=path.resolve('.'); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ptysd-e2e-')); const db=path.join(dir,'runtime.db');
const env={...process.env,PTYSD_DB:db};
function run(args){ const r=spawnSync(process.execPath,['src/missionctl.ts',...args],{cwd:root,env,encoding:'utf8'}); if(r.status!==0) throw new Error(`${args.join(' ')}\n${r.stderr}`); return r.stdout.trim(); }
run(['ingest','tests/envelope-e2e.json']);
run(['dispatch','B0-E2E-001','WORKER-E2E','60000']);
run(['complete','B0-E2E-001','WORKER-E2E','TEST_PASS']);
const status=JSON.parse(run(['status']));
const task=status.snapshot.tasks.find(x=>x.task_id==='B0-E2E-001');
const caps=JSON.parse(run(['capabilities']));
if(task?.state!=='COMPLETED'||task?.evidence?.[0]!=='TEST_PASS') throw new Error('E2E_TASK_NOT_COMPLETED');
if(caps.provider_write!==false||caps.production!==false||caps.business_ingress!==false||caps.active_workers_max!==1) throw new Error('E2E_CAPABILITY_GUARD_FAIL');
console.log(JSON.stringify({e2e:'PASS',task_state:task.state,state_hash:status.state_hash,capabilities:caps},null,2));
