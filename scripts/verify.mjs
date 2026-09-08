import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('.'); const files=[];
function walk(p){ for(const e of fs.readdirSync(p,{withFileTypes:true})){ const q=path.join(p,e.name); if(e.isDirectory()){ if(!['node_modules','.git'].includes(e.name)) walk(q); } else files.push(q); } }
walk(root);
const textFiles=files.filter(f=>/\.(ts|js|mjs|json|md|cmd|ps1)$/i.test(f));
const secretPatterns=[/GITHUB_TOKEN\s*=/i,/OPENAI_ADMIN_KEY\s*=/i,/GOOGLE_.*CREDENTIAL\s*=/i,/CLOUDFLARE_.*TOKEN\s*=/i,/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i];
const violations=[];
for(const f of textFiles){ const s=fs.readFileSync(f,'utf8'); for(const r of secretPatterns) if(r.test(s)) violations.push(`${path.relative(root,f)}:${r}`); }
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const deps=Object.keys(pkg.dependencies||{}).length+Object.keys(pkg.devDependencies||{}).length;
const runtime=JSON.parse(fs.readFileSync(path.join(root,'config','runtime-manifest.json'),'utf8'));
const ok=deps===0&&violations.length===0&&runtime.provider_write_enabled===false&&runtime.active_workers_max===1&&runtime.worker_provider_credentials.length===0;
console.log(JSON.stringify({files:textFiles.length,dependency_count:deps,secret_scan_clean:violations.length===0,runtime_guard_pass:ok,violations},null,2));
if(!ok) process.exit(2);
