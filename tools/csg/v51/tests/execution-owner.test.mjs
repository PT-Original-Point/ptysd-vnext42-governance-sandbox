import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptHandoff,
  authorizeWrite,
  createOwnershipRecord,
  executeOwnedWrite,
  reclaimByChat,
  releaseOwnership,
  sealHandoff,
} from '../execution-owner.mjs';

const BASE = '1111111111111111111111111111111111111111';
const EVIDENCE = 'sha256:' + 'a'.repeat(64);
const UNIT = 'V51-01-EXECUTION-OWNERSHIP-ANTI-DOUBLE-WRITER-CANDIDATE';

function makeRecord(
  pathSet = ['tools/csg/v51/execution-owner.mjs', 'tools/csg/v51/tests/execution-owner.test.mjs'],
  atomicUnitId = UNIT,
) {
  return createOwnershipRecord({
    atomicUnitId,
    owner: 'CHAT',
    ownerEpoch: 1,
    scope: {
      projectId: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
      repository: 'PT-Original-Point/ptysd-vnext42-governance-sandbox',
      branchRef: 'codex/v51-execution-ownership-candidate',
      baseHead: BASE,
      pathSet,
      writeSurface: 'REPOSITORY_PATH_SET',
    },
  });
}

function preconditions(record) {
  return {
    expectedOwnerEpoch: record.ownerEpoch,
    expectedRevision: record.revision,
    expectedScopeDigest: record.scopeDigest,
  };
}

function write(record, actor, overrides = {}) {
  return authorizeWrite(record, {
    ...preconditions(record),
    actor,
    branchRef: record.exactScope.branchRef,
    observedHead: record.currentHead,
    changedPaths: [record.exactScope.pathSet[0]],
    ...overrides,
  });
}

function writeArgs(record, actor, overrides = {}) {
  return {
    ...preconditions(record),
    actor,
    branchRef: record.exactScope.branchRef,
    observedHead: record.currentHead,
    changedPaths: [record.exactScope.pathSet[0]],
    ...overrides,
  };
}

function expectCode(code, action) {
  assert.throws(action, (error) => error?.code === code, 'expected ' + code);
}

function transfer(record, targetOwner) {
  const sealed = sealHandoff(record, {
    ...preconditions(record),
    actor: record.owner,
    targetOwner,
  });
  const accepted = acceptHandoff(sealed, {
    ...preconditions(sealed),
    actor: targetOwner,
  });
  return { sealed, accepted };
}

test('scope identity is deterministic and requires a canonical exact path set', () => {
  const a = makeRecord(['tools/csg/v51/tests/execution-owner.test.mjs', 'tools/csg/v51/execution-owner.mjs']);
  const b = makeRecord(['tools/csg/v51/execution-owner.mjs', 'tools/csg/v51/tests/execution-owner.test.mjs']);
  assert.equal(a.scopeDigest, b.scopeDigest);
  assert.deepEqual(a.exactScope.pathSet, [...a.exactScope.pathSet].sort());
  assert.notEqual(a.scopeDigest, makeRecord(undefined, UNIT + '-OTHER').scopeDigest);
  expectCode('INVALID_SCOPE_PATH', () => makeRecord(['/absolute/path.mjs']));
  expectCode('INVALID_SCOPE_PATH', () => makeRecord(['../escape.mjs']));
  expectCode('INVALID_SCOPE_PATH', () => makeRecord(['tools\\csg\\v51\\escape.mjs']));
  expectCode('DUPLICATE_SCOPE_PATH', () => makeRecord(['tools/csg/v51/a.mjs', 'tools/csg/v51/a.mjs']));
  expectCode('EMPTY_WRITE_SURFACE', () => makeRecord({ not: 'an array' }));
  expectCode('UNKNOWN_SCOPE_FIELD', () => createOwnershipRecord({
    atomicUnitId: UNIT,
    scope: {
      projectId: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE',
      repository: 'PT-Original-Point/ptysd-vnext42-governance-sandbox',
      branchRef: 'codex/v51-execution-ownership-candidate',
      baseHead: BASE,
      pathSet: ['tools/csg/v51/a.mjs'],
      writeSurface: 'REPOSITORY_PATH_SET',
      authority: 'CANONICAL',
    },
  }));
});

test('CHAT_PREPARES grants only the CHAT owner an exact path-set write proposal', () => {
  const record = makeRecord();
  assert.equal(record.handoffState, 'CHAT_PREPARES');
  assert.equal(write(record, 'CHAT').decision, 'CAS_REQUIRED');
  expectCode('NOT_CURRENT_OWNER', () => write(record, 'CODEX'));
  expectCode('WRITE_OUTSIDE_EXACT_SCOPE', () => write(record, 'CHAT', {
    changedPaths: ['governance/csg/current.json'],
  }));
  expectCode('BRANCH_SCOPE_MISMATCH', () => write(record, 'CHAT', {
    branchRef: 'main',
  }));
  expectCode('STALE_SOURCE_HEAD', () => write(record, 'CHAT', {
    observedHead: '2222222222222222222222222222222222222222',
  }));
  expectCode('DUPLICATE_WRITE_PATH', () => write(record, 'CHAT', {
    changedPaths: [record.exactScope.pathSet[0], record.exactScope.pathSet[0]],
  }));
});

test('unknown record fields and noncanonical embedded scopes fail closed', () => {
  const record = makeRecord();
  expectCode('INVALID_OWNERSHIP_RECORD_FIELDS', () => write({ ...record, futureAuthority: true }, 'CHAT'));

  const noncanonical = {
    ...record,
    exactScope: { ...record.exactScope, pathSet: [...record.exactScope.pathSet].reverse() },
  };
  expectCode('NONCANONICAL_OWNERSHIP_SCOPE', () => write(noncanonical, 'CHAT'));
});

test('HANDOFF_SEALED yields the executor slot before CODEX claims the new epoch', () => {
  const chat = makeRecord();
  const sealed = sealHandoff(chat, {
    ...preconditions(chat),
    actor: 'CHAT',
    targetOwner: 'CODEX',
  });
  assert.equal(sealed.handoffState, 'HANDOFF_SEALED');
  assert.equal(sealed.owner, null);
  assert.equal(sealed.pendingOwner, 'CODEX');

  expectCode('NO_ACTIVE_WRITE_OWNER', () => write(sealed, 'CHAT'));
  expectCode('NO_ACTIVE_WRITE_OWNER', () => write(sealed, 'CODEX'));

  const codex = acceptHandoff(sealed, {
    ...preconditions(sealed),
    actor: 'CODEX',
  });
  assert.equal(codex.handoffState, 'CODEX_OWNS');
  assert.equal(codex.owner, 'CODEX');
  assert.equal(codex.ownerEpoch, 2);
  assert.equal(write(codex, 'CODEX').decision, 'CAS_REQUIRED');
  expectCode('NOT_CURRENT_OWNER', () => write(codex, 'CHAT'));
});

test('stale owner epochs, revisions, and handoff digests fail closed', () => {
  const chat = makeRecord();
  const { accepted: codex } = transfer(chat, 'CODEX');
  expectCode('STALE_OWNER_EPOCH', () => write(codex, 'CODEX', { expectedOwnerEpoch: 1 }));
  expectCode('STALE_RECORD_REVISION', () => write(codex, 'CODEX', { expectedRevision: 1 }));
  expectCode('SCOPE_DIGEST_MISMATCH', () => write(codex, 'CODEX', {
    expectedScopeDigest: 'sha256:' + 'b'.repeat(64),
  }));
  expectCode('NOT_SEALED_RECEIVER', () => acceptHandoff(
    sealHandoff(chat, {
      ...preconditions(chat),
      actor: 'CHAT',
      targetOwner: 'CODEX',
    }),
    {
      actor: 'CI',
      expectedOwnerEpoch: 1,
      expectedRevision: 1,
      expectedScopeDigest: chat.scopeDigest,
    },
  ));
});

test('release blocks stale CODEX writes and CHAT requires matching same-source readback', () => {
  const { accepted: codex } = transfer(makeRecord(), 'CODEX');
  const released = releaseOwnership(codex, {
    ...preconditions(codex),
    actor: 'CODEX',
  });
  assert.equal(released.handoffState, 'CODEX_RELEASED');
  assert.equal(released.owner, null);
  expectCode('NO_ACTIVE_WRITE_OWNER', () => write(released, 'CODEX'));

  const goodReadback = {
    sourceRef: released.exactScope.branchRef,
    head: released.currentHead,
    scopeDigest: released.scopeDigest,
    afterOwnershipRevision: released.releaseRevision,
    evidenceDigest: EVIDENCE,
  };
  expectCode('READBACK_HEAD_MISMATCH', () => reclaimByChat(released, {
    ...preconditions(released),
    actor: 'CHAT',
    sameSourceReadback: { ...goodReadback, head: '2222222222222222222222222222222222222222' },
  }));
  expectCode('READBACK_REF_MISMATCH', () => reclaimByChat(released, {
    ...preconditions(released),
    actor: 'CHAT',
    sameSourceReadback: { ...goodReadback, sourceRef: 'main' },
  }));
  expectCode('READBACK_NOT_AFTER_RELEASE', () => reclaimByChat(released, {
    ...preconditions(released),
    actor: 'CHAT',
    sameSourceReadback: { ...goodReadback, afterOwnershipRevision: released.revision - 1 },
  }));
  expectCode('INVALID_SAME_SOURCE_READBACK_FIELDS', () => reclaimByChat(released, {
    ...preconditions(released),
    actor: 'CHAT',
    sameSourceReadback: { ...goodReadback, claimedCanonical: true },
  }));

  const reclaimed = reclaimByChat(released, {
    ...preconditions(released),
    actor: 'CHAT',
    sameSourceReadback: goodReadback,
  });
  assert.equal(reclaimed.handoffState, 'CHAT_RECLAIMS');
  assert.equal(reclaimed.owner, 'CHAT');
  assert.equal(reclaimed.ownerEpoch, 3);
  assert.equal(write(reclaimed, 'CHAT').decision, 'CAS_REQUIRED');
  expectCode('STALE_OWNER_EPOCH', () => write(reclaimed, 'CODEX', { expectedOwnerEpoch: 2 }));
});

test('all declared executor classes require a sealed transfer and receive a new epoch', () => {
  for (const owner of ['HOST_SUPERVISOR', 'CI']) {
    const { sealed, accepted } = transfer(makeRecord(), owner);
    assert.equal(sealed.owner, null);
    assert.equal(accepted.owner, owner);
    assert.equal(accepted.handoffState, owner + '_OWNS');
    assert.equal(accepted.ownerEpoch, 2);
    assert.equal(write(accepted, owner).decision, 'CAS_REQUIRED');
    expectCode('NOT_CURRENT_OWNER', () => write(accepted, 'CHAT'));
  }
});

test('provider CAS serializes concurrent writers and same-source readback advances the owned head', async () => {
  const { accepted: codex } = transfer(makeRecord(), 'CODEX');
  const providerState = { record: structuredClone(codex), serial: 2 };
  const provider = {
    async compareAndSwapWrite(proposal) {
      const current = providerState.record;
      if (
        proposal.atomicUnitId !== current.atomicUnitId ||
        proposal.ownerEpoch !== current.ownerEpoch ||
        proposal.expectedRecordRevision !== current.revision ||
        proposal.expectedHead !== current.currentHead ||
        proposal.scopeDigest !== current.scopeDigest ||
        proposal.actor !== current.owner
      ) {
        return {
          decision: 'CAS_CONFLICT',
          atomicUnitId: proposal.atomicUnitId,
          ownerEpoch: proposal.ownerEpoch,
          expectedRecordRevision: proposal.expectedRecordRevision,
          parentHead: proposal.expectedHead,
          head: current.currentHead,
          scopeDigest: proposal.scopeDigest,
          afterOwnershipRevision: current.revision,
        };
      }

      const parentHead = current.currentHead;
      const head = String(providerState.serial++).padStart(40, '0');
      const afterOwnershipRevision = current.revision + 1;
      const readback = {
        atomicUnitId: current.atomicUnitId,
        owner: current.owner,
        ownerEpoch: current.ownerEpoch,
        handoffState: current.handoffState,
        sourceRef: current.exactScope.branchRef,
        parentHead,
        head,
        scopeDigest: current.scopeDigest,
        afterOwnershipRevision,
        changedPaths: [...proposal.changedPaths],
        evidenceDigest: EVIDENCE,
      };
      providerState.record = {
        ...current,
        currentHead: head,
        revision: afterOwnershipRevision,
        lastWriteReadback: readback,
      };
      return {
        decision: 'CAS_APPLIED',
        atomicUnitId: proposal.atomicUnitId,
        ownerEpoch: proposal.ownerEpoch,
        expectedRecordRevision: proposal.expectedRecordRevision,
        parentHead,
        head,
        scopeDigest: proposal.scopeDigest,
        afterOwnershipRevision,
      };
    },
    async readSameSource() {
      return structuredClone(providerState.record.lastWriteReadback);
    },
  };

  const staleArgs = writeArgs(codex, 'CODEX');
  const outcomes = await Promise.allSettled([
    executeOwnedWrite(codex, staleArgs, provider),
    executeOwnedWrite(codex, staleArgs, provider),
  ]);
  const successes = outcomes.filter((item) => item.status === 'fulfilled');
  const failures = outcomes.filter((item) => item.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason?.code, 'PROVIDER_CAS_CONFLICT');
  assert.equal(successes[0].value.currentHead, providerState.record.currentHead);
  assert.equal(successes[0].value.revision, codex.revision + 1);
  assert.equal(successes[0].value.lastWriteReadback.parentHead, codex.currentHead);

  const next = await executeOwnedWrite(
    successes[0].value,
    writeArgs(successes[0].value, 'CODEX'),
    provider,
  );
  assert.equal(next.currentHead, providerState.record.currentHead);
  assert.equal(next.revision, codex.revision + 2);
});

test('an applied write without matching same-source readback remains unconfirmed', async () => {
  const { accepted: codex } = transfer(makeRecord(), 'CODEX');
  const provider = {
    async compareAndSwapWrite(proposal) {
      return {
        decision: 'CAS_APPLIED',
        atomicUnitId: proposal.atomicUnitId,
        ownerEpoch: proposal.ownerEpoch,
        expectedRecordRevision: proposal.expectedRecordRevision,
        parentHead: proposal.expectedHead,
        head: '2222222222222222222222222222222222222222',
        scopeDigest: proposal.scopeDigest,
        afterOwnershipRevision: proposal.expectedRecordRevision + 1,
      };
    },
    async readSameSource() {
      return {
        atomicUnitId: codex.atomicUnitId,
        owner: codex.owner,
        ownerEpoch: codex.ownerEpoch,
        handoffState: codex.handoffState,
        sourceRef: codex.exactScope.branchRef,
        parentHead: codex.currentHead,
        head: '3333333333333333333333333333333333333333',
        scopeDigest: codex.scopeDigest,
        afterOwnershipRevision: codex.revision + 1,
        changedPaths: [codex.exactScope.pathSet[0]],
        evidenceDigest: EVIDENCE,
      };
    },
  };
  await assert.rejects(
    executeOwnedWrite(codex, writeArgs(codex, 'CODEX'), provider),
    (error) => error?.code === 'WRITE_APPLIED_READBACK_UNCONFIRMED',
  );
});

test('owned writes fail closed when no provider CAS and same-source readback adapter exists', async () => {
  const { accepted: codex } = transfer(makeRecord(), 'CODEX');
  await assert.rejects(
    executeOwnedWrite(codex, writeArgs(codex, 'CODEX'), null),
    (error) => error?.code === 'PROVIDER_CAS_ADAPTER_REQUIRED',
  );
});

test('provider adapter failure is an unknown effect and is never retried here', async () => {
  const { accepted: codex } = transfer(makeRecord(), 'CODEX');
  let dispatches = 0;
  let readbacks = 0;
  const provider = {
    async compareAndSwapWrite() {
      dispatches += 1;
      throw new Error('transport interrupted after dispatch');
    },
    async readSameSource() {
      readbacks += 1;
      return null;
    },
  };
  await assert.rejects(
    executeOwnedWrite(codex, writeArgs(codex, 'CODEX'), provider),
    (error) => error?.code === 'WRITE_EFFECT_OUTCOME_UNKNOWN',
  );
  assert.equal(dispatches, 1);
  assert.equal(readbacks, 0);
});
