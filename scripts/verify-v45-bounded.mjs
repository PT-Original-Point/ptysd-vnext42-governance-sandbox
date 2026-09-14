import fs from 'node:fs';
import assert from 'node:assert/strict';

const control = JSON.parse(fs.readFileSync('governance/v45/control.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/v45-bounded-self-hosted.yml', 'utf8');

assert.equal(control.schema, 'PTYSD_GITHUB_ACTIONS_BOUNDED_V1');
assert.equal(control.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
assert.equal(control.runtime_type, 'GITHUB_ACTIONS_BOUNDED');
assert.equal(control.repository_id, 1352411536);
assert.equal(control.control_branch, 'v45/factory-control');
assert.equal(control.hosted_runner_allowed, false);
assert.equal(control.provider_write_credentials_on_worker_allowed, false);
assert.equal(control.production_allowed, false);
assert.equal(control.business_project_access_allowed, false);
assert.equal(control.zero_incremental_paid_cost_required, true);
assert.deepEqual(control.runner_labels, ['self-hosted', 'windows', 'ptysd-governance-v45']);
assert.equal(control.runner_acceptance, 'PASS');
assert.equal(control.runner_name, 'PTYSD-V45-CONTROL-01');
assert.equal(control.runner_version, '2.337.0');

for (const required of [
  'workflow_dispatch:',
  'permissions:',
  'contents: read',
  'group: PTYSD-V46-CONTROL-TRUSTED',
  'labels: ptysd-governance-v45',
  'timeout-minutes: 20',
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  "node-version: '24'",
  'persist-credentials: false',
  'shell: cmd',
  'cancel-in-progress: false'
]) assert.ok(workflow.includes(required), `missing ${required}`);

for (const forbidden of [
  'ubuntu-latest',
  'windows-latest',
  'macos-latest',
  'contents: write',
  'pull-requests: write',
  'issues: write',
  'secrets.',
  'schedule:',
  'push:',
  'shell: pwsh',
  'shell: powershell'
]) assert.equal(workflow.includes(forbidden), false, `forbidden ${forbidden}`);

console.log('PASS_VNEXT45_BOUNDED_CONTROL_STATIC_GATE');
