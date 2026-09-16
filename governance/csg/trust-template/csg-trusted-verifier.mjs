import {execFileSync} from 'node:child_process';
import path from 'node:path';

const OID=/^[0-9a-f]{40}$/;
const HARD_FORBIDDEN=[
  '.github/workflows/csg-trusted-verifier.yml',
  'scripts/csg-trusted-pr-verifier.mjs',
  'governance/csg/trust/',
  'governance/v47/current-mission.json',
  'governance/v47/current-execution-policy.json'
];
const ALLOWED_PREFIXES=['governance/csg/','schemas/csg/','scripts/csg-','tests/csg/','tools/csg/'];
function fail(code,detail=''){const e=new Error(detail?`${code}:${detail}`:code);e.code=code;throw e;}
function oid(v,name){if(typeof v!=='string'||!OID.test(v))fail(`INVALID_${name}`);return v;}
function git(cwd,args){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function clean(p){return p.replaceAll('\\','/');}
export function verifyPathSet(paths,{allowPrefixes=ALLOWED_PREFIXES}={}){
  if(!Array.isArray(paths)||paths.length<1)fail('EMPTY_CHANGESET');
  for(const raw of paths){const p=clean(raw);if(!p||p.startsWith('/')||p.split('/').some(x=>x==='..'))fail('INVALID_PATH',p);
    for(const f of HARD_FORBIDDEN)if(p===f||f.endsWith('/')&&p.startsWith(f))fail('TRUST_ROOT_OR_AUTHORITY_CHANGE_FORBIDDEN',p);
    if(!allowPrefixes.some(prefix=>p.startsWith(prefix)))fail('OUT_OF_SCOPE_PATH',p);
  }
  return {paths:[...paths].map(clean).sort(),count:paths.length};
}
export function verifyDirectParent({repo,baseOid,headOid}){
  oid(baseOid,'BASE_OID');oid(headOid,'HEAD_OID');
  const line=git(repo,['rev-list','--parents','-n','1',headOid]).split(/\s+/);
  if(line.length!==2)fail('HEAD_MUST_HAVE_EXACTLY_ONE_PARENT');
  if(line[0]!==headOid||line[1]!==baseOid)fail('DIRECT_PARENT_MISMATCH');
  const names=git(repo,['diff','--name-only','--no-renames',`${baseOid}..${headOid}`]).split(/\r?\n/).filter(Boolean);
  return {...verifyPathSet(names),baseOid,headOid};
}
export function verifyRepositoryCandidate({repo,baseOid,headOid}){
  const direct=verifyDirectParent({repo,baseOid,headOid});
  const status=git(repo,['status','--porcelain']);
  if(status)fail('WORKTREE_NOT_CLEAN');
  return {...direct,worktreeClean:true};
}
if(import.meta.url===`file://${process.argv[1]?.replaceAll('\\','/')}`){
  const [repo,baseOid,headOid]=process.argv.slice(2);
  try{const out=verifyRepositoryCandidate({repo:path.resolve(repo),baseOid,headOid});process.stdout.write(JSON.stringify({result:'PASS',...out})+'\n');}
  catch(e){process.stderr.write(JSON.stringify({result:'FAIL',code:e.code||'ERROR',message:e.message})+'\n');process.exit(2);}
}
