import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageBytes = await readFile(new URL('../bootstrap-package.json', import.meta.url));
const pkg = JSON.parse(packageBytes.toString('utf8'));

test('package is explicitly local, noncanonical, and nondispatching', () => {
  assert.equal(pkg.classification, 'LOCAL_NONCANONICAL_DESIGN_CANDIDATE');
  assert.equal(pkg.status, 'PREPARATION_ONLY_NOT_DISPATCHABLE');
  assert.equal(pkg.readiness.dispatch_allowed, false);
  assert.equal(pkg.readiness.host_mutation_allowed, false);
  assert.equal(pkg.readiness.canonical_mutation_allowed, false);
});

test('the exact current checkpoint cannot authorize the bootstrap', () => {
  assert.equal(pkg.canonical_prestate.control.checkpoint_seq, 191);
  assert.equal(pkg.canonical_prestate.control.execution_fence, null);
  assert.equal(pkg.canonical_prestate.control.authorization_envelope_digest, null);
  assert.ok(pkg.readiness.known_blockers.includes('CP191_EXECUTION_FENCE_MISSING'));
});

test('stale repository capability is a fail-closed blocker', () => {
  assert.equal(pkg.repository_capability_binding.capability_generation, 4);
  assert.notEqual(pkg.repository_capability_binding.mission_revision, pkg.canonical_prestate.mission.revision);
  assert.notEqual(pkg.repository_capability_binding.mission_hash, pkg.canonical_prestate.mission.hash);
  assert.equal(pkg.repository_capability_binding.matches_current_checkpoint_mission, false);
  assert.ok(pkg.readiness.known_blockers.includes('REPOSITORY_SYSTEM_CAPABILITY_MISSION_BINDING_STALE'));
});

test('protected verification is exact-head bound and is not borrowed from a mirror', () => {
  assert.equal(pkg.source_candidate.exact_head_protected_verifier.status, 'NOT_RUN_ON_EXACT_PR308_HEAD');
  assert.equal(pkg.source_candidate.exact_head_protected_verifier.check_run_count, 0);
  assert.equal(pkg.source_candidate.mirror_verifier_transfer, 'PROHIBITED');
  assert.ok(pkg.readiness.known_blockers.includes('EXACT_PR308_HEAD_CSG_TRUSTED_VERIFIER_MISSING'));
});

test('runtime deployment allowlist is exactly the three reviewed observer files', () => {
  assert.deepEqual(pkg.source_candidate.runtime_artifacts.map((a) => a.path), [
    'tools/csg/factory-mcp/broker/hostguard-broker.ps1',
    'tools/csg/factory-mcp/src/index.mjs',
    'tools/csg/factory-mcp/src/orphan-status.mjs',
  ]);
  assert.ok(pkg.source_candidate.runtime_artifacts.every((a) => /^[0-9a-f]{40}$/.test(a.blob_oid)));
  assert.equal(pkg.source_candidate.public_tool_growth_allowed, false);
  assert.deepEqual(pkg.source_candidate.existing_public_tool_surface, [
    'factory_status', 'worker_prepare', 'worker_start', 'host_powershell',
  ]);
});

test('unknown target, script hash, replay enforcement, or runtime capability blocks execution', () => {
  for (const blocker of [
    'RUNTIME_CAPABILITY_READBACK_MISSING',
    'HOST_INSTALL_TARGET_AND_SERVICE_UNBOUND',
    'FIXED_DEPLOYMENT_SCRIPT_BYTES_AND_SHA256_UNBOUND',
    'SINGLE_USE_OPERATION_REPLAY_ENFORCEMENT_UNPROVEN',
  ]) assert.ok(pkg.readiness.known_blockers.includes(blocker), blocker);
  assert.equal(pkg.readiness.dispatch_allowed, false);
});

test('readback does not classify from aggregate counts or identity alone', () => {
  assert.equal(pkg.last_factory_readback.per_record_identity, 'NOT_OBSERVABLE');
  assert.equal(pkg.last_factory_readback.classification, 'NO_RECORD_CLASSIFIED');
  assert.equal(pkg.authority_boundary.current_target_state_and_historical_execution_outcome_must_remain_separate, true);
  assert.ok(pkg.test_vectors.some((v) => v.id === 'TV14_AGGREGATE_COUNT_WITHOUT_RECORD_IDENTITY' && v.expected === 'UNKNOWN'));
  assert.ok(pkg.test_vectors.some((v) => v.id === 'TV15_IDENTITY_WITHOUT_CURRENT_TARGET_AND_HISTORICAL_OUTCOME' && v.expected === 'UNKNOWN'));
});

test('prohibited gates and OP025 unknown remain explicit', () => {
  assert.equal(pkg.readiness.op025, 'UNKNOWN');
  assert.equal(pkg.readiness.op025_redispatch_allowed, false);
  assert.equal(pkg.readiness.cp192_or_jit_creation_allowed, false);
  assert.equal(pkg.readiness.operation027_dispatch_allowed, false);
  for (const action of ['HOST_MUTATION', 'BROKER_OR_RECEIPT_MUTATION', 'OP025_REDISPATCH', 'OPERATION027']) {
    assert.ok(pkg.authority_boundary.forbidden_now.includes(action), action);
  }
});

test('a synthetic fully matched permit can reach review only, never dispatch', () => {
  const vector = pkg.test_vectors.find((v) => v.id === 'TV18_ALL_SYNTHETIC_FUTURE_BINDINGS_MATCH');
  assert.equal(vector.expected, 'REVIEW_ONLY_NEVER_DISPATCH');
  assert.equal(pkg.readiness.dispatch_allowed, false);
  assert.equal(pkg.status, 'PREPARATION_ONLY_NOT_DISPATCHABLE');
});
