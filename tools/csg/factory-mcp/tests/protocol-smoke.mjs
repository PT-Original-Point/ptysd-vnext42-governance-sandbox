import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tools = ['factory_status', 'worker_prepare', 'worker_start'];
const op = {
  runId: 'V47-CONSTRUCTION-001', taskId: 'W47-06',
  attemptId: 'V47-W47-06-ATTEMPT-001', attemptEpoch: 1,
};
const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'factory-mcp-smoke', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function openClient() {
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', PTYSD_FACTORY_MCP_TEST_MODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  return {
    send(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`TIMEOUT:${method}`)); }, 5000);
        pending.set(id, (msg) => { clearTimeout(timer); pending.delete(id); resolve(msg); });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    close() { child.kill(); },
  };
}

function result(msg) {
  assert.equal(msg.error, undefined);
  return msg.result;
}

async function session(run) {
  const client = openClient();
  try { await run(client); } finally { client.close(); }
}

await session(async ({ send, notify }) => {
  const init = result(await send('initialize', {
    protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'factory-mcp-smoke', version: '1.0.0' },
  }));
  assert.equal(init.serverInfo?.version, packageMetadata.version);
  notify('notifications/initialized');
  const listed = result(await send('tools/list', {}));
  assert.deepEqual(listed.tools.map((t) => t.name).sort(), tools);
  const status = result(await send('tools/call', { name: 'factory_status', arguments: {} }));
  assert.equal(JSON.parse(status.content[0].text).vm_id, '881f7819-baa9-4a4e-8cca-8f6f18fb89a9');
  assert.equal(JSON.parse(result(await send('tools/call', { name: 'worker_prepare', arguments: op })).content[0].text).result, 'VERIFIED');
  assert.equal(JSON.parse(result(await send('tools/call', { name: 'worker_start', arguments: op })).content[0].text).result, 'STARTED');
  const invalid = await send('tools/call', { name: 'worker_start', arguments: { ...op, runId: 'bad value with spaces' } });
  assert.ok(invalid.result?.isError || invalid.error, 'invalid input must fail closed');
  const stale = await send('tools/call', { name: 'worker_start', arguments: { ...op, attemptEpoch: 0 } });
  assert.ok(stale.result?.isError || stale.error, 'attemptEpoch=0 must fail closed');
});

await session(async ({ send }) => {
  const discover = result(await send('server/discover', { _meta: modernMeta }));
  assert.ok(discover.supportedVersions.includes('2026-07-28'));
  assert.equal(discover._meta?.['io.modelcontextprotocol/serverInfo']?.version, packageMetadata.version);
  const snapshots = [];
  for (let i = 0; i < 3; i++) snapshots.push(result(await send('tools/list', { _meta: modernMeta })).tools.map((t) => t.name));
  assert.deepEqual([...snapshots[0]].sort(), tools);
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[2], snapshots[0]);
  const stale = await send('tools/call', { name: 'worker_start', arguments: { ...op, attemptEpoch: 0 }, _meta: modernMeta });
  assert.ok(stale.result?.isError || stale.error, 'modern attemptEpoch=0 must fail closed');
});

console.log('FACTORY_MCP_PROTOCOL_SMOKE=PASS');
