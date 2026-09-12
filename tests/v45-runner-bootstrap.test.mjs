import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync('scripts/register-v45-runner.ps1', 'utf8');

test('runner bootstrap pins the official release digest and exact governance target', () => {
  for (const required of [
    "2.337.0",
    "1150692afa94e71f872017e254ea55b6eece1eece3fe7e3a6d4c93d0a1b85cfc",
    "https://github.com/PT-Original-Point/ptysd-vnext42-governance-sandbox",
    "PTYSD-V45-CONTROL-01",
    "--labels ptysd-governance-v45",
    "--runasservice"
  ]) assert.ok(script.includes(required), `missing ${required}`);
});

test('runner bootstrap fails closed at the time-limited registration-token gate', () => {
  assert.ok(script.includes('PTYSD_GH_RUNNER_TOKEN'));
  assert.ok(script.includes('HUMAN_GATE=GITHUB_SELF_HOSTED_RUNNER_REGISTRATION_TOKEN_REQUIRED'));
  assert.ok(script.includes('exit 42'));
  assert.ok(script.includes('$env:PTYSD_GH_RUNNER_TOKEN = $null'));
});

test('runner bootstrap has no hosted or destructive replacement fallback', () => {
  for (const forbidden of ['--replace', 'windows-latest', 'ubuntu-latest', 'macos-latest', 'GITHUB_TOKEN']) {
    assert.equal(script.includes(forbidden), false, `forbidden ${forbidden}`);
  }
});
