import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = relative => readFile(join(packageRoot, relative), 'utf8');

test('Tunnel task SID, not shared Network Service Modify, gates SYSTEM broker queue', async () => {
  const [installer, helper, importer, qualifier] = await Promise.all([
    read('windows/install-broker.ps1'),
    read('broker/trusted-caller-boundary.ps1'),
    read('windows/import-tunnel-credentials.ps1'),
    read('windows/qualify-tunnel.ps1'),
  ]);
  assert.match(installer, /-ProcessTokenSidType\s+Unrestricted/);
  assert.match(installer, /Get-FactoryScheduledTaskSid\s+-TaskName\s+\$tunnelTask/);
  assert.match(installer, /Set-FactoryDirectoryAcl\s+-Path\s+\(Join-Path\s+\$install\s+'queue\\inbox'\)\s+-TaskSid\s+@\(\$tunnelTaskSid\)\s+-Mode\s+MODIFY/);
  assert.doesNotMatch(installer, /NETWORK SERVICE:\(OI\)\(CI\)M/);
  assert.match(helper, /TRUSTED_QUEUE_ACL_INHERITANCE_ENABLED/);
  assert.match(helper, /TRUSTED_QUEUE_ACL_PRINCIPAL_UNEXPECTED/);
  assert.match(importer, /\$TrustedTaskSid\s*=\s*\$resolvedTaskSid/);
  assert.doesNotMatch(importer, /NETWORK SERVICE:R/);
  assert.doesNotMatch(qualifier, /S-1-5-20/);
});

test('the tunnel task launches the exact stdio MCP child that holds the queue task SID', async () => {
  const [installer, tunnelRunner, template, importer, boundary] = await Promise.all([
    read('windows/install-broker.ps1'),
    read('windows/run-tunnel.ps1'),
    read('windows/factory-mcp-tunnel.template.yaml'),
    read('windows/import-tunnel-credentials.ps1'),
    read('broker/trusted-caller-boundary.ps1'),
  ]);

  // OpenAI tunnel-client v0.0.14 documents mcp.commands as a local stdio
  // command spawned by tunnel-client. Bind that command to the scheduled
  // task whose task SID alone receives the broker queue Modify ACL.
  assert.match(installer, /Copy-Item\s+-LiteralPath\s+\(Join-Path\s+\$SourceRoot\s+'windows\\run-tunnel\.ps1'\)\s+-Destination\s+\(Join-Path\s+\$base\s+'run-factory-mcp-tunnel\.ps1'\)/);
  assert.match(installer, /\$tunnelAction\s*=\s*New-ScheduledTaskAction[\s\S]*?'run-factory-mcp-tunnel\.ps1'[\s\S]*?\$tunnelPrincipal\s*=\s*New-ScheduledTaskPrincipal[\s\S]*?-UserId\s+'NT AUTHORITY\\NETWORK SERVICE'[\s\S]*?-ProcessTokenSidType\s+Unrestricted/);
  assert.match(installer, /Register-ScheduledTask\s+-TaskName\s+\$tunnelTask\s+-Action\s+\$tunnelAction/);
  assert.match(installer, /Get-FactoryScheduledTaskSid\s+-TaskName\s+\$tunnelTask/);
  assert.match(installer, /Set-FactoryDirectoryAcl\s+-Path\s+\(Join-Path\s+\$install\s+'queue\\inbox'\)\s+-TaskSid\s+@\(\$tunnelTaskSid\)\s+-Mode\s+MODIFY/);
  assert.match(installer, /Set-FactoryDirectoryAcl\s+-Path\s+\(Join-Path\s+\$install\s+'queue\\outbox'\)\s+-TaskSid\s+@\(\$tunnelTaskSid\)\s+-Mode\s+MODIFY/);
  assert.match(installer, /foreach\s*\(\$q\s+in\s+@\('queue\\inbox','queue\\processing','queue\\outbox','state'\)\)\s*\{\s*Set-FactoryDirectoryAcl\s+-Path\s+\(Join-Path\s+\$install\s+\$q\)\s+-Mode\s+SYSTEM_ONLY/);
  assert.match(installer, /Unregister-ScheduledTask\s+-TaskName\s+\$probeTask[\s\S]*?Set-FactoryDirectoryAcl\s+-Path\s+\(Join-Path\s+\$install\s+'queue\\inbox'\)\s+-TaskSid\s+@\(\$tunnelTaskSid\)\s+-Mode\s+MODIFY/);
  assert.match(installer, /Unregister-ScheduledTask\s+-TaskName\s+\$probeTask[\s\S]*?Set-FactoryDirectoryAcl\s+-Path\s+\(Join-Path\s+\$install\s+'queue\\outbox'\)\s+-TaskSid\s+@\(\$tunnelTaskSid\)\s+-Mode\s+MODIFY/);

  assert.match(tunnelRunner, /\$exe\s*=\s*Join-Path\s+\$root\s+'tunnel\\v0\.0\.14\\tunnel-client\.exe'/);
  assert.match(tunnelRunner, /\$profile\s*=\s*Join-Path\s+\$root\s+'config\\factory-mcp-tunnel\.yaml'/);
  assert.match(tunnelRunner, /&\s+\$exe\s+run\s+--profile-file\s+\$profile/);
  assert.match(importer, /\$profile\s*=\s*Join-Path\s+\$Root\s+'config\\factory-mcp-tunnel\.yaml'/);
  assert.match(importer, /\$template\s*=\s*Join-Path\s+\$Root\s+'FactoryMCP\\windows\\factory-mcp-tunnel\.template\.yaml'/);
  assert.match(template, /command:\s+'"C:\/Program Files\/nodejs\/node\.exe" "C:\/ProgramData\/PTYSD\/MCP\/FactoryMCP\/src\/index\.mjs"'/);

  assert.match(boundary, /\[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)/);
  assert.match(boundary, /\$identity\.Groups/);
  assert.match(boundary, /\$matchingTaskSids\.Count\s+-eq\s+1/);
  assert.match(boundary, /\$userSid\s+-ceq\s+\$script:factoryTrustedCallerNetworkServiceSid[\s\S]*?\$queueStatus\s+-ceq\s+'PASS'/);
});

test('installer required-file list resolves to files in the packaged source tree', async () => {
  const installer = await read('windows/install-broker.ps1');
  const requiredBlock = installer.match(/\$required\s*=\s*@\(([\s\S]*?)\r?\n\)/)?.[1];
  const helperPath = installer.match(/\$trustedCallerHelperRelative\s*=\s*'([^']+)'/)?.[1];
  const repairScriptPath = installer.match(/\$repairScriptRelative\s*=\s*'([^']+)'/)?.[1];
  const repairManifestPath = installer.match(/\$repairManifestRelative\s*=\s*'([^']+)'/)?.[1];
  assert.ok(requiredBlock, 'installer required-file list must remain explicit');
  assert.ok(helperPath, 'trusted-caller helper path must be explicit');
  const requiredPaths = [...requiredBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.match(requiredBlock, /\$trustedCallerHelperRelative/);
  assert.match(requiredBlock, /\$repairScriptRelative/);
  assert.match(requiredBlock, /\$repairManifestRelative/);
  requiredPaths.push(helperPath);
  requiredPaths.push(repairScriptPath, repairManifestPath);
  for (const relativePath of requiredPaths) {
    const candidatePath = resolve(packageRoot, relativePath.replaceAll('\\', '/'));
    await access(candidatePath);
    assert.ok((await readFile(candidatePath)).length > 0, relativePath + ' must be packaged and non-empty');
  }
});

test('broker validates request file identity before claim and removes caller write access before parse', async () => {
  const [broker, helper, wrapper] = await Promise.all([
    read('broker/hostguard-broker.ps1'),
    read('broker/trusted-caller-boundary.ps1'),
    read('src/invoke-hostguard.ps1'),
  ]);
  const validateAt = broker.indexOf('Assert-TrustedBrokerRequestFile -Path $file.FullName');
  const moveAt = broker.indexOf('Move-Item -LiteralPath $file.FullName -Destination $claimed');
  const protectAt = broker.indexOf('Protect-ClaimedBrokerRequestFile -Path $claimed');
  const processAt = broker.indexOf('Process-Request -File $claimedFile');
  assert.ok(validateAt >= 0 && validateAt < moveAt && moveAt < protectAt && protectAt < processAt);
  assert.match(helper, /REQUEST_OWNER_INVALID/);
  assert.match(helper, /function ConvertFrom-FactoryCanonicalJson/);
  assert.match(broker, /ConvertFrom-FactoryCanonicalJson\s+-JsonText \$requestText\s+-Depth 4/);
  assert.match(helper, /REQUEST_REPARSE_POINT_DENIED/);
  assert.match(helper, /REQUEST_PATH_OUTSIDE_INBOX/);
  assert.match(helper, /REQUEST_CLAIMED_ACL_READBACK_FAILED/);
  assert.match(broker, /v51\.factory-mcp\.hostguard\.request\.v3/);
  assert.match(wrapper, /Get-FactoryScheduledTaskSid\s+-TaskName\s+\$trustedTunnelTask/);
  assert.match(wrapper, /Assert-FactoryCurrentTunnelTaskContext\s+-TaskSid\s+\$tunnelTaskSid/);
  assert.match(wrapper, /Read-FactoryProjectScope\s+-TunnelTaskSid\s+\$tunnelTaskSid/);
  assert.match(wrapper, /project_id\s*=\s*\$projectId/);
  assert.match(wrapper, /host_id\s*=\s*\$hostId/);
  assert.match(wrapper, /execution_scope\s*=\s*'PREPRODUCTION_REVERSIBLE'/);
  assert.match(broker, /Read-FactoryProjectScope\s+-TunnelTaskSid\s+\$trustedTunnelTaskSid/);
  assert.match(broker, /Assert-FactoryRequestScope\s+-Request \$req\s+-ExpectedProjectId \$script:factoryTrustedCallerProjectId\s+-ExpectedHostId \$script:factoryTrustedCallerHostId/);
  assert.doesNotMatch(helper, /CHATGPT_GLOBAL_SKILL_GOVERNANCE|DESKTOP-1B6PD2P/);
  assert.doesNotMatch(wrapper, /CHATGPT_GLOBAL_SKILL_GOVERNANCE|DESKTOP-1B6PD2P/);
  assert.doesNotMatch(broker, /CHATGPT_GLOBAL_SKILL_GOVERNANCE|DESKTOP-1B6PD2P/);
});

test('project/host/Production scope and request owner/reparse denials behave fail closed on Windows', {
  skip: process.platform !== 'win32',
}, () => {
  const smoke = join(packageRoot, 'tests', 'trusted-caller-boundary-smoke.ps1');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', smoke], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  assert.match(result.stdout, /TRUSTED_CALLER_BOUNDARY_SMOKE=PASS/);
});
