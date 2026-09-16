import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateBoundedContract} from '../../scripts/v46-bounded-driver.mjs';
import {V47_SCHEMA,CANONICALIZER_VERSION,MAX_ACTIVE_WINDOW,compileTaskGraph,validateVersionedContract,parseContractJson,assertCandidatePromotionBinding,consumeRootBudget,assertReplanPreservesRequirements} from '../../scripts/v47-task-graph.mjs';

const D='sha256:'+'a'.repeat(64), D2='sha256:'+'b'.repeat(64), G='1'.repeat(40), T='2'.repeat(40);
const ctx={admittedProjectId:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',currentSpecDigest:D};
function task(id,root='ROOT-1',deps=[],path=`src/${id}.mjs`,reqs=['R-001']) { return {
  task_id:id,root_task_id:root,depends_on:deps,owned_paths:[path],read_paths:['README.md'],forbidden_paths:['secrets/deny.txt'],
  shared_interfaces:[],requirement_ids:reqs,acceptance_case_ids:[`AC-${id}`],data_class:'SYNTHETIC',risk_class:'LOW',model_profile_id:'MUSE-FREE',
  resource_request:{cpu_millis:1000,memory_mib:256,pids:64,disk_mib:512,network_mode:'DENY',api_calls:0},
  expected_artifacts:[{path:`out/${id}.json`,kind:'FILE',max_bytes:65536}],review_policy:'FRESH_REQUIRED',merge_policy:'SERIAL_INTEGRATOR',timeout_seconds:600
}; }
function contract(tasks=[task('T1'),task('T2','ROOT-1',['T1'])],active=['T1','T2']) { return {
  schema_version:V47_SCHEMA,canonicalizer_version:CANONICALIZER_VERSION,contract_id:'C47-1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',run_id:'V47-CONSTRUCTION-001',revision:1,
  plan_id:'PLAN-1',spec_revision:1,spec_digest:D,base_commit:G,base_tree:T,tasks,active_window_task_ids:active,root_budgets:[{root_task_id:'ROOT-1',max_candidates:3,max_replans:1}]
}; }
function clone(v){return structuredClone(v);}
test('valid finite DAG compiles and materializes inherited bindings',()=>{
  const g=compileTaskGraph(contract(),ctx); assert.deepEqual(g.topological_order,['T1','T2']); assert.equal(g.active_window.length,2); assert.equal(g.tasks[1].contract_digest,g.contract_digest); assert.equal(g.tasks[1].spec_digest,D);
});
test('schema artifact is closed and pins active window to 12',()=>{
  const s=JSON.parse(fs.readFileSync(new URL('../../schemas/v47/contract.schema.json',import.meta.url),'utf8')); assert.equal(s.additionalProperties,false); assert.equal(s.properties.active_window_task_ids.maxItems,MAX_ACTIVE_WINDOW); assert.equal(s.properties.tasks.maxItems,96);
});
test('active window over 12 is rejected',()=>{
  const tasks=Array.from({length:13},(_,i)=>task(`T${i+1}`,`R${i+1}`,[],`src/f${i}.mjs`)); const c=contract(tasks,tasks.map(t=>t.task_id)); c.root_budgets=tasks.map(t=>({root_task_id:t.root_task_id,max_candidates:3,max_replans:1})); assert.throws(()=>compileTaskGraph(c,ctx),/INVALID_ACTIVE_WINDOW/);
});
test('total plan over 96 is rejected before dispatch',()=>{
  const tasks=Array.from({length:97},(_,i)=>task(`T${i+1}`,`R${i+1}`,[],`src/f${i}.mjs`)); const c=contract(tasks,['T1']); c.root_budgets=tasks.map(t=>({root_task_id:t.root_task_id,max_candidates:3,max_replans:1})); assert.throws(()=>compileTaskGraph(c,ctx),/INVALID_PLAN_TASK_COUNT/);
});
test('duplicate JSON keys are rejected before JSON.parse authority',()=>{
  assert.throws(()=>parseContractJson('{"schema_version":"factory.contract.v47","schema_version":"x"}'),/DUPLICATE_JSON_KEY:schema_version/);
});
test('dependency cycle is rejected',()=>{
  const c=contract([task('T1','ROOT-1',['T2']),task('T2','ROOT-1',['T1'])]); assert.throws(()=>compileTaskGraph(c,ctx),/DEPENDENCY_CYCLE/);
});
test('path traversal and absolute paths are rejected',()=>{
  for(const p of ['../escape.txt','/etc/passwd','C:/Windows/system.ini']){ const c=contract([task('T1','ROOT-1',[],p)],['T1']); assert.throws(()=>compileTaskGraph(c,ctx),/PATH_ESCAPE/); }
});
test('V47-F24 Windows case aliases and reserved names are rejected',()=>{
  const c=contract([task('T1','ROOT-1',[],'Src/Foo.txt'),task('T2','ROOT-1',[],'src/foo.txt')]); assert.throws(()=>compileTaskGraph(c,ctx),/PATH_OWNERSHIP_COLLISION/);
  const r=contract([task('T1','ROOT-1',[],'out/CON.txt')],['T1']); assert.throws(()=>compileTaskGraph(r,ctx),/WINDOWS_PATH_COLLISION/);
});
test('unknown contract and task fields fail closed',()=>{
  const c=contract(); c.ignored='no'; assert.throws(()=>compileTaskGraph(c,ctx),/ILLEGAL_FIELD:ignored/); const d=contract(); d.tasks[0].mystery=true; assert.throws(()=>compileTaskGraph(d,ctx),/ILLEGAL_FIELD:mystery/);
});
test('V47-F07 unadmitted project receives zero compilable work',()=>{
  assert.throws(()=>compileTaskGraph(contract(),{...ctx,admittedProjectId:'EXAMPLE_PROJECT'}),/PROJECT_NOT_ADMITTED/);
});
test('V47-F05 spec changes fence compilation and promotion',()=>{
  assert.throws(()=>compileTaskGraph(contract(),{...ctx,currentSpecDigest:D2}),/STALE_SPEC_DIGEST/);
  const g=compileTaskGraph(contract(),ctx); assert.throws(()=>assertCandidatePromotionBinding(g,{candidateContractDigest:g.contract_digest,candidateSpecDigest:D,currentSpecDigest:D2}),/STALE_CANDIDATE_SPEC/);
  assert.equal(assertCandidatePromotionBinding(g,{candidateContractDigest:g.contract_digest,candidateSpecDigest:D,currentSpecDigest:D}),true);
});
test('unsafe integer and illegal JSON token fail before hashing',()=>{
  assert.throws(()=>parseContractJson('{"n":9007199254740993}'),/UNSAFE_INTEGER/); assert.throws(()=>parseContractJson('{"n":NaN}'),/INVALID_JSON_TOKEN/);
});
test('V47-F46 root budget cannot be reset by new session or task aliases',()=>{
  const g=compileTaskGraph(contract(),ctx); let ledger={};
  ledger=consumeRootBudget(ledger,g,{root_task_id:'ROOT-1',candidate_delta:1}); ledger=consumeRootBudget(ledger,g,{root_task_id:'ROOT-1',candidate_delta:1}); ledger=consumeRootBudget(ledger,g,{root_task_id:'ROOT-1',candidate_delta:1});
  assert.equal(ledger['ROOT-1'].candidates_used,3); assert.throws(()=>consumeRootBudget(ledger,g,{root_task_id:'ROOT-1',candidate_delta:1}),/ROOT_BUDGET_EXHAUSTED/);
  ledger=consumeRootBudget(ledger,g,{root_task_id:'ROOT-1',replan_delta:1}); assert.throws(()=>consumeRootBudget(ledger,g,{root_task_id:'ROOT-1',replan_delta:1}),/ROOT_BUDGET_EXHAUSTED/);
});
test('V47-F49 replan cannot remove required clauses',()=>{
  const original=compileTaskGraph(contract(),ctx), changed=contract(); changed.revision=2; changed.tasks[0].requirement_ids=[];
  assert.throws(()=>assertReplanPreservesRequirements(original,changed,ctx),/REQUIREMENT_IDS_REQUIRED|REPLAN_REMOVED_REQUIREMENT/);
  const changed2=contract(); changed2.revision=2; changed2.tasks[0].requirement_ids=['R-999']; changed2.tasks[1].requirement_ids=['R-999']; assert.throws(()=>assertReplanPreservesRequirements(original,changed2,ctx),/REPLAN_REMOVED_REQUIREMENT:R-001/);
});
test('root budget must exist exactly for every root',()=>{
  const c=contract(); c.root_budgets=[]; assert.throws(()=>compileTaskGraph(c,ctx),/ROOT_BUDGETS_REQUIRED/);
  const d=contract(); d.root_budgets.push({root_task_id:'ORPHAN',max_candidates:1,max_replans:0}); assert.throws(()=>compileTaskGraph(d,ctx),/ORPHAN_ROOT_BUDGET/);
});
test('legacy shadow parse preserves factory.contract.v1 behavior',()=>{
  const legacy={schema_version:'factory.contract.v1',contract_id:'LEGACY-1',project_id:'CHATGPT_GLOBAL_SKILL_GOVERNANCE',revision:1,tasks:[{task_id:'OLD-1',max_attempts:3}]};
  assert.equal(validateBoundedContract(legacy),true); assert.equal(validateVersionedContract(legacy).kind,'LEGACY_BOUNDED');
  const bad=clone(legacy); bad.tasks.push({task_id:'OLD-1'}); assert.throws(()=>validateBoundedContract(bad),/DUPLICATE_TASK_ID/); assert.throws(()=>validateVersionedContract(bad),/DUPLICATE_TASK_ID/);
});
test('legacy single-task governance contract remains readable without becoming DAG authority',()=>{
  const raw=fs.readFileSync(new URL('../../runs/V45-Z6-SAFETY-001/contract.json',import.meta.url),'utf8'); const out=validateVersionedContract(raw);
  assert.equal(out.kind,'LEGACY_SINGLE'); assert.equal(out.contract.task_id,'V45-Z6-STOP-ZOMBIE-ACK-001'); assert.equal(out.valid,true);
});
test('earliest legacy single-task contract without contract_id remains readable',()=>{
  const raw=fs.readFileSync(new URL('../../runs/V45-Z2-SYNTHETIC-001/contract.json',import.meta.url),'utf8'); const out=validateVersionedContract(raw);
  assert.equal(out.kind,'LEGACY_SINGLE'); assert.equal(out.contract.task_id,'V45-Z2-TASK-001');
});
test('unknown schema is rejected instead of silently ignored',()=>assert.throws(()=>validateVersionedContract({schema_version:'factory.contract.v999'}),/UNKNOWN_CONTRACT_SCHEMA/));
