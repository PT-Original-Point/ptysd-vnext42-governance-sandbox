import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildGovernanceShadow,stableJson} from '../../scripts/csg-migration-shadow.mjs';
test('exact provider observation rebuilds the committed shadow byte identically',()=>{
  const input=JSON.parse(fs.readFileSync(new URL('../../artifacts/csg/csg-09a-provider-read-window.json',import.meta.url),'utf8'));
  const expected=fs.readFileSync(new URL('../../governance/csg/migration/governance-shadow-anchor.v1.json',import.meta.url),'utf8');
  const actual=stableJson(buildGovernanceShadow(input))+'\n';
  assert.equal(actual,expected);
});
