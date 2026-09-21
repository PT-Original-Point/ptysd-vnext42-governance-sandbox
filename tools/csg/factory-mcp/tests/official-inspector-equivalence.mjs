import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const factoryDir = path.resolve(import.meta.dirname, '..');
const nodeBin = path.dirname(process.execPath);
const npxCli = path.join(nodeBin, 'node_modules', 'npm', 'bin', 'npx-cli.js');
const run = (args) => {
  const out = spawnSync(process.execPath, [npxCli,
    '--yes', '@modelcontextprotocol/inspector@2.7.0', '--cli',
    'node', 'src/index.mjs', '--',
    '--protocol-era', 'modern',
    '-e', 'NODE_ENV=test',
    '-e', 'PTYSD_FACTORY_MCP_TEST_MODE=1',
    ...args, '--format', 'json'
  ], {cwd: factoryDir, env: {...process.env, npm_config_yes:'true'}, encoding:'utf8', timeout:180000, maxBuffer:8*1024*1024});
  assert.equal(out.error, undefined, `spawn failed: ${out.error?.message ?? ''}`);
  assert.equal(out.signal, null, `unexpected signal: ${out.signal}`);
  return {status:out.status, stdout:out.stdout??'', stderr:out.stderr??''};
};
const parse = (out, label) => {
  try { return JSON.parse(out.stdout.trim()); }
  catch { assert.fail(`${label}: non-JSON stdout: ${out.stdout}\nstderr: ${out.stderr}`); }
};
assert.equal(fs.existsSync(npxCli), true, `npx CLI not found at ${npxCli}`);
const initRun = run(['--method','initialize']);
assert.equal(initRun.status, 0, `initialize failed\n${initRun.stdout}\n${initRun.stderr}`);
const init = parse(initRun, 'initialize').result;
assert.equal(init.protocolVersion, '2026-07-28');
assert.equal(init.serverInfo?.name, 'ptysd-factory-mcp');
assert.equal(init.serverInfo?.version, JSON.parse(fs.readFileSync(path.join(factoryDir,'package.json'),'utf8')).version);

const projections = [];
for (let i=0; i<3; i++) {
  const out = run(['--method','tools/list','--strict']);
  assert.equal(out.status, 0, `tools/list #${i+1} failed\n${out.stdout}\n${out.stderr}`);
  const tools = parse(out, `tools/list #${i+1}`).result?.tools;
  assert.ok(Array.isArray(tools));
  projections.push(tools.map(t=>({name:t.name,inputSchema:t.inputSchema})));
}
assert.deepEqual(projections[1], projections[0]);
assert.deepEqual(projections[2], projections[0]);
assert.deepEqual(projections[0].map(t=>t.name), ['factory_status','worker_prepare','worker_start','host_powershell']);
assert.equal(projections[0].length, 4);
for (const tool of projections[0].filter(t=>t.name!=='factory_status')) {
  assert.equal(tool.inputSchema?.properties?.attemptEpoch?.minimum, 1);
}
const callWorker = args => run(['--method','tools/call','--tool-name','worker_start','--tool-args-json',JSON.stringify(args)]);
for (const [label,args] of [
  ['missing identity',{}],
  ['invalid runId',{runId:'bad value with spaces',taskId:'W47-06',attemptId:'V47-W47-06-ATTEMPT-001',attemptEpoch:1}],
  ['stale epoch',{runId:'V47-CONSTRUCTION-001',taskId:'W47-06',attemptId:'V47-W47-06-ATTEMPT-001',attemptEpoch:0}],
]) {
  const out = callWorker(args);
  assert.equal(out.status, 5, `${label} must fail closed\n${out.stdout}\n${out.stderr}`);
  assert.equal(parse(out,label).result?.isError, true);
}
const valid = callWorker({runId:'V47-CONSTRUCTION-001',taskId:'W47-06',attemptId:'V47-W47-06-ATTEMPT-001',attemptEpoch:1});
assert.equal(valid.status, 0, `valid identity failed\n${valid.stdout}\n${valid.stderr}`);
const workerPayload = JSON.parse(parse(valid,'valid identity').result?.content?.[0]?.text ?? 'null');
assert.equal(workerPayload.result, 'STARTED');
assert.equal(workerPayload.attempt_epoch, 1);

const hostArgs={runId:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',taskId:'GOV-QUAL-INSPECTOR',attemptId:'GOV-P3-INSPECTOR-ATTEMPT-001',attemptEpoch:1,script:"Write-Output 'OK'",timeoutSeconds:30};
const staleHost=run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json',JSON.stringify({...hostArgs,attemptEpoch:0})]);
assert.equal(staleHost.status,5);
assert.equal(parse(staleHost,'stale host').result?.isError,true);
const host=run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json',JSON.stringify(hostArgs)]);
assert.equal(host.status,0,`host_powershell failed\n${host.stdout}\n${host.stderr}`);
const hostPayload=JSON.parse(parse(host,'host').result?.content?.[0]?.text ?? 'null');
assert.equal(hostPayload.result,'COMPLETED');
assert.equal(hostPayload.attempt_epoch,1);
assert.equal(hostPayload.run_as,'NT AUTHORITY\\SYSTEM');
assert.equal(hostPayload.project_id,'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
assert.equal(hostPayload.capability_id,'CAP-GOV-SYSTEM-V1');
console.log('FACTORY_MCP_OFFICIAL_INSPECTOR_EQUIVALENCE=PASS');
