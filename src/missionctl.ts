import fs from 'node:fs';
import path from 'node:path';
import { Supervisor, providerSecretKeys, type Envelope } from './core.ts';

const dbPath=process.env.PTYSD_DB || path.resolve('runtime.db');
const project='CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const sup=new Supervisor(dbPath,project);
const cmd=process.argv[2] || 'status';
const args=process.argv.slice(3);
try {
  if(cmd==='ingest') { const e=JSON.parse(fs.readFileSync(args[0],'utf8')) as Envelope; sup.ingest(e); }
  else if(cmd==='dispatch') sup.dispatch(args[0],args[1],Number(args[2]||300000));
  else if(cmd==='complete') sup.complete(args[0],args[1],args.slice(2));
  else if(cmd==='tick') console.log(JSON.stringify(sup.tick()));
  else if(cmd==='stop') sup.stop();
  else if(cmd==='resume') sup.resume();
  else if(cmd==='status') console.log(JSON.stringify({snapshot:sup.snapshot(),state_hash:sup.stateHash()},null,2));
  else if(cmd==='capabilities') console.log(JSON.stringify({provider_write:false,production:false,business_ingress:false,active_workers_max:1,provider_secret_keys:providerSecretKeys(process.env)},null,2));
  else throw new Error(`UNKNOWN_COMMAND:${cmd}`);
} finally { sup.close(); }
