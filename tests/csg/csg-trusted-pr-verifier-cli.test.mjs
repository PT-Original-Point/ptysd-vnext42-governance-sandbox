import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const verifier=path.resolve('governance/csg/trust-root/csg-trusted-pr-verifier.mjs');

test('trusted verifier CLI entrypoint executes on this platform',()=>{
  const r=spawnSync(process.execPath,[verifier],{encoding:'utf8'});
  assert.equal(r.status,2);
  const line=(r.stderr||'').trim().split(/\r?\n/).filter(Boolean).at(-1);
  assert.ok(line,'expected verifier failure JSON on stderr');
  const out=JSON.parse(line);
  assert.equal(out.result,'FAIL');
  assert.equal(out.code,'INVALID_BASE_OID');
});
