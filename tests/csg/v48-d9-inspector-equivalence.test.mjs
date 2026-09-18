import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const factoryDir = path.resolve(here, '../../tools/csg/factory-mcp');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const expectedTools = ['factory_status', 'worker_prepare', 'worker_start'];

function run(command, args, options = {}) {
  const out = spawnSync(command, args, {
    cwd: options.cwd ?? factoryDir,
    env: { ...process.env, npm_config_yes: 'true' },
    encoding: 'utf8',
    timeout: options.timeout ?? 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: out.status, signal: out.signal, stdout: out.stdout ?? '', stderr: out.stderr ?? '', error: out.error };
}

function inspector(methodArgs) {
  return run(npx, [
    '--yes', '@modelcontextprotocol/inspector@2.7.0', '--cli',
    '--protocol-era', 'modern',
    '-e', 'NODE_ENV=test',
    '-e', 'PTYSD_FACTORY_MCP_TEST_MODE=1',
    'node', 'src/index.mjs',
    ...methodArgs,
    '--format', 'json',
  ]);
}

function parseJson(out, label) {
  assert.equal(out.error, undefined, `${label}: spawn error ${out.error?.message ?? ''}`);
  assert.equal(out.signal, null, `${label}: unexpected signal ${out.signal}`);
  try { return JSON.parse(out.stdout.trim()); }
  catch { assert.fail(`${label}: non-JSON stdout: ${out.stdout}\nstderr: ${out.stderr}`); }
}

function toolProjection(payload) {
  const tools = payload.result?.tools;
  assert.ok(Array.isArray(tools), 'tools/list must return an array');
  return tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }));
}

test('V48-D9 official Inspector modern stdio equivalence matrix', { timeout: 600000 }, () => {
  const install = run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 240000 });
  assert.equal(install.error, undefined, `npm ci spawn failed: ${install.error?.message ?? ''}`);
  assert.equal(install.status, 0, `npm ci failed\nstdout: ${install.stdout}\nstderr: ${install.stderr}`);

  const initRun = inspector(['--method', 'initialize']);
  assert.equal(initRun.status, 0, `Inspector initialize failed\nstdout: ${initRun.stdout}\nstderr: ${initRun.stderr}`);
  const init = parseJson(initRun, 'initialize').result;
  assert.equal(init.protocolVersion, '2026-07-28');
  assert.equal(init.serverInfo?.name, 'ptysd-factory-mcp');
  assert.equal(init.serverInfo?.version, '0.1.0');

  const projections = [];
  for (let i = 0; i < 3; i++) {
    const listRun = inspector(['--method', 'tools/list', '--strict']);
    assert.equal(listRun.status, 0, `Inspector tools/list #${i + 1} failed\nstdout: ${listRun.stdout}\nstderr: ${listRun.stderr}`);
    projections.push(toolProjection(parseJson(listRun, `tools/list #${i + 1}`)));
  }
  assert.deepEqual(projections[1], projections[0]);
  assert.deepEqual(projections[2], projections[0]);
  assert.deepEqual(projections[0].map((tool) => tool.name), expectedTools);
  assert.equal(projections[0].length, 3);
  for (const tool of projections[0].filter((x) => x.name !== 'factory_status')) {
    assert.equal(tool.inputSchema?.properties?.attemptEpoch?.minimum, 1, `${tool.name} attemptEpoch minimum must be 1`);
  }

  const call = (args) => inspector([
    '--method', 'tools/call',
    '--tool-name', 'worker_start',
    '--tool-args-json', JSON.stringify(args),
  ]);
  for (const [label, args] of [
    ['missing identity', {}],
    ['invalid runId', { runId: 'bad value with spaces', taskId: 'W47-06', attemptId: 'V47-W47-06-ATTEMPT-001', attemptEpoch: 1 }],
    ['stale epoch', { runId: 'V47-CONSTRUCTION-001', taskId: 'W47-06', attemptId: 'V47-W47-06-ATTEMPT-001', attemptEpoch: 0 }],
  ]) {
    const rejected = call(args);
    assert.equal(rejected.status, 5, `${label} must be a tool error\nstdout: ${rejected.stdout}\nstderr: ${rejected.stderr}`);
    assert.equal(parseJson(rejected, label).result?.isError, true, `${label} must fail closed`);
  }
  const valid = call({ runId: 'V47-CONSTRUCTION-001', taskId: 'W47-06', attemptId: 'V47-W47-06-ATTEMPT-001', attemptEpoch: 1 });
  assert.equal(valid.status, 0, `exact application identity should pass in TEST_MODE\nstdout: ${valid.stdout}\nstderr: ${valid.stderr}`);
  const validPayload = JSON.parse(parseJson(valid, 'valid identity').result?.content?.[0]?.text ?? 'null');
  assert.equal(validPayload.result, 'STARTED');
  assert.equal(validPayload.attempt_epoch, 1);
});
