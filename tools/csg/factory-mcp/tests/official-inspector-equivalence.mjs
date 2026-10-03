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
    '-e', 'PTYSD_FACTORY_MCP_TEST_PROJECT_SCOPE={"schema":"v52.factory-mcp.project-scope.v1","project_id":"CHATGPT_GLOBAL_SKILL_GOVERNANCE","host_id":"TEST-HOST"}',
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
for (const tool of projections[0].filter(t=>t.name==='factory_status')) {
  assert.deepEqual(tool.inputSchema?.properties ?? {}, {});
  assert.equal(tool.inputSchema?.additionalProperties, false);
}
const hostPowerShell = projections[0].find(t=>t.name==='host_powershell');
assert.ok(hostPowerShell, 'host_powershell must remain on the public surface');
assert.deepEqual(Object.keys(hostPowerShell.inputSchema?.properties ?? {}).sort(),
  ['attemptEpoch','attemptId','runId','script','taskId','timeoutSeconds'].sort());
assert.equal(hostPowerShell.inputSchema?.properties?.attemptEpoch?.minimum, 1);
assert.equal(hostPowerShell.inputSchema?.properties?.script?.minLength, 1);
assert.equal(hostPowerShell.inputSchema?.properties?.script?.maxLength, 8192);
assert.equal(hostPowerShell.inputSchema?.properties?.timeoutSeconds?.minimum, 1);
assert.equal(hostPowerShell.inputSchema?.properties?.timeoutSeconds?.maximum, 300);
assert.equal(hostPowerShell.inputSchema?.additionalProperties, false);
for (const tool of projections[0]) {
  assert.equal(Object.hasOwn(tool.inputSchema?.properties ?? {}, 'project_id'), false);
  assert.equal(Object.hasOwn(tool.inputSchema?.properties ?? {}, 'host_id'), false);
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

const projectInjection = run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json',JSON.stringify({
  runId:'V51-R2-001', taskId:'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION',
  attemptId:'V51-R2-03-ATTEMPT-001', attemptEpoch:1,
  script:"Write-Output 'PTYSD_HOST_POWERSHELL_TEST_OK'", timeoutSeconds:30, project_id:'PROJECT_B',
})]);
assert.equal(projectInjection.status, 5, `host_powershell accepted caller-supplied Project scope\n${projectInjection.stdout}\n${projectInjection.stderr}`);
assert.equal(parse(projectInjection,'host_powershell Project injection').result?.isError, true);

const hostArgs = {
  runId:'V51-R2-001', taskId:'V51-R2-03-FIXED-READONLY-FACTORY-OBSERVATION',
  attemptId:'V51-R2-03-ATTEMPT-001', attemptEpoch:1,
  script:"Write-Output 'PTYSD_HOST_POWERSHELL_TEST_OK'", timeoutSeconds:30,
};
const hostCall = run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json',JSON.stringify(hostArgs)]);
assert.equal(hostCall.status, 0, `qualified test-mode host_powershell call failed\n${hostCall.stdout}\n${hostCall.stderr}`);
const hostResult = parse(hostCall,'host_powershell').result;
assert.equal(hostResult?.isError, undefined);
const hostPayload = JSON.parse(hostResult?.content?.[0]?.text ?? 'null');
assert.equal(hostPayload.operation, 'powershell');
assert.equal(hostPayload.run_as, 'NT AUTHORITY\\SYSTEM');
assert.equal(hostPayload.result, 'COMPLETED');
assert.equal(hostPayload.stdout_truncated, false);
assert.equal(hostPayload.stderr_truncated, false);
assert.match(hostPayload.script_sha256 ?? '', /^[0-9a-f]{64}$/);
assert.equal(hostPayload.receipt_status, 'TEST_MODE_NOT_PERSISTED');

const hostInvalid = run(['--method','tools/call','--tool-name','host_powershell','--tool-args-json',JSON.stringify({...hostArgs,timeoutSeconds:0})]);
assert.equal(hostInvalid.status, 5, `host_powershell accepted an out-of-range timeout\n${hostInvalid.stdout}\n${hostInvalid.stderr}`);
assert.equal(parse(hostInvalid,'host_powershell invalid timeout').result?.isError, true);

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
