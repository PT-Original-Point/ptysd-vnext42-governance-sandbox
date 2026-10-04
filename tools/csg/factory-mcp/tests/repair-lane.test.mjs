import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = join(packageRoot, 'windows', 'repair-manifest.json');
const read = relative => readFile(join(packageRoot, relative), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('repair package trust pin, exact target set, and payload hashes agree', async () => {
  const [script, manifestBytes] = await Promise.all([
    read('windows/repair-factory-mcp.ps1'),
    readFile(manifestPath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const pin = script.match(/\$script:factoryMcpRepairManifestSha256\s*=\s*'([0-9a-f]{64})'/)?.[1];
  const allowedBlock = script.match(/\$script:factoryMcpRepairAllowedTargets\s*=\s*@\(([\s\S]*?)\r?\n\)/)?.[1];
  assert.ok(pin, 'repair manifest SHA-256 must be pinned in the separately installed repair script');
  assert.ok(allowedBlock, 'repair target allowlist must be explicit');
  assert.equal(sha256(manifestBytes), pin, 'manifest bytes must match the exact trust pin');
  assert.equal(manifest.schema, 'v51.factory-mcp.repair-manifest.v1');
  assert.equal(manifest.project_scope_mode, 'PROTECTED_INSTALL_CONFIGURATION');
  assert.equal(manifest.release_version, '0.2.4');
  assert.deepEqual(Object.keys(manifest.canary).sort(), ['id', 'relative_path', 'sha256']);
  assert.equal(manifest.canary.id, 'READ_ONLY_FACTORY_STATUS');
  assert.equal(manifest.canary.relative_path, 'tests/live-status-smoke.mjs');
  assert.match(manifest.canary.sha256, /^[0-9a-f]{64}$/);
  assert.equal(sha256(await readFile(join(packageRoot, manifest.canary.relative_path))), manifest.canary.sha256,
    'SYSTEM-executed canary bytes must match the qualified manifest digest');
  const allowed = [...allowedBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const actual = manifest.files.map(entry => entry.relative_path);
  assert.deepEqual(actual, allowed, 'manifest targets must match the reviewed allowlist in order');
  for (const entry of manifest.files) {
    const bytes = await readFile(join(packageRoot, entry.relative_path));
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(sha256(bytes), entry.sha256, entry.relative_path + ' must match its qualified digest');
  }
});

test('repair implementation fails closed on scope, target ACL, task action, and replay ambiguity', async () => {
  const script = await read('windows/repair-factory-mcp.ps1');
  assert.match(script, /Global\\PTYSD\.FactoryMcp\.Repair/);
  assert.match(script, /REPAIR_ALREADY_RUNNING/);
  assert.match(script, /Assert-FactoryMcpRepairTargetDirectoryAcl/);
  assert.match(script, /Assert-FactoryMcpRepairSafePathAncestors/);
  assert.match(script, /REPAIR_ANCESTOR_UNTRUSTED_WRITE_ACCESS/);
  assert.match(script, /REPAIR_TARGET_DIRECTORY_NETWORK_SERVICE_WRITE_ACCESS/);
  assert.match(script, /Test-FactoryMcpRepairWriteRights/);
  assert.match(script, /FileSystemRights\]::ChangePermissions/);
  assert.match(script, /FileSystemRights\]::TakeOwnership/);
  assert.match(script, /REPAIR_PRESTATE_CHANGED_BEFORE_REPLACE/);
  assert.match(script, /\$completedReplacePaths \+= \$snapshot\.relative_path/);
  assert.doesNotMatch(script, /\$attemptedPaths/);
  assert.match(script, /Copy-FactoryMcpRepairDurableBackup/);
  assert.match(script, /Flush\(\$true\)/);
  assert.match(script, /REPAIR_TASK_ACTION_PATH_INVALID/);
  assert.match(script, /REPAIR_PRIOR_EFFECT_REQUIRES_READBACK/);
  assert.match(script, /Assert-FactoryMcpRepairTargetFileAcl -Path \$target/);
  assert.match(script, /REPAIR_REQUIRES_SYSTEM/);
  assert.match(script, /READ_ONLY_FACTORY_STATUS/);
  assert.match(script, /Assert-FactoryMcpRepairCanaryFile -Path \$canary -ExpectedSha256 \$ExpectedSha256/);
  assert.match(script, /REPAIR_CANARY_DIGEST_MISMATCH/);
  assert.match(script, /REPAIR_CANARY_REPARSE_POINT/);
  assert.doesNotMatch(script, /\bInvoke-Expression\b|\bScriptBlock::Create\b/);
});

test('repair local smoke validates the manifest without invoking Host repair', { skip: process.platform !== 'win32' }, () => {
  const smoke = join(packageRoot, 'tests', 'repair-lane-smoke.ps1');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', smoke], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  assert.match(result.stdout, /REPAIR_LANE_SMOKE=PASS/);
});

test('installer explicitly packages repair source, manifest, and local regression assets', async () => {
  const installer = await read('windows/install-broker.ps1');
  const requiredBlock = installer.match(/\$required\s*=\s*@\(([\s\S]*?)\r?\n\)/)?.[1];
  assert.ok(requiredBlock);
  const packageJson = JSON.parse(await read('package.json'));
  const packageTestPaths = [...packageJson.scripts.test.matchAll(/\btests\/[^\s;&]+/g)].map(match => match[0]);
  const installerPaths = new Set([...requiredBlock.matchAll(/'([^']+)'/g)].map(match => match[1].replace(/\\/g, '/')));
  for (const item of packageTestPaths) {
    assert.ok(installerPaths.has(item), 'installer must package npm test input ' + item);
  }
  for (const item of [
    'src\\shared-context.mjs',
    'tests\\shared-context.test.mjs',
    'tests\\repair-lane.test.mjs',
    'tests\\repair-lane-smoke.ps1',
    'tests\\hostguard-request-replay.test.mjs',
  ]) {
    assert.ok(requiredBlock.includes("'" + item + "'"), 'installer must package ' + item);
  }
  assert.match(installer, /\$repairScriptRelative\s*=\s*'windows\\repair-factory-mcp\.ps1'/);
  assert.match(installer, /\$repairManifestRelative\s*=\s*'windows\\repair-manifest\.json'/);
  assert.match(requiredBlock, /\$repairScriptRelative/);
  assert.match(requiredBlock, /\$repairManifestRelative/);
  for (const token of ['REPAIR_ROOT_ALREADY_EXISTS', 'REPAIR_MANIFEST_DIGEST_MISMATCH', 'REPAIR_PAYLOAD_DIGEST_MISMATCH']) {
    assert.ok(installer.includes(token), 'installer must enforce ' + token);
  }
  assert.match(installer, /Assert-FactoryMcpRepairSafePathAncestors\s+-Path\s+\$base/);
  assert.match(installer, /repairManifest\.canary\.relative_path/);
  assert.match(installer, /repairManifest\.canary\.sha256/);
  assert.match(installer, /REPAIR_CANARY_PAYLOAD_DIGEST_MISMATCH/);
});
