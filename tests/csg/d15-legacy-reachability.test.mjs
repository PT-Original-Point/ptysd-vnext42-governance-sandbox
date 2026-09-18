import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repo=path.resolve(import.meta.dirname,'../..');
const roots=['scripts','tests','.github/workflows','tools','host','src','config'];
const names=[
  ['v46','bounded','driver.mjs'].join('-'),
  ['v45','state','core.mjs'].join('-'),
  ['v46','receipt','admission.mjs'].join('-'),
];
const deleted=names.map(name=>path.join(repo,'scripts',name));
const textExt=/\.(?:mjs|js|cjs|ts|tsx|py|ps1|sh|yml|yaml|json)$/i;
function walk(dir,out=[]){
  if(!fs.existsSync(dir)) return out;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(p,out);
    else if(textExt.test(entry.name)) out.push(p);
  }
  return out;
}

test('D15 retired legacy runtime files are absent and have no operational readers',()=>{
  for(const p of deleted) assert.equal(fs.existsSync(p),false,`legacy file still exists: ${path.relative(repo,p)}`);
  const hits=[];
  for(const root of roots){
    for(const file of walk(path.join(repo,root))){
      if(file===new URL(import.meta.url).pathname) continue;
      const body=fs.readFileSync(file,'utf8');
      for(const name of names) if(body.includes(name)) hits.push(`${path.relative(repo,file)} -> ${name}`);
    }
  }
  assert.deepEqual(hits,[]);
});
