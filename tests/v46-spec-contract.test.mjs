import test from 'node:test';
import assert from 'node:assert/strict';
import { compileShadowContract, expectedDigests } from '../scripts/v46-spec-contract.mjs';

const frozenInput = {
  input_id: 'B1-RETRY-POLICY-001',
  change_id: 'cap-retry-attempts-at-three',
  decision_id: 'DEC-B1-RETRY-CAP-001',
  decision: 'Retry attempts are bounded to integers 1 through 3 and invalid values fail closed.',
  scope: ['retry-policy.mjs', 'retry-policy.test.mjs'],
  non_goals: ['provider retries', 'network backoff', 'production deployment'],
  requirements: [
    { id: 'REQ-B1-001', text: 'The parser SHALL accept integer retry counts from 1 through 3.' },
    { id: 'REQ-B1-002', text: 'The parser SHALL reject retry counts greater than 3 with RETRY_ATTEMPTS_OUT_OF_RANGE.' },
    { id: 'REQ-B1-003', text: 'The parser SHALL reject non-integers and values below 1 with RETRY_ATTEMPTS_INVALID.' }
  ],
  acceptance_ids: ['AT-B1-001', 'AT-B1-002', 'AT-B1-003'],
  task_limit: 12,
  attempt_limit: 3
};

const authority = {
  project_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  mission_revision_id: '20260914T194247+0800',
  mission_hash: 'sha256:5f1f97971b5aec75454a03ffbad8a8a9036240e830facb4e6efc5ed538260b7b',
  policy_revision_id: '20260914T194247+0800-EP67',
  policy_hash: 'sha256:9e38810fee31514af2194a83aaca981bcb7ba0376cc6752aa7cf9b3419d1b67a'
};

const structuralPass = {
  items: [{ id: frozenInput.change_id, type: 'change', valid: true, issues: [] }],
  summary: { totals: { items: 1, passed: 1, failed: 0 } }
};
const digests = expectedDigests(frozenInput);

function good(overrides = {}) {
  return {
    frozenInput,
    structuralValidation: structuralPass,
    observedDecisionDigest: digests.decision_digest,
    observedRequirementIds: frozenInput.requirements.map(r => r.id),
    observedAcceptanceIds: frozenInput.acceptance_ids,
    behaviorChange: true,
    skipSpecs: false,
    authority,
    ...overrides
  };
}

test('positive compile preserves one factory.contract.v1 authority', () => {
  const out = compileShadowContract(good());
  assert.equal(out.schema_version, 'factory.contract.v1');
  assert.equal(out.decision_digest, digests.decision_digest);
  assert.equal(out.requirements_digest, digests.requirements_digest);
  assert.equal(out.task_projection_authoritative, false);
  assert.equal(out.open_spec_checkbox_state_ignored, true);
  assert.equal(out.second_task_state_created, false);
});

test('missing scenario is rejected through structural admission', () => {
  const invalid = { items: [{ id: frozenInput.change_id, valid: false }], summary: { totals: { items: 1, passed: 0, failed: 1 } } };
  assert.throws(() => compileShadowContract(good({ structuralValidation: invalid })), /STRUCTURAL_VALIDATION_FAILED/);
});

test('missing deterministic tests are rejected by acceptance identity', () => {
  assert.throws(() => compileShadowContract(good({ observedAcceptanceIds: ['AT-B1-001', 'AT-B1-002'] })), /ACCEPTANCE_IDS_MISMATCH/);
});

test('changed decision is rejected by immutable digest', () => {
  assert.throws(() => compileShadowContract(good({ observedDecisionDigest: 'sha256:deadbeef' })), /DECISION_DIGEST_MISMATCH/);
});

test('behavior change cannot bypass specs', () => {
  assert.throws(() => compileShadowContract(good({ skipSpecs: true })), /BEHAVIOR_CHANGE_CANNOT_SKIP_SPECS/);
});

test('missing requirement coverage is rejected', () => {
  assert.throws(() => compileShadowContract(good({ observedRequirementIds: ['REQ-B1-001', 'REQ-B1-002'] })), /REQUIREMENT_IDS_MISMATCH/);
});
