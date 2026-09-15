import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}

export function digestJson(value) {
  const text = JSON.stringify(stable(value));
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function requireExactIds(label, observed, expected) {
  if (!Array.isArray(observed)) throw new Error(`${label}_MISSING`);
  const a = [...observed].sort();
  const b = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label}_MISMATCH`);
}

export function expectedDigests(frozenInput) {
  return {
    decision_digest: digestJson({ decision_id: frozenInput.decision_id, decision: frozenInput.decision }),
    requirements_digest: digestJson(frozenInput.requirements),
    source_input_digest: digestJson(frozenInput)
  };
}

export function compileShadowContract(input) {
  const {
    frozenInput, structuralValidation, observedDecisionDigest,
    observedRequirementIds, observedAcceptanceIds,
    skipSpecs = false, behaviorChange = true, authority
  } = input;
  if (!frozenInput || !authority) throw new Error('COMPILER_INPUT_MISSING');
  const totals = structuralValidation?.summary?.totals;
  if (!totals || totals.items < 1 || totals.failed !== 0 ||
      structuralValidation.items?.some(item => item.valid !== true)) {
    throw new Error('STRUCTURAL_VALIDATION_FAILED');
  }
  if (behaviorChange && skipSpecs) throw new Error('BEHAVIOR_CHANGE_CANNOT_SKIP_SPECS');
  if (frozenInput.task_limit > 12) throw new Error('TASK_LIMIT_EXCEEDED');
  if (frozenInput.attempt_limit > 3) throw new Error('ATTEMPT_LIMIT_EXCEEDED');

  const digests = expectedDigests(frozenInput);
  if (observedDecisionDigest !== digests.decision_digest) throw new Error('DECISION_DIGEST_MISMATCH');
  const requirementIds = frozenInput.requirements.map(r => r.id);
  requireExactIds('REQUIREMENT_IDS', observedRequirementIds, requirementIds);
  requireExactIds('ACCEPTANCE_IDS', observedAcceptanceIds, frozenInput.acceptance_ids);

  const requirementTexts = frozenInput.requirements.map(r => `${r.id}: ${r.text}`);
  return {
    schema_version: 'factory.contract.v1',
    contract_id: 'WP46-09-SHADOW-CONTRACT-B1-001',
    task_id: 'WP46-09-B1-RETRY-POLICY-001',
    project_id: authority.project_id,
    goal: frozenInput.decision,
    include: [...frozenInput.scope, 'immutable decision/requirements binding', 'deterministic acceptance mapping'],
    exclude: [...frozenInput.non_goals, 'second task authority', 'OpenSpec checkbox as canonical state'],
    affected_surfaces: ['WP46_09_DISPOSABLE_BROWNFIELD_SHADOW'],
    requirements: requirementTexts,
    acceptance: [...frozenInput.acceptance_ids],
    dependencies: ['WP46-08C:PASS'],
    risk: 'LOW_SYNTHETIC_SPEC_LAYER_SHADOW',
    allowed_tools: ['OpenSpec v1.13.0 pinned shadow validator', 'Node.js deterministic compiler'],
    allowed_effects: ['disposable shadow files only', 'governance evidence candidate only'],
    max_attempts: frozenInput.attempt_limit,
    time_budget_minutes: 60,
    mission_revision_id: authority.mission_revision_id,
    mission_hash: authority.mission_hash,
    policy_revision_id: authority.policy_revision_id,
    policy_hash: authority.policy_hash,
    decision_ref: `decision://${frozenInput.decision_id}`,
    decision_digest: digests.decision_digest,
    requirements_digest: digests.requirements_digest,
    source_input_digest: digests.source_input_digest,
    spec_projection_ref: `shadow://wp46-09/${frozenInput.change_id}`,
    task_projection_authoritative: false,
    open_spec_checkbox_state_ignored: true,
    second_task_state_created: false
  };
}
