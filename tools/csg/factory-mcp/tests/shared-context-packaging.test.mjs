import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ps1 = readFileSync(join(root, 'windows', 'install-broker.ps1'), 'utf8');
const manifestText = readFileSync(join(root, 'windows', 'repair-manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const sha = p => createHash('sha256').update(readFileSync(join(root, p), 'utf8')).digest('hex');
const STALE = 'd2893358b0387238a0dcc18badce78ca0887d3e743d7bc338f00425194ec8e54';

test('packaging: install required closure includes both shared-context modules', () => {
  assert.match(ps1, /'src\\shared-context\.mjs'/);
  assert.match(ps1, /'src\\shared-context-transport\.mjs'/);
  assert.ok(ps1.indexOf('src\\shared-context.mjs') < ps1.indexOf('src\\shared-context-transport.mjs'));
  const block = / inherent/.test(ps1) ? '' : (ps1.match(/\$required\s*=\s*@\(([\s\S]*?)\)/)?.[1] ?? '');
  const lits = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.equal(new Set(lits).size, lits.length, 'duplicate required literal');
});

test('packaging: manifest has exact updated digests, no duplicates', () => {
  assert.equal(manifest.schema, 'v51.factory-mcp.repair-manifest.v1');
  assert.equal(manifest.release_version, '0.2.4');
  const paths = manifest.files.map(f => f.relative_path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate manifest entry');
  for (const f of manifest.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  const sc = manifest.files.find(f => f.relative_path === 'src/shared-context.mjs');
  const tr = manifest.files.find(f => f.relative_path === 'src/shared-context-transport.mjs');
  assert.ok(sc && tr, 'both modules in manifest');
  assert.equal(sc.sha256, sha('src/shared-context.mjs'));
  assert.equal(tr.sha256, sha('src/shared-context-transport.mjs'));
  assert.notEqual(sc.sha256, STALE);
});

test('packaging: shared-context import closure requires transport payload', () => {
  const src = readFileSync(join(root, 'src', 'shared-context.mjs'), 'utf8');
  assert.ok(src.includes('./shared-context-transport.mjs'));
});

test('packaging: package version >=0.2.4 preserved', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const v = pkg.version.split('.').map(Number);
  assert.ok(v[0] > 0 || (v[0] === 0 && (v[1] > 2 || (v[1] === 2 && v[2] >= 4))), 'version>=0.2.4');
});
