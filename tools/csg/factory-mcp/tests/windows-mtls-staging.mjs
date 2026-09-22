import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const factoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureDir = process.env.P5_MTLS_FIXTURE_DIR;
if (!fixtureDir) throw new Error('P5_MTLS_FIXTURE_DIR_REQUIRED');
if (existsSync(fixtureDir)) throw new Error('P5_MTLS_FIXTURE_MUST_NOT_PREEXIST');
mkdirSync(fixtureDir, { recursive: false });

const windowsCandidates = [
  process.env.P5_OPENSSL_PATH,
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
].filter(Boolean);
const openssl = process.platform === 'win32'
  ? windowsCandidates.find((p) => existsSync(p))
  : (process.env.P5_OPENSSL_PATH || 'openssl');
if (!openssl) throw new Error('WINDOWS_OPENSSL_FIXED_PATH_NOT_FOUND');

const p = (name) => join(fixtureDir, name);
const privateKeys = [p('ca.key'), p('server.key'), p('client.key'), p('unknown.key')];
const transient = [p('server.csr'), p('client.csr'), p('unknown.csr'), p('ca.srl')];
const serverExt = p('server.ext');
const clientExt = p('client.ext');

function runOpenSSL(args) {
  try {
    return execFileSync(openssl, args, {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : -1;
    throw new Error(`OPENSSL_FAILED:${args[0]}:${status}`);
  }
}

function safeUnlink(path) {
  try { if (existsSync(path)) unlinkSync(path); } catch {}
}

let integrationStdout = '';
let integrationPassed = false;
let chainVerifyPassed = false;
try {
  writeFileSync(serverExt, 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n', 'utf8');
  writeFileSync(clientExt, 'extendedKeyUsage=clientAuth\n', 'utf8');

  runOpenSSL(['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','1','-subj','/CN=PTYSD P5 Test CA','-keyout',p('ca.key'),'-out',p('ca.crt')]);
  runOpenSSL(['req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=localhost','-keyout',p('server.key'),'-out',p('server.csr')]);
  runOpenSSL(['x509','-req','-sha256','-days','1','-in',p('server.csr'),'-CA',p('ca.crt'),'-CAkey',p('ca.key'),'-CAcreateserial','-extfile',serverExt,'-out',p('server.crt')]);
  runOpenSSL(['req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=GOV-TUNNEL-001','-keyout',p('client.key'),'-out',p('client.csr')]);
  runOpenSSL(['x509','-req','-sha256','-days','1','-in',p('client.csr'),'-CA',p('ca.crt'),'-CAkey',p('ca.key'),'-CAserial',p('ca.srl'),'-extfile',clientExt,'-out',p('client.crt')]);
  runOpenSSL(['req','-newkey','rsa:2048','-sha256','-nodes','-subj','/CN=UNKNOWN-TUNNEL','-keyout',p('unknown.key'),'-out',p('unknown.csr')]);
  runOpenSSL(['x509','-req','-sha256','-days','1','-in',p('unknown.csr'),'-CA',p('ca.crt'),'-CAkey',p('ca.key'),'-CAserial',p('ca.srl'),'-extfile',clientExt,'-out',p('unknown.crt')]);

  for (const cert of ['server.crt','client.crt','unknown.crt']) {
    const out = runOpenSSL(['verify','-CAfile',p('ca.crt'),p(cert)]);
    if (!out.includes(': OK')) throw new Error(`CERT_CHAIN_VERIFY_FAILED:${cert}`);
  }
  chainVerifyPassed = true;

  const integration = spawnSync(process.execPath, ['tests/http-mtls-integration.mjs'], {
    cwd: factoryRoot,
    env: { ...process.env, P5_MTLS_FIXTURE_DIR: fixtureDir },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 512 * 1024,
  });
  integrationStdout = String(integration.stdout || '');
  if (integration.error) throw new Error(`MTLS_INTEGRATION_SPAWN_FAILED:${integration.error.code || 'UNKNOWN'}`);
  if (integration.status !== 0) throw new Error(`MTLS_INTEGRATION_FAILED:${integration.status}`);
  if (!integrationStdout.includes('FACTORY_MCP_HTTP_MTLS_INTEGRATION=PASS')) throw new Error('MTLS_INTEGRATION_PASS_MARKER_MISSING');
  integrationPassed = true;
} finally {
  for (const key of privateKeys) safeUnlink(key);
  for (const file of transient) safeUnlink(file);
}

const keysRemaining = privateKeys.filter((key) => existsSync(key));
if (keysRemaining.length !== 0) throw new Error('SYNTHETIC_PRIVATE_KEY_CLEANUP_FAILED');
const remaining = readdirSync(fixtureDir).sort();
if (!integrationPassed || !chainVerifyPassed) throw new Error('P5_WINDOWS_MTLS_STAGING_INCOMPLETE');

process.stdout.write(JSON.stringify({
  schema: 'v49.p5.windows-mtls-staging-harness.v1',
  result: 'PASS',
  openssl_path: openssl,
  fixture_dir: fixtureDir,
  cert_chain_verify_pass: chainVerifyPassed,
  modern_mtls_integration_pass: integrationPassed,
  private_keys_removed: true,
  private_key_count_after: 0,
  remaining_nonsecret_files: remaining,
  source_factory_root: factoryRoot,
  observed_at_utc: new Date().toISOString(),
}) + '\n');
