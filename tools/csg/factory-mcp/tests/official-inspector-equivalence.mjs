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
assert.deepEqual(projections[0].map(t=>t.name).sort(), ['factory_status','host_powershell','worker_prepare','worker_start']);
assert.equal(projections[0].length, 4);
for (const tool of projections[0].filter(t=>['worker_prepare','worker_start'].includes(t.name))) {
  assert.equal(tool.inputSchema?.properties?.attemptEpoch?.minimum, 1);
}
for (const tool of projections[0].filter(t=>['factory_status','host_powershell'].includes(t.name))) {
  assert.deepEqual(tool.inputSchema?.properties ?? {}, {});
  assert.equal(tool.inputSchema?.additionalProperties, false);
}

const statusOut = run(['--method','tools/call','--tool-name','factory_status','--tool-args-json','{}']);
assert.equal(statusOut.status, 0, `fixed read-only status failed\n${statusOut.stdout}\n${statusOut.stderr}`);
const statusResult = parse(statusOut,'factory_status').result;
assert.equal(statusResult?.isError, undefined);
const statusPayload = JSON.parse(statusResult?.content?.[0]?.text ?? 'null');
assert.equal(statusPayload.schema, 'v51.factory-mcp.readonly-diagnostics.v1');
assert.equal(statusPayload.hostguard?.read_status, 'AVAILABLE');
assert.equal(statusPayload.orphans?.current_target_state, undefined);

const statusInjection = run(['--method','tools/call','--tool-name','factory_status','--tool-args-json',JSON.stringify({probe:'Get-Process'})]);
assert.equal(statusInjection.status, 5, `factory_status accepted a caller probe\n${statusInjection.stdout}\n${statusInjection.stderr}`);
assert.equal(parse(statusInjection,'factory_status injection').result?.isError, true);

const hostCall = run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json','{}']);
assert.equal(hostCall.status, 5, `fail-closed host_powershell call must be reported as a tool error\n${hostCall.stdout}\n${hostCall.stderr}`);
const hostResult = parse(hostCall,'host_powershell').result;
assert.equal(hostResult?.isError, true);
assert.match(hostResult?.content?.[0]?.text ?? '', /HOST_POWERSHELL_NOT_QUALIFIED:R1_04_R1_05_R1_06_REQUIRED/);

const hostInjection = run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json',JSON.stringify({script:'Get-Process'})]);
assert.equal(hostInjection.status, 5, `host_powershell accepted an arbitrary script\n${hostInjection.stdout}\n${hostInjection.stderr}`);
assert.equal(parse(hostInjection,'host_powershell injection').result?.isError, true);

const call = args => run(['--method','tools/call','--tool-name','worker_start','--tool-args-json',JSON.stringify(args)]);
for (const [label,args] of [
  ['missing identity',{}],
  ['invalid runId',{runId:'bad value with spaces',taskId:'W47-06',attemptId:'V47-W47-06-ATTEMPT-001',attemptEpoch:1}],
  ['stale epoch',{runId:'V47-CONSTRUCTION-001',taskId:'W47-06',attemptId:'V47-W47-06-ATTEMPT-001',attemptEpoch:0}],
]) {
  const out = call(args);
  assert.equal(out.status, 5, `${label} must fail closed\n${out.stdout}\n${out.stderr}`);
  assert.equal(parse(out,label).result?.isError, true);
}

const valid = call({runId:'V47-CONSTRUCTION-001',taskId:'W47-06',attemptId:'V47-W47-06-ATTEMPT-001',attemptEpoch:1});
assert.equal(valid.status, 0, `valid identity failed\n${valid.stdout}\n${valid.stderr}`);
const payload = JSON.parse(parse(valid,'valid identity').result?.content?.[0]?.text ?? 'null');
assert.equal(payload.result, 'STARTED');
assert.equal(payload.attempt_epoch, 1);
console.log('FACTORY_MCP_OFFICIAL_INSPECTOR_EQUIVALENCE=PASS');
