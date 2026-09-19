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

test('forced-command environment expands instead of remaining literal',()=>{
  assert.ok(s.includes('CMD="${SSH_ORIGINAL_COMMAND:-${1:-}}"'));
  assert.ok(s.includes('exit "${2:-1}"'));
  assert.equal(s.includes('CMD="\\${SSH_ORIGINAL_COMMAND:-}"'),false);
});

test('controller fallback argument is bounded by the same fixed command allowlist',()=>{
  assert.ok(s.includes('CMD="${SSH_ORIGINAL_COMMAND:-${1:-}}"'));
});

test('failed builder readback exposes only the synthetic run log as base64',()=>{
  assert.ok(s.includes("RUN_LOG_BASE64="));
  assert.ok(s.includes('base64 -w0 "$LOG"'));
});

test('headless OpenCode worker fails closed instead of waiting for permission prompts',()=>{
  assert.ok(s.includes('"permission":{"*":"deny"'));
  assert.ok(s.includes('"glob":"deny"'));
  assert.ok(s.includes('"grep":"deny"'));
  assert.equal(s.includes('"*":"ask"'),false);
  assert.equal(s.includes('"glob":"ask"'),false);
  assert.equal(s.includes('"grep":"ask"'),false);
  assert.equal(s.includes('--auto'),false);
  assert.ok(s.includes('"read":{"*":"deny","fixtures/v49-live-n1/src/slugify.mjs":"allow","fixtures/v49-live-n1/test/slugify.test.mjs":"allow","fixtures/v49-live-n1/package.json":"allow"}'));
  assert.ok(s.includes('"edit":{"*":"deny","fixtures/v49-live-n1/src/slugify.mjs":"allow"}'));
});

test('builder prompt still forbids shell network subagents and external directories',()=>{
  for(const token of ['Do not use shell','network tools','subagents','external directories']) assert.ok(s.includes(token));
});


test('OpenCode free-tier repair disables internal title and automatic compaction only',()=>{
  assert.ok(s.includes('\"agent\":{\"title\":{\"disable\":true}}'));
  assert.ok(s.includes('\"compaction\":{\"auto\":false,\"prune\":false}'));
  assert.ok(s.includes('\"permission\":{\"*\":\"deny\"'));
  assert.equal(s.includes('--auto'),false);
});
