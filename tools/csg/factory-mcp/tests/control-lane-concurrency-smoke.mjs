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
function send(method, params, timeoutMs = 20000) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`TIMEOUT:${method}`));
    }, timeoutMs);
    pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
  });
}
function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}
const textPayload = (msg) => JSON.parse(msg.result.content[0].text);

try {
  const init = await send('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'factory-mcp-control-lane-smoke', version: '1.0.0' },
  });
  assert.equal(init.error, undefined);
  notify('notifications/initialized');

  const op = {
    runId: 'FACTORY-MCP-CONTROL-LANE-20260919',
    taskId: 'LONG-EXEC-CONTROL-LANE',
    attemptId: 'ATTEMPT-001',
    attemptEpoch: 1,
  };
  const longCall = send('tools/call', {
    name: 'host_powershell',
    arguments: {
      ...op,
      script: "Start-Sleep -Seconds 6; Write-Output 'CONTROL_LANE_LONG_DONE'",
      timeoutSeconds: 20,
    },
  }, 30000);

  await new Promise((resolve) => setTimeout(resolve, 750));
  const t0 = Date.now();
  const during = await send('tools/call', { name: 'factory_status', arguments: {} }, 8000);
  const statusLatencyMs = Date.now() - t0;
  assert.equal(during.error, undefined);
  const duringPayload = textPayload(during);
  assert.ok(statusLatencyMs < 5000, `factory_status blocked for ${statusLatencyMs} ms`);
  assert.equal(duringPayload.host_exec_lane?.state, 'RUNNING');
  assert.ok(duringPayload.host_exec_lane?.request_id);

  const terminal = await longCall;
  assert.equal(terminal.error, undefined);
  assert.equal(terminal.result?.isError, undefined);
  const terminalPayload = textPayload(terminal);
  assert.equal(terminalPayload.result, 'COMPLETED');
  assert.equal(terminalPayload.exit_code, 0);
  assert.match(terminalPayload.stdout, /CONTROL_LANE_LONG_DONE/);
  assert.equal(terminalPayload.request_id, duringPayload.host_exec_lane.request_id);

  const after = await send('tools/call', { name: 'factory_status', arguments: {} }, 8000);
  const afterPayload = textPayload(after);
  assert.equal(afterPayload.host_exec_lane?.state, 'IDLE');
  assert.equal(afterPayload.host_exec_lane?.last_request_id, terminalPayload.request_id);
  assert.equal(afterPayload.host_exec_lane?.last_state, 'COMPLETED');

  await writeFile(outPath, `${JSON.stringify({
    result: 'PASS',
    status_latency_ms: statusLatencyMs,
    request_id: terminalPayload.request_id,
    during_state: duringPayload.host_exec_lane.state,
    after_state: afterPayload.host_exec_lane.state,
    after_last_state: afterPayload.host_exec_lane.last_state,
  })}\n`, 'utf8');
} finally {
  child.kill();
}
