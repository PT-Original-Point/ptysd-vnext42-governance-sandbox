import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const outPath = process.argv[2];
if (!outPath) throw new Error('OUTPUT_PATH_REQUIRED');

const child = spawn(process.execPath, ['src/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
lines.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    p.resolve(msg);
  }
});
let nextId = 1;
function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`TIMEOUT:${method}`)); }, 15000);
    pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
  });
}
function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}
try {
  const init = await send('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'factory-mcp-live-smoke', version: '1.0.0' },
  });
  assert.equal(init.error, undefined);
  notify('notifications/initialized');
  const listed = await send('tools/list', {});
  assert.deepEqual(listed.result.tools.map((t) => t.name).sort(), ['factory_status','host_powershell','worker_prepare','worker_start']);
  const status = await send('tools/call', { name: 'factory_status', arguments: {} });
  assert.equal(status.error, undefined);
  assert.equal(status.result.isError, undefined);
  const payload = JSON.parse(status.result.content[0].text);
  assert.equal(payload.host, 'DESKTOP-1B6PD2P');
  assert.equal(payload.vm_name, 'PTYSD-WORKER-01');
  assert.equal(payload.vm_id, '881f7819-baa9-4a4e-8cca-8f6f18fb89a9');

  const op = {
    runId: 'FACTORY-MCP-HOTFIX-20260918',
    taskId: 'HOST-POWERSHELL-LIVE-SMOKE',
    attemptId: 'ATTEMPT-001',
    attemptEpoch: 1,
  };
  const powershell = await send('tools/call', {
    name: 'host_powershell',
    arguments: {
      ...op,
      script: "Write-Output 'PTYSD_HOST_POWERSHELL_OK'",
      timeoutSeconds: 30,
    },
  });
  assert.equal(powershell.error, undefined);
  assert.equal(powershell.result?.isError, undefined);
  const psPayload = JSON.parse(powershell.result.content[0].text);
  assert.equal(psPayload.result, 'COMPLETED');
  assert.equal(psPayload.exit_code, 0);
  assert.equal(psPayload.timed_out, false);
  assert.equal(psPayload.run_as, 'NT AUTHORITY\\SYSTEM');
  assert.match(psPayload.stdout, /PTYSD_HOST_POWERSHELL_OK/);

  await writeFile(outPath, `${JSON.stringify({
    result: 'PASS',
    host: payload.host,
    vm_name: payload.vm_name,
    vm_id: payload.vm_id,
    vm_state: payload.vm_state,
    host_powershell: 'PASS',
    host_powershell_run_as: psPayload.run_as,
  })}\n`, 'utf8');
} finally {
  child.kill();
}
