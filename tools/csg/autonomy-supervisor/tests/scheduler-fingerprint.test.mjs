import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNextUnit,goalMayBeBlocked} from '../scheduler.mjs';
import {durableFingerprint} from '../fingerprint.mjs';

test('WAITING_EXTERNAL yields to READY',()=>{
  const r=selectNextUnit([{id:'A',state:'WAITING_EXTERNAL',priority:1},{id:'B',state:'READY',priority:5}]);
  assert.deepEqual(r,{decision:'DISPATCH',unit:'B'});
  assert.equal(goalMayBeBlocked([{id:'A',state:'WAITING_EXTERNAL'},{id:'B',state:'READY'}]),false);
});

test('highest-priority READY wins deterministically',()=>{
  assert.equal(selectNextUnit([{id:'Z',state:'READY',priority:2},{id:'A',state:'READY',priority:1}]).unit,'A');
});

test('one RUNNING unit owns the executor slot',()=>{
  assert.deepEqual(selectNextUnit([{id:'A',state:'RUNNING'},{id:'B',state:'READY'}]),{decision:'KEEP_RUNNING',unit:'A'});
});

test('multiple RUNNING is an invariant violation',()=>{
  assert.equal(selectNextUnit([{id:'A',state:'RUNNING'},{id:'B',state:'RUNNING'}]).decision,'INVARIANT_VIOLATION');
});

test('same semantic fingerprint is order independent',()=>{
  const a={project_id:'P',directory:{head:'d'},control:{head:'c'},checkpoint:{digest:'x'},run:{id:'r'},accepted_source:{head:'a'},mailbox:{id:1},factory:{orphan_count:5}};
  const b={factory:{orphan_count:5},mailbox:{id:1},accepted_source:{head:'a'},run:{id:'r'},checkpoint:{digest:'x'},control:{head:'c'},directory:{head:'d'},project_id:'P'};
  assert.equal(durableFingerprint(a).digest,durableFingerprint(b).digest);
});

test('provider delta changes fingerprint',()=>{
  const x={project_id:'P',directory:{head:'d'},control:{head:'c'},checkpoint:{digest:'x'},run:{id:'r'},accepted_source:{head:'a'},mailbox:{id:1},factory:{orphan_count:5}};
  const y=structuredClone(x);y.mailbox.id=2;
  assert.notEqual(durableFingerprint(x).digest,durableFingerprint(y).digest);
});

