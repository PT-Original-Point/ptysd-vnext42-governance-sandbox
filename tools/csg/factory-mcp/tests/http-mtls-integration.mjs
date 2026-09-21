import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const fixtureDir = process.env.P5_MTLS_FIXTURE_DIR;
if (!fixtureDir) throw new Error('P5_MTLS_FIXTURE_DIR_REQUIRED');

const ca = join(fixtureDir, 'ca.crt');
const serverCert = join(fixtureDir, 'server.crt');
const serverKey = join(fixtureDir, 'server.key');
const clientCert = join(fixtureDir, 'client.crt');
const clientKey = join(fixtureDir, 'client.key');
const unknownCert = join(fixtureDir, 'unknown.crt');
const unknownKey = join(fixtureDir, 'unknown.key');
for (const p of [ca, serverCert, serverKey, clientCert, clientKey, unknownCert, unknownKey]) {
  readFileSync(p);
}

const root = mkdtempSync(join(tmpdir(), 'ptysd-http-mtls-'));
const trustedPath = join(root, 'trusted-callers.json');
const httpConfigPath = join(root, 'factory-mcp-http.json');
const healthPath = join(root, 'health.json');
const port = 39443 + (process.pid % 1000);
const projectId = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';

const clientRaw = new X509Certificate(readFileSync(clientCert)).raw;
const clientDigest = 'sha256:' + createHash('sha256').update(clientRaw).digest('hex');

function writeTrusted({ generation = 1, enabled = true, project = projectId } = {}) {
  writeFileSync(trustedPath, JSON.stringify({
    schema: 'v49.factory-mcp.trusted-callers.v1',
    binding_mode: 'PER_PROJECT_DEDICATED_TUNNEL',
    identity_generation: generation,
    callers: [{
      caller_id: 'GOV-TUNNEL-001',
      project_id: project,
      certificate_sha256: clientDigest,
      principal_type: 'PROJECT_DEDICATED_TUNNEL',
      tunnel_binding_id: 'GOVERNANCE-CONNECTOR-001',
      identity_generation: generation,
      enabled,
    }],
  }));
}

writeTrusted();
writeFileSync(httpConfigPath, JSON.stringify({
  schema: 'v49.factory-mcp.http-mtls.v1',
  project_id: projectId,
  listen_host: '127.0.0.1',
  listen_port: port,
  server_cert_path: serverCert,
  server_key_path: serverKey,
  client_ca_path: ca,
  trusted_callers_path: trustedPath,
  health_path: healthPath,
}));

const child = spawn(process.execPath, ['src/http-main.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PTYSD_FACTORY_MCP_HTTP_CONFIG: httpConfigPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-12000); });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try {
      const health = JSON.parse(readFileSync(healthPath, 'utf8'));
      if (health.status === 'READY' && health.project_id === projectId) return health;
    } catch {}
    if (child.exitCode !== null) throw new Error('HTTP_SERVER_EXITED:' + child.exitCode + ':' + stderr);
    await sleep(50);
  }
  throw new Error('HTTP_SERVER_READY_TIMEOUT:' + stderr);
}

function postJson(payload, { cert = null, key = null, headers = {} } = {}) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      servername: 'localhost',
      ca: readFileSync(ca),
      cert: cert ? readFileSync(cert) : undefined,
      key: key ? readFileSync(key) : undefined,
      rejectUnauthorized: true,
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS_REQUEST_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}

function modernToolsList({ cert = null, key = null } = {}) {
  return postJson({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'p5-mtls-integration', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }, {
    cert,
    key,
    headers: {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
  });
}

function legacyInitialize({ cert, key }) {
  return postJson({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'legacy-probe', version: '1.0.0' },
    },
  }, { cert, key });
}

try {
  await waitReady();

  const valid = await modernToolsList({ cert: clientCert, key: clientKey });
  assert.equal(valid.status, 200, `valid modern mTLS tools/list failed: ${valid.status} ${valid.body} ${stderr}`);
  assert.match(valid.body, /"jsonrpc"\s*:\s*"2\.0"/);
  for (const tool of ['factory_status','host_powershell','worker_prepare','worker_start']) assert.match(valid.body, new RegExp(tool));
  assert.doesNotMatch(valid.body, /TRUSTED_CALLER_/);

  const legacy = await legacyInitialize({ cert: clientCert, key: clientKey });
  assert.equal(legacy.status, 400);
  assert.match(legacy.body, /Unsupported protocol version|modern-only/);

  let noCertDenied = false;
  try {
    const noCert = await modernToolsList();
    noCertDenied = noCert.status === 401 || noCert.status === 403;
  } catch {
    noCertDenied = true;
  }
  assert.equal(noCertDenied, true, 'client certificate must be required by TLS');

  const unknown = await modernToolsList({ cert: unknownCert, key: unknownKey });
  assert.equal(unknown.status, 403);
  assert.match(unknown.body, /TRUSTED_CALLER_CERT_UNKNOWN/);

  writeTrusted({ generation: 2, enabled: false });
  const revoked = await modernToolsList({ cert: clientCert, key: clientKey });
  assert.equal(revoked.status, 403);
  assert.match(revoked.body, /TRUSTED_CALLER_CERT_UNKNOWN/);

  writeTrusted({ generation: 3, enabled: true, project: 'OTHER_PROJECT' });
  const wrongProject = await modernToolsList({ cert: clientCert, key: clientKey });
  assert.equal(wrongProject.status, 403);
  assert.match(wrongProject.body, /TRUSTED_CALLER_PROJECT_HTTP_BINDING_MISMATCH/);

  console.log('FACTORY_MCP_HTTP_MTLS_INTEGRATION=PASS');
} finally {
  child.kill('SIGTERM');
  await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
}
