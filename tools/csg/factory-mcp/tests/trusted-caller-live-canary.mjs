import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const factoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectId = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const tools = ['host_powershell', 'worker_prepare', 'worker_start'];
const phases = [];
let currentPhase = 'bootstrap';
let child = null;
let root = null;
let cleanupOk = false;

function phase(name, details = {}) {
  currentPhase = name;
  phases.push({ phase: name, ...details });
}

function fixedOpenSsl() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.P5_OPENSSL_PATH,
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
        'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
      ]
    : [process.env.P5_OPENSSL_PATH, 'openssl'];
  const found = candidates.filter(Boolean).find((p) => p === 'openssl' || existsSync(p));
  if (!found) throw new Error('TRUSTED_CANARY_OPENSSL_NOT_FOUND');
  return found;
}

function openssl(bin, args) {
  try {
    return execFileSync(bin, args, {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : -1;
    throw new Error(`TRUSTED_CANARY_OPENSSL_FAILED:${args[0]}:${status}`);
  }
}

function makeRoot() {
  const requested = process.env.P5_TRUSTED_CANARY_DIR;
  if (requested) {
    if (existsSync(requested)) throw new Error('TRUSTED_CANARY_ROOT_PREEXISTS');
    mkdirSync(requested, { recursive: false });
    return requested;
  }
  return mkdtempSync(join(tmpdir(), 'ptysd-trusted-caller-live-'));
}

function countBrokerReceipts() {
  if (process.platform !== 'win32') return null;
  const dir = 'C:\\ProgramData\\PTYSD\\MCP\\FactoryMCP\\state\\exec-receipts';
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter((name) => name.endsWith('.json')).length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postJson(port, ca, payload, { cert = null, key = null, headers = {} } = {}) {
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
      }));
    });
    req.on('timeout', () => req.destroy(new Error('TRUSTED_CANARY_HTTPS_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}

function modernToolCall(port, ca, name, args, { cert, key }) {
  return postJson(port, ca, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'p5-trusted-caller-live', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }, {
    cert,
    key,
    headers: {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
    },
  });
}

function mutationArgs(name) {
  const common = {
    runId: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-P5',
    taskId: 'GOV-HARDENING-P5',
    attemptId: 'GOV-HARDENING-P5-ATTEMPT-999',
    attemptEpoch: 999,
  };
  if (name === 'host_powershell') {
    return { ...common, script: "Write-Output 'P5_TRUSTED_CANARY_MUST_NOT_RUN'", timeoutSeconds: 60 };
  }
  return common;
}

async function stdioDenyAllMutations() {
  const stdioChild = spawn(process.execPath, ['src/index.mjs'], {
    cwd: factoryRoot,
    env: { ...process.env, PTYSD_FACTORY_MCP_TEST_MODE: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  stdioChild.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
  const lines = createInterface({ input: stdioChild.stdout, crlfDelay: Infinity });
  const pending = new Map();
  lines.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    }
  });
  let id = 1;
  const send = (method, params) => new Promise((resolve, reject) => {
    const current = id++;
    const timer = setTimeout(() => {
      pending.delete(current);
      reject(new Error(`TRUSTED_CANARY_STDIO_TIMEOUT:${method}`));
    }, 5000);
    pending.set(current, { resolve, reject, timer });
    stdioChild.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
  });
  const notify = (method, params = {}) => {
    stdioChild.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };
  try {
    const init = await send('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'p5-trusted-stdio', version: '1.0.0' },
    });
    assert.equal(init.error, undefined, `STDIO_INIT_FAILED:${JSON.stringify(init)}:${stderr}`);
    notify('notifications/initialized');
    const results = {};
    for (const name of tools) {
      const response = await send('tools/call', { name, arguments: mutationArgs(name) });
      const text = JSON.stringify(response);
      assert.match(text, /TRUSTED_CALLER_REQUIRED/, `STDIO_TRUST_GATE_MISSING:${name}:${text}`);
      results[name] = 'TRUSTED_CALLER_REQUIRED';
    }
    return results;
  } finally {
    try { stdioChild.stdin.end(); } catch {}
    try { stdioChild.kill('SIGTERM'); } catch {}
    await sleep(100);
    if (stdioChild.exitCode === null) {
      try { stdioChild.kill('SIGKILL'); } catch {}
    }
  }
}

async function main() {
  root = makeRoot();
  const opensslBin = fixedOpenSsl();
  const p = (name) => join(root, name);
  const caKey = p('ca.key');
  const ca = p('ca.crt');
  const serverKey = p('server.key');
  const serverCert = p('server.crt');
  const clientKey = p('client.key');
  const clientCert = p('client.crt');
  const unknownKey = p('unknown.key');
  const unknownCert = p('unknown.crt');
  const serverExt = p('server.ext');
  const clientExt = p('client.ext');
  const trustedPath = p('trusted-callers.json');
  const httpConfigPath = p('factory-mcp-http.json');
  const healthPath = p('health.json');
  const port = 41000 + (process.pid % 10000);

  phase('generate-certificates', { openssl: opensslBin });
  writeFileSync(serverExt, 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n', 'utf8');
  writeFileSync(clientExt, 'extendedKeyUsage=clientAuth\n', 'utf8');
  openssl(opensslBin, ['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','1','-subj','/CN=PTYSD P5 Test CA','-keyout',caKey,'-out',ca]);
  openssl(opensslBin, ['req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=localhost','-keyout',serverKey,'-out',p('server.csr')]);
  openssl(opensslBin, ['x509','-req','-sha256','-days','1','-in',p('server.csr'),'-CA',ca,'-CAkey',caKey,'-CAcreateserial','-extfile',serverExt,'-out',serverCert]);
  openssl(opensslBin, ['req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=GOV-TUNNEL-001','-keyout',clientKey,'-out',p('client.csr')]);
  openssl(opensslBin, ['x509','-req','-sha256','-days','1','-in',p('client.csr'),'-CA',ca,'-CAkey',caKey,'-CAserial',p('ca.srl'),'-extfile',clientExt,'-out',clientCert]);
  openssl(opensslBin, ['req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=UNKNOWN-TUNNEL','-keyout',unknownKey,'-out',p('unknown.csr')]);
  openssl(opensslBin, ['x509','-req','-sha256','-days','1','-in',p('unknown.csr'),'-CA',ca,'-CAkey',caKey,'-CAserial',p('ca.srl'),'-extfile',clientExt,'-out',unknownCert]);

  for (const cert of [serverCert, clientCert, unknownCert]) {
    const out = openssl(opensslBin, ['verify','-CAfile',ca,cert]);
    assert.match(out, /: OK/);
  }

  const clientDigest = 'sha256:' + createHash('sha256').update(new X509Certificate(readFileSync(clientCert)).raw).digest('hex');
  const unknownDigest = 'sha256:' + createHash('sha256').update(new X509Certificate(readFileSync(unknownCert)).raw).digest('hex');

  function caller(certificateSha, generation, project = projectId, enabled = true) {
    return {
      caller_id: certificateSha === clientDigest ? 'GOV-TUNNEL-001' : 'UNKNOWN-TUNNEL-001',
      project_id: project,
      certificate_sha256: certificateSha,
      principal_type: 'PROJECT_DEDICATED_TUNNEL',
      tunnel_binding_id: 'GOVERNANCE-CONNECTOR-001',
      identity_generation: generation,
      enabled,
    };
  }

  function writeTrusted(mode, generation) {
    let callers;
    if (mode === 'valid') callers = [caller(clientDigest, generation)];
    else if (mode === 'revoked') callers = [caller(clientDigest, generation, projectId, false)];
    else if (mode === 'wrong-project') callers = [caller(clientDigest, generation, 'OTHER_PROJECT')];
    else if (mode === 'duplicate-binding') callers = [caller(clientDigest, generation), caller(unknownDigest, generation)];
    else throw new Error('TRUSTED_CANARY_MODE_INVALID');
    writeFileSync(trustedPath, JSON.stringify({
      schema: 'v49.factory-mcp.trusted-callers.v1',
      binding_mode: 'PER_PROJECT_DEDICATED_TUNNEL',
      identity_generation: generation,
      callers,
    }));
  }

  writeTrusted('valid', 1);
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

  phase('start-https-mtls-server', { port });
  child = spawn(process.execPath, ['src/http-main.mjs'], {
    cwd: factoryRoot,
    env: { ...process.env, PTYSD_FACTORY_MCP_HTTP_CONFIG: httpConfigPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverStderr = '';
  child.stderr.on('data', (chunk) => { serverStderr = (serverStderr + chunk.toString('utf8')).slice(-6000); });
  for (let i = 0; i < 120; i++) {
    try {
      const health = JSON.parse(readFileSync(healthPath, 'utf8'));
      if (health.status === 'READY' && health.project_id === projectId) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`TRUSTED_CANARY_HTTP_EXITED:${child.exitCode}:${serverStderr}`);
    if (i === 119) throw new Error(`TRUSTED_CANARY_HTTP_READY_TIMEOUT:${serverStderr}`);
    await sleep(50);
  }

  const brokerBefore = countBrokerReceipts();

  phase('unknown-cert-all-mutations');
  for (const name of tools) {
    const response = await modernToolCall(port, ca, name, mutationArgs(name), { cert: unknownCert, key: unknownKey });
    assert.equal(response.status, 403, `UNKNOWN_CERT_STATUS:${name}:${response.status}:${response.body}`);
    assert.match(response.body, /TRUSTED_CALLER_CERT_UNKNOWN/, `UNKNOWN_CERT_CODE:${name}:${response.body}`);
  }

  phase('valid-cert-reaches-system-fence');
  writeTrusted('valid', 1);
  for (const name of tools) {
    const response = await modernToolCall(port, ca, name, mutationArgs(name), { cert: clientCert, key: clientKey });
    assert.doesNotMatch(response.body, /TRUSTED_CALLER_/, `VALID_CALLER_TRUST_DENY:${name}:${response.body}`);
    assert.match(response.body, /SYSTEM_FENCE_/, `VALID_CALLER_DID_NOT_REACH_SYSTEM_FENCE:${name}:${response.status}:${response.body}`);
  }

  phase('revoked-cert-all-mutations');
  writeTrusted('revoked', 2);
  for (const name of tools) {
    const response = await modernToolCall(port, ca, name, mutationArgs(name), { cert: clientCert, key: clientKey });
    assert.equal(response.status, 403, `REVOKED_STATUS:${name}:${response.status}:${response.body}`);
    assert.match(response.body, /TRUSTED_CALLER_CERT_UNKNOWN/, `REVOKED_CODE:${name}:${response.body}`);
  }

  phase('wrong-project-all-mutations');
  writeTrusted('wrong-project', 3);
  for (const name of tools) {
    const response = await modernToolCall(port, ca, name, mutationArgs(name), { cert: clientCert, key: clientKey });
    assert.equal(response.status, 403, `WRONG_PROJECT_STATUS:${name}:${response.status}:${response.body}`);
    assert.match(response.body, /TRUSTED_CALLER_PROJECT_HTTP_BINDING_MISMATCH/, `WRONG_PROJECT_CODE:${name}:${response.body}`);
  }

  phase('duplicate-tunnel-binding-all-mutations');
  writeTrusted('duplicate-binding', 4);
  for (const name of tools) {
    const response = await modernToolCall(port, ca, name, mutationArgs(name), { cert: clientCert, key: clientKey });
    assert.equal(response.status, 403, `DUPLICATE_BINDING_STATUS:${name}:${response.status}:${response.body}`);
    assert.match(response.body, /TRUSTED_CALLER_TUNNEL_BINDING_DUPLICATE/, `DUPLICATE_BINDING_CODE:${name}:${response.body}`);
  }

  phase('stdio-all-mutations-denied');
  const stdio = await stdioDenyAllMutations();

  const brokerAfter = countBrokerReceipts();
  if (brokerBefore !== null && brokerAfter !== null) {
    assert.equal(brokerAfter, brokerBefore, `INNER_HOSTGUARD_DISPATCH_DETECTED:${brokerBefore}->${brokerAfter}`);
  }

  phase('complete');
  return {
    schema: 'v49.p5.trusted-caller-live-canary.v1',
    result: 'PASS',
    tools,
    phases,
    stdio,
    broker_receipts_before: brokerBefore,
    broker_receipts_after: brokerAfter,
    inner_hostguard_dispatch_count: brokerBefore === null ? null : brokerAfter - brokerBefore,
    dedicated_binding_mode: 'PER_PROJECT_DEDICATED_TUNNEL',
    private_keys_ephemeral: true,
  };
}

let output;
let failure = null;
try {
  output = await main();
} catch (error) {
  failure = {
    schema: 'v49.p5.trusted-caller-live-canary.v1',
    result: 'FAIL',
    phase: currentPhase,
    error_code: error instanceof Error ? error.message.slice(0, 1800) : 'UNKNOWN',
    phases,
  };
} finally {
  if (child) {
    try { child.kill('SIGTERM'); } catch {}
    await sleep(100);
    if (child.exitCode === null) {
      try { child.kill('SIGKILL'); } catch {}
    }
  }
  if (root) {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    cleanupOk = !existsSync(root);
  } else {
    cleanupOk = true;
  }
}

if (failure) {
  failure.cleanup_complete = cleanupOk;
  process.stderr.write(JSON.stringify(failure) + '\n');
  process.exitCode = 1;
} else {
  output.cleanup_complete = cleanupOk;
  output.private_key_count_after = 0;
  if (!cleanupOk) {
    process.stderr.write(JSON.stringify({ ...output, result: 'FAIL', error_code: 'TRUSTED_CANARY_CLEANUP_FAILED' }) + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify(output) + '\n');
  }
}
