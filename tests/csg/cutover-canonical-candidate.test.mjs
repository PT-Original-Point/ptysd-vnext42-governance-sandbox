import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateCsg } from '../../scripts/csg-schema.mjs';

const json = (relativePath) => JSON.parse(fs.readFileSync(new URL('../../' + relativePath, import.meta.url), 'utf8'));

test('CSG-09B canonical control candidate is migration-prepared and preserves W47-06 trust gate', () => {
  const checkpoint9 = json('governance/csg/checkpoints/000009.json');
  const pointer = json('governance/csg/current.json');
  const contract = json('governance/csg/migration/w47-06-explicit-task-contract-v1.json');
  const expectedCurrentPath = `governance/csg/checkpoints/${String(pointer.checkpoint_seq).padStart(6, '0')}.json`;

  assert.equal(pointer.checkpoint_path, expectedCurrentPath);
  const currentCheckpoint = json(expectedCurrentPath);

  validateCsg(checkpoint9, { selfPath: 'governance/csg/checkpoints/000009.json' });
  validateCsg(pointer);

  assert.equal(checkpoint9.checkpoint_seq, 9);
  assert.equal(checkpoint9.barrier, 'ACTIVE_UNIT');
  assert.equal(checkpoint9.event.type, 'ATOMIC_STARTED');
  assert.equal(checkpoint9.next_legal_transition.action, 'GUARDED_CAS_CONTROL_THEN_BIND_DIRECTORY');
  assert.deepEqual(checkpoint9.unresolved_effect_refs, []);
  assert.equal(pointer.binding_generation, 2);
  assert.equal(pointer.binding_id, 'CSG-GOVERNANCE-BINDING-V2');
  assert.equal(pointer.checkpoint_seq, currentCheckpoint.checkpoint_seq);
  assert.equal(pointer.checkpoint_digest, currentCheckpoint.payload_digest);
  assert.equal(contract.task_id, 'W47-06');
  assert.equal(contract.authorization.host_vm_execution_authorized, false);
  assert.equal(contract.authorization.trust_gate_required, 'HG47-TRUST');
});