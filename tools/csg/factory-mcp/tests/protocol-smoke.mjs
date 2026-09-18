import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, ['src/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PTYSD_FACTORY_MCP_TEST_MODE: '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
lines.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`TIMEOUT:${method}`));
    }, 5000);
    pending.set(id, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    });
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

try {
  const init = await send('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'factory-mcp-smoke', version: '1.0.0' },
  });
  assert.equal(init.error, undefined);
  notify('notifications/initialized');

  const listed = await send('tools/list', {});
  assert.equal(listed.error, undefined);
  const names = listed.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['factory_status', 'host_powershell', 'worker_prepare', 'worker_start']);

  const status = await send('tools/call', { name: 'factory_status', arguments: {} });
  assert.equal(status.error, undefined);
  const statusPayload = JSON.parse(status.result.content[0].text);
  assert.equal(statusPayload.vm_id, '881f7819-baa9-4a4e-8cca-8f6f18fb89a9');

  const op = {
    runId: 'V47-CONSTRUCTION-001',
    taskId: 'W47-06',
    attemptId: 'V47-W47-06-ATTEMPT-001',
    attemptEpoch: 1,
  };
  const prepare = await send('tools/call', { name: 'worker_prepare', arguments: op });
  assert.equal(prepare.error, undefined);
  const preparePayload = JSON.parse(prepare.result.content[0].text);
  assert.equal(preparePayload.result, 'VERIFIED');

  const start = await send('tools/call', { name: 'worker_start', arguments: op });
  assert.equal(start.error, undefined);
  const startPayload = JSON.parse(start.result.content[0].text);
  assert.equal(startPayload.result, 'STARTED');

  const powershell = await send('tools/call', {
    name: 'host_powershell',
    arguments: {
      ...op,
      script: "Write-Output 'PTYSD_HOST_POWERSHELL_TEST_OK'",
      timeoutSeconds: 30,
    },
  });
  assert.equal(powershell.error, undefined);
  assert.equal(powershell.result?.isError, undefined);
  const powershellPayload = JSON.parse(powershell.result.content[0].text);
  assert.equal(powershellPayload.result, 'COMPLETED');
  assert.equal(powershellPayload.exit_code, 0);
  assert.equal(powershellPayload.run_as, 'NT AUTHORITY\\SYSTEM');
  assert.match(powershellPayload.stdout, /PTYSD_HOST_POWERSHELL_TEST_OK/);
  assert.equal(powershellPayload.timed_out, false);

  const invalid = await send('tools/call', {
    name: 'worker_start',
    arguments: { ...op, runId: 'bad value with spaces' },
  });
  assert.ok(invalid.result?.isError || invalid.error, 'invalid input must fail closed');

  console.log('FACTORY_MCP_PROTOCOL_SMOKE=PASS');
} finally {
  child.kill();
}
