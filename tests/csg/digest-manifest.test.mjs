import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildDigestManifest} from '../../tools/csg/csg-digest-manifest.mjs';

function withRepo(fn){
  const root=mkdtempSync(path.join(os.tmpdir(),'csg-digest-r4-'));
  try{
    execFileSync('git',['init','--quiet',root]);
    return fn(root);
  }finally{rmSync(root,{recursive:true,force:true});}
}
test('manifest separates exact-byte SHA256 and Git blob OID',()=>withRepo(root=>{
  const bytes=Buffer.from('hello\n','utf8');
  writeFileSync(path.join(root,'hello.txt'),bytes);
  const [entry]=buildDigestManifest(root,['hello.txt']).entries;
  const gitOid=execFileSync('git',['-C',root,'hash-object','--no-filters','--stdin'],{input:bytes,encoding:'utf8'}).trim();
  assert.equal(entry.raw_sha256,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(entry.git_blob_oid,{algorithm:'sha1',hex:gitOid});
  assert.notEqual(entry.raw_sha256,entry.git_blob_oid.hex);
}));
test('JSON canonical digest ignores formatting while raw and blob digests preserve CRLF bytes',()=>withRepo(root=>{
  const crlf=Buffer.from('{\r\n  "b": 2,\r\n  "a": 1\r\n}\r\n','utf8');
  const lf=Buffer.from('{"a":1,"b":2}','utf8');
  writeFileSync(path.join(root,'crlf.json'),crlf);
  writeFileSync(path.join(root,'lf.json'),lf);
  const entries=buildDigestManifest(root,['crlf.json','lf.json']).entries;
  assert.notEqual(entries[0].raw_sha256,entries[1].raw_sha256);
  assert.notEqual(entries[0].git_blob_oid.hex,entries[1].git_blob_oid.hex);
  assert.equal(entries[0].canonical_json.profile,'RFC8785_JCS');
  assert.equal(entries[0].canonical_json.sha256,entries[1].canonical_json.sha256);
}));
test('duplicate JSON keys fail closed',()=>withRepo(root=>{
  writeFileSync(path.join(root,'bad.json'),'{"x":1,"x":2}','utf8');
  assert.throws(()=>buildDigestManifest(root,['bad.json']),e=>String(e.code).startsWith('DUPLICATE_JSON_KEY'));
}));
test('path escape and duplicate input paths fail closed',()=>withRepo(root=>{
  writeFileSync(path.join(root,'a.txt'),'a','utf8');
  assert.throws(()=>buildDigestManifest(root,['../outside']),e=>e.code==='INVALID_PATH');
  assert.throws(()=>buildDigestManifest(root,['a.txt','a.txt']),e=>e.code==='DUPLICATE_PATH');
}));
test('manifest digest is stable across input order',()=>withRepo(root=>{
  mkdirSync(path.join(root,'d'));
  writeFileSync(path.join(root,'a.txt'),'a','utf8');
  writeFileSync(path.join(root,'d','b.txt'),'b','utf8');
  const a=buildDigestManifest(root,['a.txt','d/b.txt']);
  const b=buildDigestManifest(root,['d/b.txt','a.txt']);
  assert.deepEqual(a,b);
  assert.match(a.manifest_digest.sha256,/^sha256:[0-9a-f]{64}$/);
}));
