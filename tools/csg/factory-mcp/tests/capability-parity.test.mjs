import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readText = relative => readFile(resolve(packageRoot, relative), 'utf8');
const readBytes = relative => readFile(resolve(packageRoot, relative));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizedSourceHash = bytes => sha256(Buffer.from(
  bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n+$/g, '\n'), 'utf8',
));

function compareVersions(left, right) {
  const parse = value => {
    assert.match(value, /^\d+\.\d+\.\d+$/, `unsupported package version ${value}`);
    return value.split('.').map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

test('CANDIDATE_MUST_NOT_REGRESS_AUTHORIZED_INSTALLED_CAPABILITIES', async () => {
  const [baselineText, matrixText, packageText, lockText, entry, wrapper, broker, helper, installer, smoke] = await Promise.all([
    readText('tests/fixtures/installed-runtime-capability-baseline.json'),
    readText('tests/fixtures/candidate-runtime-capability-matrix.json'),
    readText('package.json'),
    readText('package-lock.json'),
    readText('src/index.mjs'),
    readText('src/invoke-hostguard.ps1'),
    readText('broker/hostguard-broker.ps1'),
    readBytes('broker/host-powershell-exec.ps1'),
    readText('windows/install-broker.ps1'),
    readBytes('tests/host-powershell-exec-smoke.ps1'),
  ]);
  const baseline = JSON.parse(baselineText);
  const matrix = JSON.parse(matrixText);
  const manifest = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const expectedTools = ['factory_status', 'host_powershell', 'worker_prepare', 'worker_start'];

  assert.equal(baseline.evidence_class, 'USER_PROVIDED_FRESH_EXTERNAL_AUDIT');
  assert.equal(baseline.exact_installed_version, null);
  assert.equal(baseline.exact_installed_source_head, null);
  assert.equal(baseline.public_tool_count, 4);
  assert.deepEqual([...baseline.public_tools].sort(), expectedTools);
  assert.equal(baseline.qualified_lineage.minimum_version, '0.2.1');
  assert.equal(baseline.reported_capabilities.host_powershell.run_as, 'NT AUTHORITY\\SYSTEM');
  assert.deepEqual(baseline.reported_capabilities.host_powershell.input_fields,
    ['runId', 'taskId', 'attemptId', 'attemptEpoch', 'script', 'timeoutSeconds']);
  assert.equal(baseline.reported_capabilities.host_powershell.timeout_seconds_minimum, 1);
  assert.equal(baseline.reported_capabilities.host_powershell.timeout_seconds_maximum, 300);
  for (const toolName of expectedTools) {
    assert.equal(matrix.expected_capabilities[toolName].mode, baseline.reported_capabilities[toolName].mode,
      `${toolName} capability mode must be preserved`);
  }
  for (const capability of ['bounded_stdout_stderr', 'truncation_metadata', 'script_and_output_sha256', 'durable_execution_receipt']) {
    assert.equal(baseline.reported_capabilities.host_powershell[capability], true);
    assert.equal(matrix.expected_capabilities.host_powershell[capability], true);
  }

  assert.equal(manifest.version, matrix.candidate_package_version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(matrix.sdk_dependency.package, '@modelcontextprotocol/server');
  assert.equal(manifest.dependencies['@modelcontextprotocol/server'], matrix.sdk_dependency.version);
  assert.equal(lock.packages['node_modules/@modelcontextprotocol/server'].version, matrix.sdk_dependency.version);
  assert.equal(lock.packages['node_modules/@modelcontextprotocol/server'].integrity, matrix.sdk_dependency.integrity);
  assert.equal(matrix.negotiated_wire_protocol_version, '2026-07-28');
  assert.ok(compareVersions(manifest.version, baseline.qualified_lineage.minimum_version) >= 0,
    'candidate package/runtime version must not fall below qualified v0.2.1 lineage');
  assert.equal(matrix.public_tool_count, 4);
  assert.deepEqual([...matrix.public_tools].sort(), expectedTools);
  assert.equal(matrix.production_allowed, false);
  assert.equal(matrix.worker_provider_write_credentials, 0);
  assert.equal(matrix.live_acceptance, 'NOT_ACCEPTED');

  const toolNames = [...entry.matchAll(/registerTool\(\s*'([^']+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(toolNames, expectedTools, 'candidate must expose exactly the four existing public tools');
  assert.match(entry, /registerTool\(\s*'factory_status'[\s\S]*?inputSchema:\s*noArguments[\s\S]*?async \(\) => textResult\(await runReadOnlyDiagnostics\(\)\)/);
  assert.match(entry, /registerTool\(\s*'worker_prepare'[\s\S]*?inputSchema:\s*operationInput[\s\S]*?runHostGuard\('prepare', args\)/);
  assert.match(entry, /registerTool\(\s*'worker_start'[\s\S]*?inputSchema:\s*operationInput[\s\S]*?runHostGuard\('start', args\)/);
  assert.match(entry, /const operationInput = z\.object\(\{[\s\S]*?attemptEpoch: z\.number\(\)\.int\(\)\.min\(1\)\.max\(2147483647\)/);
  assert.match(entry, /const hostPowerShellInput = operationInput\.extend\(\{[\s\S]*?script: z\.string\(\)\.min\(1\)\.max\(8192\)[\s\S]*?timeoutSeconds: z\.number\(\)\.int\(\)\.min\(1\)\.max\(300\)\.default\(60\)/);
  assert.match(entry, /registerTool\(\s*'host_powershell'[\s\S]*?inputSchema:\s*hostPowerShellInput[\s\S]*?async \(args\) => textResult\(await runHostGuard\('powershell', args\)\)/);
  assert.doesNotMatch(entry, /HOST_POWERSHELL_NOT_QUALIFIED|R1_04|R1_05|R1_06/);
  assert.match(entry, /Production Human Gate/);

  assert.match(wrapper, /ValidateSet\('status','prepare','start','powershell'\)/);
  assert.match(wrapper, /schema = 'v51\.factory-mcp\.hostguard\.request\.v3'/);
  assert.match(wrapper, /project_id\s*=\s*\$projectId/);
  assert.match(wrapper, /host_id\s*=\s*\$hostId/);
  assert.match(wrapper, /execution_scope\s*=\s*'PREPRODUCTION_REVERSIBLE'/);
  assert.match(wrapper, /script_b64\s*=\s*if \(\$Operation -eq 'powershell'\)/);
  assert.match(wrapper, /timeout_seconds\s*=\s*if \(\$Operation -eq 'powershell'\)/);
  assert.match(wrapper, /ValidateRange\(1,300\)/);

  assert.match(broker, /hostExecHelperPath\s*=\s*Join-Path \$PSScriptRoot 'host-powershell-exec\.ps1'/);
  assert.match(broker, /if \(-not \(Test-Path -LiteralPath \$hostExecHelperPath\)\) \{ throw 'HOST_EXEC_HELPER_MISSING' \}/);
  assert.match(broker, /\. \$hostExecHelperPath/);
  assert.match(broker, /function Invoke-BrokerPowerShell/);
  assert.match(broker, /'powershell'\s*\{\s*\$result\s*=\s*Invoke-BrokerPowerShell/);
  assert.match(broker, /script_b64/);
  assert.match(broker, /POWERSHELL_TIMEOUT_INVALID/);
  assert.match(broker, /MaxOutputBytes\s+\$maxOutputBytes/);
  assert.match(broker, /exec-receipts/);
  assert.match(broker, /v48\.factory-mcp\.host-exec\.receipt\.v2/);
  assert.match(broker, /script_sha256/);
  assert.match(broker, /stdout_sha256/);
  assert.match(broker, /stderr_sha256/);
  assert.match(broker, /stdout_truncated/);
  assert.match(broker, /stderr_truncated/);

  assert.equal(normalizedSourceHash(helper), baseline.qualified_lineage.host_exec_helper_normalized_sha256,
    'host execution helper must remain the known-good v0.2.1 donor source');
  assert.equal(normalizedSourceHash(smoke), baseline.qualified_lineage.host_exec_smoke_normalized_sha256,
    'host execution smoke asset must remain the known-good v0.2.1 donor source');
  assert.match(helper.toString('utf8'), /ValidateRange\(1,300\)/);
  assert.match(helper.toString('utf8'), /ReadToEndAsync\(\)/);
  assert.match(helper.toString('utf8'), /ConvertTo-PTYSDHostExecBoundedUtf8/);
  assert.match(helper.toString('utf8'), /stdout_truncated/);
  assert.match(helper.toString('utf8'), /stderr_truncated/);
  assert.match(helper.toString('utf8'), /script_sha256/);
  assert.match(helper.toString('utf8'), /stdout_sha256/);
  assert.match(helper.toString('utf8'), /stderr_sha256/);

  assert.match(installer, /'broker\\host-powershell-exec\.ps1'/);
  assert.match(installer, /'tests\\host-powershell-exec-smoke\.ps1'/);
  assert.match(installer, /\$hostExecHelperSourceSha\s*=\s*\(Get-FileHash/);
  assert.match(installer, /\$hostExecHelperInstalledSha\s*=\s*\(Get-FileHash/);
  assert.match(installer, /HOST_EXEC_HELPER_INSTALL_READBACK_MISMATCH/);
  assert.match(installer, /BROKER_HOST_EXEC_HELPER_HASH_MISMATCH/);
  assert.match(installer, /host_exec_helper_sha256\s*=\s*\$hostExecHelperInstalledSha/);
  assert.match(installer, /\$required\s*=\s*@\([\s\S]*?'tests\\capability-parity\.test\.mjs'[\s\S]*?'tests\\fixtures\\installed-runtime-capability-baseline\.json'[\s\S]*?'tests\\fixtures\\candidate-runtime-capability-matrix\.json'/);

  assert.match(matrix.expected_capabilities.factory_status.mode, /FIXED_PURPOSE_READ_ONLY/);
  assert.match(matrix.expected_capabilities.factory_status.owner_liveness_verdict, /NOT_PERFORMED/);
  assert.match(matrix.expected_capabilities.host_powershell.mode, /SCRIPT_CAPABLE_SYSTEM_BROKER_ROUTE/);
  assert.equal(matrix.expected_capabilities.host_powershell.timeout_seconds_minimum, 1);
  assert.equal(matrix.expected_capabilities.host_powershell.timeout_seconds_maximum, 300);
  assert.equal(matrix.expected_capabilities.host_powershell.helper_deterministically_installed, true);
});
