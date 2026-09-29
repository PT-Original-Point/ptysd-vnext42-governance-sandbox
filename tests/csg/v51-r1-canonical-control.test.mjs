import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL('../../' + p, import.meta.url));
const json = p => JSON.parse(read(p).toString('utf8'));
const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' :
  v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' :
  JSON.stringify(v);
const sha256 = b => 'sha256:' + createHash('sha256').update(b).digest('hex');
const cpDigest = v => { const c = structuredClone(v); delete c.payload_digest; return sha256(Buffer.from(canonical(c), 'utf8')); };
const mission = json('governance/csg/v51/current-mission.json');
const policy = json('governance/csg/v51/current-execution-policy.json');
const run = json('governance/csg/v51/runs/V51-R1-001/run.json');
const cp = json('governance/csg/checkpoints/000193.json');
const pointer = json('governance/csg/current.json');

test('exact Human VNEXT5.1-R1 spec bytes are canonical-path pinned', () => {
  const p = 'governance/csg/v51/specs/VNEXT5.1-R1-HUMAN-CURRENT-SPEC-20260929.md';
  const bytes = read(p);
  const gitBlob = createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex');
  const spec = mission.payload.current_construction_spec;
  assert.equal(bytes.length, 5779);
  assert.equal(sha256(bytes), 'sha256:29e8a4b8685afbbc8531e1a62dee0b5b072f6a28270f11bfbea9d9b6a5378bea');
  assert.equal(gitBlob, '6df4a189c84ff1e53ce4ba0a90ba39eb6334e59a');
  assert.equal(spec.canonical_path, p);
  assert.equal(spec.blob_oid, gitBlob);
  assert.equal(policy.payload.current_construction_spec.sha256, spec.sha256);
});

test('Mission and Execution Policy hash profiles and revisions agree', () => {
  assert.equal(mission.mission_hash, sha256(Buffer.from(canonical(mission.payload), 'utf8')));
  assert.equal(policy.policy_hash_profile, 'RFC8785_CANONICAL_JSON_PAYLOAD_SHA256_V1');
  assert.equal(policy.policy_hash, sha256(Buffer.from(canonical(policy.payload), 'utf8')));
  assert.equal(policy.mission_revision_id, mission.mission_revision_id);
  assert.equal(policy.mission_hash, mission.mission_hash);
  assert.equal(policy.policy_revision_id, mission.mission_revision_id + '-EP73');
});

test('current pointer selects exact CP193 payload digest', () => {
  assert.equal(cp.schema_version, 'csg.checkpoint.v1');
  assert.equal(cp.checkpoint_seq, 193);
  assert.equal(pointer.checkpoint_seq, cp.checkpoint_seq);
  assert.equal(pointer.checkpoint_path, 'governance/csg/checkpoints/000193.json');
  assert.equal(pointer.checkpoint_digest, cpDigest(cp));
  assert.equal(cp.payload_digest, cpDigest(cp));
  assert.equal(pointer.transition_id, cp.transition_id);
  assert.equal(pointer.previous_control_oid.algorithm, 'sha1');
  assert.equal(pointer.previous_control_oid.hex, 'c8991af91c9b220d9de7f282e580655b98122991');
});

test('checkpoint anchors bind the exact Mission, Policy, run and predecessor', () => {
  assert.equal(cp.mission_anchor.revision, mission.mission_revision_id);
  assert.equal(cp.mission_anchor.declared_hash, mission.mission_hash);
  assert.equal(cp.policy_anchor.revision, policy.policy_revision_id);
  assert.equal(cp.policy_anchor.declared_hash, policy.policy_hash);
  assert.equal(cp.previous_checkpoint_ref.revision, 'c8991af91c9b220d9de7f282e580655b98122991');
  assert.equal(cp.previous_checkpoint_ref.path, 'governance/csg/checkpoints/000192.json');
  assert.equal(cp.previous_checkpoint_ref.digest, 'sha256:fc0112e9203a8d9c8a43fa98f427f67c6e0b58aca09c6adcfa260ac6faa274f0');
  assert.equal(cp.previous_checkpoint_ref.revision, 'c8991af91c9b220d9de7f282e580655b98122991');
  assert.equal(cp.mission_anchor.ref, 'github://1352411536/governance/csg/v51/current-mission.json@c8991af91c9b220d9de7f282e580655b98122991');
  assert.equal(cp.policy_anchor.ref, 'github://1352411536/governance/csg/v51/current-execution-policy.json@c8991af91c9b220d9de7f282e580655b98122991');
  assert.equal(cp.run_ref.revision, 'c8991af91c9b220d9de7f282e580655b98122991');
  assert.equal(cp.run_ref.path, 'governance/csg/v51/runs/V51-R1-001/run.json');
  assert.equal(cp.run_ref.digest, sha256(read('governance/csg/v51/runs/V51-R1-001/run.json')));
});

test('all checkpoint evidence refs bind exact source bytes at the staged immutable commit', () => {
  assert.equal(cp.evidence_refs.length, 5);
  for (const ref of cp.evidence_refs) { assert.equal(ref.revision, 'c8991af91c9b220d9de7f282e580655b98122991'); assert.equal(ref.digest, sha256(read(ref.path))); }
});

test('one active task and attempt resolve through checkpoint and run', () => {
  assert.equal(cp.run_ref.revision, cp.mission_anchor.ref.split('@').pop());
  assert.equal(cp.policy_anchor.ref.split('@').pop(), cp.run_ref.revision);
  assert.equal(cp.mission_anchor.ref.split('@').pop(), cp.run_ref.revision);
  assert.equal(cp.task_id, cp.atomic.unit_id);
  assert.equal(cp.task_id, run.active_task_id);
  assert.equal(cp.attempt_id, run.attempt_id);
  assert.equal(cp.attempt_epoch, run.attempt_epoch);
  assert.equal(mission.payload.active_unit, cp.task_id);
  assert.equal(policy.payload.active_unit, cp.task_id);
  assert.equal(run.run_id, 'V51-R1-001');
  assert.equal(run.latest_checkpoint_ref, null);
  assert.equal(run.unresolved_operation_ids.length, 0);
  assert.equal(cp.unresolved_effect_refs.length, 0);
});

test('R1 rebase preserves production, cost, business and four-tool boundaries', () => {
  assert.equal(mission.payload.authorization.production_allowed, false);
  assert.equal(mission.payload.authorization.business_project_auto_admission, false);
  assert.equal(mission.payload.authorization.paid_fallback_allowed, false);
  assert.equal(policy.payload.project_controls.production_allowed, false);
  assert.equal(policy.payload.project_controls.business_project_auto_admission, false);
  assert.equal(policy.payload.project_controls.paid_fallback_allowed, false);
  assert.equal(policy.payload.factory_mcp.public_tool_count, 4);
  assert.equal(policy.payload.factory_mcp.trusted_caller.shared_network_service_sid_alone_sufficient, false);
  assert.equal(cp.stop_requested, false);
  assert.equal(cp.atomic.execution_fence, null);
});
