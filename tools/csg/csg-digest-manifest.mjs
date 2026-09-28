import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import canonicalize from 'canonicalize';
import {parseStrictJson} from '../../scripts/csg-schema.mjs';

const JSON_PROFILE='RFC8785_JCS';
function fail(code,detail=''){
  const e=new Error(detail ? code+':'+detail : code);
  e.code=code;
  throw e;
}
function sha256(bytes){
  return 'sha256:'+createHash('sha256').update(bytes).digest('hex');
}
function normalizeRelative(input){
  if(typeof input!=='string'||input.length===0) fail('INVALID_PATH');
  const rel=input.replaceAll('\\','/');
  if(rel.startsWith('/')||/^[A-Za-z]:/.test(rel)||rel.split('/').some(s=>!s||s==='.'||s==='..')) fail('INVALID_PATH',input);
  return rel;
}
function assertInside(root,target,original){
  const rel=path.relative(root,target);
  if(!rel||rel==='.'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)) fail('INVALID_PATH',original);
}
function readExactFile(root,relative){
  const rel=normalizeRelative(relative);
  const absolute=path.resolve(root,...rel.split('/'));
  assertInside(root,absolute,rel);
  let stat;
  try{stat=lstatSync(absolute);}catch{fail('FILE_NOT_FOUND',rel);}
  if(stat.isSymbolicLink()||!stat.isFile()) fail('REGULAR_FILE_REQUIRED',rel);
  const real=realpathSync(absolute);
  assertInside(root,real,rel);
  return {path:rel,bytes:readFileSync(real)};
}
function gitObjectFormat(root){
  let value;
  try{value=execFileSync('git',['-C',root,'rev-parse','--show-object-format'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
  catch{fail('GIT_REPOSITORY_REQUIRED');}
  if(value!=='sha1'&&value!=='sha256') fail('UNSUPPORTED_GIT_OBJECT_FORMAT',value);
  return value;
}
function gitBlobOid(root,bytes,format){
  let oid;
  try{oid=execFileSync('git',['-C',root,'hash-object','--no-filters','--stdin'],{input:bytes,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
  catch{fail('GIT_BLOB_HASH_FAILED');}
  const expectedLength=format==='sha1'?40:64;
  if(!new RegExp('^[0-9a-f]{'+expectedLength+'}$').test(oid)) fail('GIT_BLOB_OID_INVALID');
  return oid;
}
function canonicalJsonBytes(bytes,relative){
  if(bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf) fail('UTF8_BOM_FORBIDDEN',relative);
  let source;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('JSON_UTF8_INVALID',relative);}
  let value;
  try{value=parseStrictJson(source);}catch(e){fail(e.code||'JSON_INVALID',relative);}
  let canonical;
  try{canonical=canonicalize(value);}catch{fail('JCS_CANONICALIZATION_FAILED',relative);}
  if(typeof canonical!=='string') fail('JCS_CANONICALIZATION_FAILED',relative);
  return Buffer.from(canonical,'utf8');
}
export function buildDigestManifest(repoRoot,relativePaths){
  if(!Array.isArray(relativePaths)||relativePaths.length===0) fail('EMPTY_PATH_SET');
  const root=realpathSync(path.resolve(repoRoot));
  const format=gitObjectFormat(root);
  const normalized=relativePaths.map(normalizeRelative);
  if(new Set(normalized).size!==normalized.length) fail('DUPLICATE_PATH');
  const entries=normalized.map(relative=>{
    const file=readExactFile(root,relative);
    const entry={
      path:file.path,
      size_bytes:file.bytes.length,
      raw_sha256:sha256(file.bytes),
      git_blob_oid:{algorithm:format,hex:gitBlobOid(root,file.bytes,format)}
    };
    if(/\.json$/i.test(file.path)){
      const canonical=canonicalJsonBytes(file.bytes,file.path);
      entry.canonical_json={
        profile:JSON_PROFILE,
        size_bytes:canonical.length,
        sha256:sha256(canonical)
      };
    }
    return entry;
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const unsigned={schema:'vnext5.r4.digest-manifest.v1',git_object_format:format,entries};
  const manifestBytes=Buffer.from(canonicalize(unsigned),'utf8');
  return {
    ...unsigned,
    manifest_digest:{profile:JSON_PROFILE,sha256:sha256(manifestBytes)}
  };
}
function main(args){
  if(args.length<3||args[0]!=='--repo-root') fail('USAGE','node tools/csg/csg-digest-manifest.mjs --repo-root <git-repo> <relative-path>...');
  const manifest=buildDigestManifest(args[1],args.slice(2));
  process.stdout.write(canonicalize(manifest)+'\n');
}
const cli=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(import.meta.url===cli){
  try{main(process.argv.slice(2));}
  catch(e){process.stderr.write('CSG_DIGEST_MANIFEST_FAIL='+(e.code||'ERROR')+'\n');process.exit(2);}
}
