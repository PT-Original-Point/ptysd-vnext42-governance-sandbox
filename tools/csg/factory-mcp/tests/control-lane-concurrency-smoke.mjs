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
    clientInfo: { name: 'factory-mcp-multiproject-smoke', version: '1.0.0' },
  });
  assert.equal(init.error, undefined);
  notify('notifications/initialized');

  const callA = send('tools/call', {
    name: 'host_powershell',
    arguments: {
      runId: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-A',
      taskId: 'GOV-QUAL-LONG-A',
      attemptId: 'ATTEMPT-001',
      attemptEpoch: 1,
      script: "Start-Sleep -Seconds 6; Write-Output 'MULTI_A_DONE'",
      timeoutSeconds: 20,
    },
  }, 30000);

  const callB = send('tools/call', {
    name: 'host_powershell',
    arguments: {
      runId: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-B',
      taskId: 'GOV-QUAL-LONG-B',
      attemptId: 'ATTEMPT-001',
      attemptEpoch: 1,
      script: "Start-Sleep -Seconds 6; Write-Output 'MULTI_B_DONE'",
      timeoutSeconds: 20,
    },
  }, 30000);

  await new Promise((resolve) => setTimeout(resolve, 900));
  const t0 = Date.now();
  const during = await send('tools/call', { name: 'factory_status', arguments: {} }, 8000);
  const statusLatencyMs = Date.now() - t0;
  assert.equal(during.error, undefined);
  const duringPayload = textPayload(during);
  assert.ok(statusLatencyMs < 5000, `factory_status blocked for ${statusLatencyMs} ms`);
  assert.equal(duringPayload.host_exec_lane?.state, 'RUNNING');
  assert.ok(duringPayload.host_exec_lane?.active_count >= 2);
  assert.equal(duringPayload.host_exec_lane?.capacity, 4);
  const runIds = (duringPayload.host_exec_lane?.active ?? []).map((x) => x.run_id).sort();
  assert.deepEqual(runIds, ['CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-A','CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-B']);

  const [a,b] = await Promise.all([callA,callB]);
  for (const terminal of [a,b]) {
    assert.equal(terminal.error, undefined);
    assert.equal(terminal.result?.isError, undefined);
    const payload = textPayload(terminal);
    assert.equal(payload.result, 'COMPLETED');
    assert.equal(payload.exit_code, 0);
  }

  const after = await send('tools/call', { name: 'factory_status', arguments: {} }, 8000);
  const afterPayload = textPayload(after);
  const afterState = afterPayload.host_exec_lane?.state;
  assert.ok(['IDLE','IDLE_WITH_ORPHANS'].includes(afterState), `unexpected after state ${afterState}`);
  assert.equal(afterPayload.host_exec_lane?.active_count, 0);
  assert.equal(afterPayload.host_exec_lane?.effective_active_count, 0);
  if (afterState === 'IDLE_WITH_ORPHANS') {
    assert.ok(afterPayload.host_exec_lane?.orphan_count >= 1, 'orphan state must expose orphan_count');
  }

  await writeFile(outPath, `${JSON.stringify({
    result: 'PASS',
    status_latency_ms: statusLatencyMs,
    concurrent_active_count: duringPayload.host_exec_lane.active_count,
    capacity: duringPayload.host_exec_lane.capacity,
    run_ids: runIds,
    after_state: afterState,
    after_orphan_count: afterPayload.host_exec_lane?.orphan_count ?? 0,
  })}\n`, 'utf8');
} finally {
  child.kill();
}
