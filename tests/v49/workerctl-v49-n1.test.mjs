import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const p=new URL('../../scripts/ptysd-workerctl-v49-n1.sh',import.meta.url);
const s=fs.readFileSync(p,'utf8');
const nonblank=s.split(/\r?\n/).filter(x=>x.trim()).length;

test('workerctl replacement stays inside delete-first runtime budget',()=>{
  assert.ok(nonblank<=128,`workerctl nonblank LOC ${nonblank} exceeds 128`);
});

test('workerctl is pinned to exact accepted canary and zero-cost model',()=>{
  for(const token of [
    '141baaebb30e4e4b43a3237b8e352822bbd54b10',
    'de291ba0d7d6c6d09357471bd18653b0747a2a8a',
    'opencode/muse-spark-1.3-contributor-free',
    'fixtures/v49-live-n1/src/slugify.mjs',
    'fixtures/v49-live-n1/test/slugify.test.mjs',
    'ZERO_COST_GUARD=PASS',
    'OBSERVED_RUN_COST=',
  ]) assert.ok(s.includes(token),`missing pin ${token}`);
});

test('restricted command surface is exact and has no arbitrary exec or privileged mutation',()=>{
  for(const cmd of ['probe)','v49-n1-preflight)','v49-n1-build)','v49-n1-readback)','v49-n1-clean)']) assert.ok(s.includes(cmd),`missing command ${cmd}`);
  for(const forbidden of ['eval ','sudo ','curl ','wget ','GITHUB_TOKEN','GH_TOKEN','OPENAI_ADMIN_KEY','CLOUDFLARE_API_TOKEN']) assert.equal(s.includes(forbidden),false,`forbidden surface: ${forbidden}`);
});

test('real builder cannot modify protected verifier or extra repo files',()=>{
  assert.ok(s.includes('TEST_CHANGED'));
  assert.ok(s.includes('PACKAGE_CHANGED'));
  assert.ok(s.includes('WORKSPACE_SCOPE_CHANGED'));
  assert.ok(s.includes('git" status --porcelain')||s.includes('"$GIT" status --porcelain'));
});

test('unknown forced command fails closed before runtime/model activity',()=>{
  const i=s.indexOf('case "$CMD" in'), d=s.lastIndexOf("*) echo 'COMMAND_NOT_ALLOWED'");
  assert.ok(i>=0&&d>i);
});
