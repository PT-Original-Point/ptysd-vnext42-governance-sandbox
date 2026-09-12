import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const pin = load('protocol/app-server/pin.json');
const stable = fs.readFileSync(new URL('../protocol/app-server/stable-methods.txt', import.meta.url), 'utf8').trim().split(/\r?\n/).filter(Boolean);
const bin = process.env.CODEX_BIN;
assert(bin && path.isAbsolute(bin) && fs.existsSync(bin), 'CODEX_BIN exact absolute path required');
assert(sha256(bin) === pin.codex_binary_sha256, 'Codex binary SHA-256 mismatch');
const version = spawnSync(bin, ['--version'], { encoding: 'utf8' });
assert(version.status === 0, 'codex --version failed');
assert(version.stdout.trim() === `codex-cli ${pin.codex_cli_version}`, 'Codex version mismatch');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptysd-appserver-pin-'));
try {
  const gen = spawnSync(bin, ['app-server','generate-json-schema','--out',tmp], { encoding:'utf8' });
  assert(gen.status === 0, `schema generation failed: ${gen.stderr}`);
  const checks = {
    'ClientRequest.json': pin.client_request_sha256,
    'ServerRequest.json': pin.server_request_sha256,
    'ClientNotification.json': pin.client_notification_sha256,
    'ServerNotification.json': pin.server_notification_sha256,
    'codex_app_server_protocol.schemas.json': pin.protocol_all_schemas_sha256,
    'codex_app_server_protocol.v2.schemas.json': pin.protocol_v2_schemas_sha256
  };
  for (const [name, expected] of Object.entries(checks)) {
    assert(sha256(path.join(tmp, name)) === expected, `schema SHA mismatch: ${name}`);
  }
  const client = JSON.parse(fs.readFileSync(path.join(tmp, 'ClientRequest.json'), 'utf8'));
  const found = new Set();
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (x.properties?.method) {
      const m = x.properties.method;
      if (typeof m.const === 'string') found.add(m.const);
      if (Array.isArray(m.enum)) for (const v of m.enum) if (typeof v === 'string') found.add(v);
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(client);
  const generated = [...found].sort();
  assert(generated.length === pin.stable_method_count, 'generated stable method count mismatch');
  assert(generated.join('\n') === stable.join('\n'), 'generated stable method universe mismatch');
  console.log(JSON.stringify({
    app_server_pin: 'PASS', codex_cli_version: pin.codex_cli_version,
    codex_binary_sha256: pin.codex_binary_sha256,
    stable_method_count: generated.length,
    experimental_included: false
  }, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
