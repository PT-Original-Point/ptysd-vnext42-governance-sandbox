import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getStableSystemOperationKey } from '../src/stable-operation-identity.mjs';

test('stable operation identity is deterministic and capability-bound', () => {
  const args = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'CAP-GOV-SYSTEM-V1', 'OP025'];
  const key = getStableSystemOperationKey(...args);
  assert.equal(key, 'da82087da41e5b7ffa98a36b9ae172253ccaebd644f547baca3c656f246d616f');
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(getStableSystemOperationKey(...args), key);
  assert.equal(getStableSystemOperationKey(...args.map((value) => value.toLowerCase())), key);
  assert.notEqual(getStableSystemOperationKey('OTHER_PROJECT', args[1], args[2]), key);
  assert.notEqual(getStableSystemOperationKey(args[0], 'OTHER_CAPABILITY', args[2]), key);
  assert.notEqual(getStableSystemOperationKey(args[0], args[1], 'OP026'), key);
  assert.throws(() => getStableSystemOperationKey(args[0], args[1], ''), /SYSTEM_OPERATION_IDENTITY_INVALID/);
});

test('privileged path binds stable operation and OS file-owner identity without request-supplied caller ids', () => {
  const index = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
  const wrapper = fs.readFileSync(new URL('../src/invoke-hostguard.ps1', import.meta.url), 'utf8');
  const broker = fs.readFileSync(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
  const identity = fs.readFileSync(new URL('../broker/system-capability-identity.ps1', import.meta.url), 'utf8');
  const capability = JSON.parse(fs.readFileSync(new URL('../config/system-capability.json', import.meta.url), 'utf8'));

  assert.equal(capability.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.equal(capability.capability_id, 'CAP-GOV-SYSTEM-V1');
  assert.equal(capability.trusted_caller_sid, 'S-1-5-20');
  assert.equal(capability.production_allowed, false);
  assert.equal(capability.business_project_allowed, false);
  assert.match(index, /getStableSystemOperationKey/);
  assert.match(index, /'-OperationId', args\.operationId/);
  assert.match(wrapper, /operation_id = if \(\$Operation -eq 'powershell'\) \{ \$OperationId \}/);
  assert.match(wrapper, /SYSTEM_OPERATION_ID_REQUIRED/);
  assert.match(identity, /Get-PTYSDTrustedRequestOwnerSid/);
  assert.match(broker, /SYSTEM_CAPABILITY_CALLER_DENY/);
  assert.match(broker, /SYSTEM_OPERATION_REPLAY_DENY/);
  assert.match(broker, /operation_key/);
  assert.doesNotMatch(broker, /\$Request\.caller_sid/);
  assert.match(identity, /GetOwner\(\[Security\.Principal\.SecurityIdentifier\]\)/);
});

test('Windows PowerShell identity smoke matches the Node operation-key vector', { skip: process.platform !== 'win32' }, () => {
  const smokePath = fileURLToPath(new URL('./system-capability-identity-smoke.ps1', import.meta.url));
  const windowsPowerShellModules = `${process.env.WINDIR || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\Modules`;
  const result = spawnSync('powershell.exe', [
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',smokePath,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PSModulePath: windowsPowerShellModules },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
  assert.match(result.stdout, /SYSTEM_CAPABILITY_IDENTITY_SMOKE=PASS/);
});
