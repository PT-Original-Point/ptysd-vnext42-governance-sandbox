import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyDirectParent,verifyPathSet,verifyRepositoryCandidate} from '../../governance/csg/trust-template/csg-trusted-verifier.mjs';
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
function repo(){const r=mkdtempSync(path.join(tmpdir(),'csg-tv-'));git(r,['init','-q']);git(r,['config','user.email','csg@test.invalid']);git(r,['config','user.name','CSG Test']);mkdirSync(path.join(r,'governance','csg'),{recursive:true});writeFileSync(path.join(r,'governance','csg','base.json'),'{}\n');git(r,['add','.']);git(r,['commit','-q','-m','base']);return r;}
function commit(r,file,body='x\n'){const p=path.join(r,...file.split('/'));mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,body);git(r,['add','.']);git(r,['commit','-q','-m',file]);return git(r,['rev-parse','HEAD']);}
const bad=(fn,code)=>assert.throws(fn,e=>String(e.code||e.message).startsWith(code));
test('01 allowed CSG path set passes',()=>assert.equal(verifyPathSet(['governance/csg/x.json','schemas/csg/a.json']).count,2));
test('02 workflow trust-root modification is blocked',()=>bad(()=>verifyPathSet(['.github/workflows/csg-trusted-verifier.yml']),'TRUST_ROOT_OR_AUTHORITY_CHANGE_FORBIDDEN'));
test('03 trusted verifier script modification is blocked',()=>bad(()=>verifyPathSet(['scripts/csg-trusted-pr-verifier.mjs']),'TRUST_ROOT_OR_AUTHORITY_CHANGE_FORBIDDEN'));
test('04 Mission change is blocked',()=>bad(()=>verifyPathSet(['governance/v47/current-mission.json'],{allowPrefixes:['governance/']}),'TRUST_ROOT_OR_AUTHORITY_CHANGE_FORBIDDEN'));
test('05 out-of-scope source path is blocked',()=>bad(()=>verifyPathSet(['src/business.js']),'OUT_OF_SCOPE_PATH'));
test('06 exact direct-child candidate passes',()=>{const r=repo();const b=git(r,['rev-parse','HEAD']);const h=commit(r,'governance/csg/x.json');assert.equal(verifyDirectParent({repo:r,baseOid:b,headOid:h}).headOid,h);});
test('07 stale base is blocked when head parent differs',()=>{const r=repo();const b=git(r,['rev-parse','HEAD']);commit(r,'governance/csg/x.json');const h=commit(r,'governance/csg/y.json');bad(()=>verifyDirectParent({repo:r,baseOid:b,headOid:h}),'DIRECT_PARENT_MISMATCH');});
test('08 merge/multiple-parent commit is blocked',()=>{const r=repo();const b=git(r,['rev-parse','HEAD']);git(r,['checkout','-q','-b','a']);commit(r,'governance/csg/a.json');git(r,['checkout','-q','-b','b',b]);commit(r,'governance/csg/b.json');git(r,['merge','-q','--no-ff','a','-m','merge']);const h=git(r,['rev-parse','HEAD']);bad(()=>verifyDirectParent({repo:r,baseOid:b,headOid:h}),'HEAD_MUST_HAVE_EXACTLY_ONE_PARENT');});
test('09 dirty worktree is blocked',()=>{const r=repo();const b=git(r,['rev-parse','HEAD']);const h=commit(r,'governance/csg/x.json');writeFileSync(path.join(r,'governance','csg','x.json'),'dirty\n');bad(()=>verifyRepositoryCandidate({repo:r,baseOid:b,headOid:h}),'WORKTREE_NOT_CLEAN');});
test('10 clean exact candidate passes repository gate',()=>{const r=repo();const b=git(r,['rev-parse','HEAD']);const h=commit(r,'tests/csg/new.test.mjs');assert.equal(verifyRepositoryCandidate({repo:r,baseOid:b,headOid:h}).worktreeClean,true);});
