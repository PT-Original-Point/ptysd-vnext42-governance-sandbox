import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPathSet} from './csg-trusted-pr-verifier.mjs';

function expectForbidden(path,baseRef='main'){
  assert.throws(
    ()=>verifyPathSet([path],{baseRef}),
    (error)=>error?.code==='TRUST_ROOT_OR_AUTHORITY_CHANGE_FORBIDDEN',
    path,
  );
}

test('ordinary candidate cannot add or modify any workflow path',()=>{
  expectForbidden('.github/workflows/factory-bounded.yml');
  expectForbidden('.github/workflows/new-untrusted-workflow.yml');
  expectForbidden('.github/workflows/subdir/escape.yml');
});

test('ordinary candidate cannot modify trust-root or trust-template',()=>{
  expectForbidden('governance/csg/trust-root/csg-trusted-pr-verifier.mjs');
  expectForbidden('governance/csg/trust-template/example.json');
});

test('ordinary non-trust source path remains admissible on main',()=>{
  const out=verifyPathSet(['tools/csg/factory-mcp/src/index.mjs'],{baseRef:'main'});
  assert.equal(out.count,1);
});
