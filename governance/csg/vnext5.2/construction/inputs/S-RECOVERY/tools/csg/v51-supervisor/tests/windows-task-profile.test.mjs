import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {validateSupervisorTaskProfile} from '../lib/windows-task-profile.mjs';

const profilePath = fileURLToPath(new URL('../windows/supervisor-task-profile.json', import.meta.url));
const installerPath = fileURLToPath(new URL('../windows/register-supervisor-task.ps1', import.meta.url));
const removePath = fileURLToPath(new URL('../windows/remove-supervisor-task.ps1', import.meta.url));
const source = JSON.parse(await readFile(profilePath, 'utf8'));

test('Supervisor task profile starts at boot as a least-privilege Local Service task', () => {
  const profile = validateSupervisorTaskProfile(source);
  assert.equal(profile.trigger.kind, 'AtStartup');
  assert.equal(profile.principal.user_id, 'NT AUTHORITY\\LOCAL SERVICE');
  assert.equal(profile.principal.run_level, 'Limited');
  assert.notEqual(profile.principal.user_id, 'NT AUTHORITY\\SYSTEM');
});

test('Supervisor task profile is single-instance and configures bounded automatic restart', () => {
  const profile = validateSupervisorTaskProfile(source);
  assert.equal(profile.settings.multiple_instances, 'IgnoreNew');
  assert.equal(profile.settings.execution_time_limit_seconds, 0);
  assert.equal(profile.settings.restart_on_failure_count, 255);
  assert.equal(profile.settings.restart_interval_seconds, 60);
});

test('Supervisor task profile is fixed to the Project Directory locator and packaged binaries', () => {
  const profile = validateSupervisorTaskProfile(source);
  assert.deepEqual(profile.action.arguments, [
    '--project-id', 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
    '--locator', 'refs/heads/governance/project-directory'
  ]);
  assert.equal(profile.action.node_executable_relative_path, 'runtime/node.exe');
  assert.equal(profile.action.entrypoint_relative_path, 'bin/host-supervisor.mjs');
});

test('Supervisor task profile rejects privileged identities, shell injection, and unsafe paths', () => {
  const asSystem = structuredClone(source);
  asSystem.principal.user_id = 'NT AUTHORITY\\SYSTEM';
  assert.throws(() => validateSupervisorTaskProfile(asSystem), {code: 'SUPERVISOR_TASK_PRINCIPAL_INVALID'});

  const injected = structuredClone(source);
  injected.action.arguments.push(';', 'powershell.exe');
  assert.throws(() => validateSupervisorTaskProfile(injected), {code: 'SUPERVISOR_TASK_ACTION_INVALID'});

  const traversal = structuredClone(source);
  traversal.action.entrypoint_relative_path = '../bin/host-supervisor.mjs';
  assert.throws(() => validateSupervisorTaskProfile(traversal), {code: 'SUPERVISOR_TASK_ACTION_INVALID'});

  const unbounded = structuredClone(source);
  unbounded.settings.restart_on_failure_count = 256;
  assert.throws(() => validateSupervisorTaskProfile(unbounded), {code: 'SUPERVISOR_TASK_SETTINGS_INVALID'});
});

test('Task registration is exact, read-back-first, and has an identity-scoped rollback', async () => {
  const installer = await readFile(installerPath, 'utf8');
  const remove = await readFile(removePath, 'utf8');
  assert.match(installer, /Get-ScheduledTask/);
  assert.match(installer, /Register-ScheduledTask/);
  assert.doesNotMatch(installer, /Register-ScheduledTask[^\r\n]*-Force/i);
  assert.match(installer, /SUPERVISOR_TASK_NAME_COLLISION/);
  assert.match(installer, /ExpectedManifestSha256/);
  assert.match(installer, /Get-FileHash/);
  assert.match(installer, /Test-ScheduledTaskMatchesContract/);
  assert.match(installer, /Task\.Settings\.RestartCount -eq 255/);
  assert.match(installer, /Task\.Settings\.RestartInterval -eq 'PT1M'/);
  assert.match(remove, /Unregister-ScheduledTask/);
  assert.match(remove, /SUPERVISOR_TASK_IDENTITY_MISMATCH/);
  assert.match(remove, /expectedArguments/);
});
