import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('.'); const files=[];
function walk(p){ for(const e of fs.readdirSync(p,{withFileTypes:true})){ const q=path.join(p,e.name); if(e.isDirectory()){ if(!['node_modules','.git'].includes(e.name)) walk(q); } else files.push(q); } }
walk(root);
const textFiles=files.filter(f=>/\.(ts|js|mjs|json|md|cmd|ps1)$/i.test(f));
const assignment=/\b(GITHUB_TOKEN|OPENAI_ADMIN_KEY|GOOGLE_[A-Z0-9_]*CREDENTIAL|CLOUDFLARE_[A-Z0-9_]*TOKEN)[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s`#;]+))/gi;
const jsonAssignment=/"(GITHUB_TOKEN|OPENAI_ADMIN_KEY|GOOGLE_[A-Z0-9_]*CREDENTIAL|CLOUDFLARE_[A-Z0-9_]*TOKEN)"\s*:\s*"([^"]*)"/gi;
const privateKey=/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i;
const safeValue=(v)=>/^(?:ABSENT|NONE|FALSE|FORBIDDEN|DISABLED|REDACTED|NOT_PRESENT(?:_|$)|0)$/i.test(String(v).trim());
const violations=[];
for(const f of textFiles){
  const s=fs.readFileSync(f,'utf8');
  for(const r of [assignment,jsonAssignment]){ r.lastIndex=0; let m; while((m=r.exec(s))!==null){ const value=m[2]??m[3]??m[4]??''; if(value && !safeValue(value)) violations.push(`${path.relative(root,f)}:${m[1]}=<non-safe-value>`); } }
  if(privateKey.test(s)) violations.push(`${path.relative(root,f)}:PRIVATE_KEY_BLOCK`);
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const deps=Object.keys(pkg.dependencies||{}).length+Object.keys(pkg.devDependencies||{}).length;
const runtime=JSON.parse(fs.readFileSync(path.join(root,'config','runtime-manifest.json'),'utf8'));
const ok=deps===0&&violations.length===0&&runtime.provider_write_enabled===false&&runtime.active_workers_max===1&&runtime.worker_provider_credentials.length===0;
console.log(JSON.stringify({files:textFiles.length,dependency_count:deps,secret_scan_clean:violations.length===0,runtime_guard_pass:ok,violations},null,2));
if(!ok) process.exit(2);
