import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_TASKS, MAX_ATTEMPTS, validateBoundedContract} from '../tools/csg/cell-kernel/production-kernel.mjs';
import '../tools/csg/cell-kernel/tests/mutation-supervisor.test.mjs';
import '../tools/csg/cell-kernel/tests/d5-completion-fence.test.mjs';
import '../tools/csg/cell-kernel/tests/status-projection.test.mjs';
import '../tools/csg/cell-kernel/tests/verifier-binding.test.mjs';
import '../tools/csg/cell-kernel/tests/n1-e2e.test.mjs';
import './csg/d15-legacy-reachability.test.mjs';

const contract=(n=1)=>({schema_version:'factory.contract.v1',contract_id:'C-D15-COMPAT',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',revision:1,tasks:Array.from({length:n},(_,i)=>({task_id:`T-${i+1}`,max_attempts:MAX_ATTEMPTS}))});
test('D15 legacy contract compatibility validator preserves bounded schema',()=>{
  assert.equal(validateBoundedContract(contract()),true);
  assert.throws(()=>validateBoundedContract({...contract(),schema_version:'other'}),/FORMAL_CONTRACT_REQUIRED/);
  assert.throws(()=>validateBoundedContract(contract(MAX_TASKS+1)),/INVALID_TASK_COUNT/);
  assert.throws(()=>validateBoundedContract({...contract(),tasks:[{task_id:'T',max_attempts:MAX_ATTEMPTS+1}]}),/INVALID_MAX_ATTEMPTS/);
  assert.throws(()=>validateBoundedContract({...contract(),tasks:[{task_id:'T'},{task_id:'T'}]}),/DUPLICATE_TASK_ID/);
});
