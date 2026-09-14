import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const record = JSON.parse(fs.readFileSync(new URL('../governance/v46/project-record.candidate.json', import.meta.url), 'utf8'));
const normalize = s => s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');

test('candidate is RESERVED and exact-bound to one project', () => {
  assert.equal(record.status, 'RESERVED');
  assert.equal(record.binding_status, 'RESERVED');
  assert.equal(record.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.equal(normalize(record.project_name), normalize('全自動軟體工廠'));
});

test('stable locator is provider-qualified and commit is separate', () => {
  assert.match(record.active_run_ref, /^github:\/\/1352411536\//);
  assert.ok(record.active_run_ref.includes('V45-Z6-SAFETY-001'));
  assert.ok(record.active_run_ref.includes('refs/heads/v45/factory-control'));
  assert.doesNotMatch(record.active_run_ref, /[0-9a-f]{40}/);
  assert.match(record.resolved_control_sha, /^[0-9a-f]{40}$/);
});

test('no host-local path or fuzzy fallback is encoded', () => {
  const raw = JSON.stringify(record);
  assert.doesNotMatch(raw, /C:\\\\|Users\\\\|last_active|recent|fuzzy|semantic/i);
  assert.equal(record.promotion_allowed, false);
});

test('unresolved authority refs fail closed', () => {
  assert.equal(record.current_mission_ref, null);
  assert.equal(record.current_execution_policy_ref, null);
  assert.ok(record.blocking_reasons.includes('CURRENT_MISSION_REF_UNRESOLVED'));
  assert.ok(record.blocking_reasons.includes('CURRENT_EXECUTION_POLICY_REF_UNRESOLVED'));
});
