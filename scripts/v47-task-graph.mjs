import {createHash} from 'node:crypto';
import {validateBoundedContract} from '../tools/csg/cell-kernel/legacy-contract-compat.mjs';

export const V47_SCHEMA = 'factory.contract.v47';
export const LEGACY_SCHEMA = 'factory.contract.v1';
export const CANONICALIZER_VERSION = 'v47-json-c14n-1';
export const MAX_ACTIVE_WINDOW = 12;
export const MAX_PLAN_TASKS = 96;
export const MAX_TIMEOUT_SECONDS = 3600;
const MAX_DEPTH = 64;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const GIT_RE = /^[0-9a-f]{40,64}$/;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
  return v;
}
export function canonicalDigest(v) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
}
function fail(code) { throw new Error(code); }
function assertKeys(o, allowed, code='ILLEGAL_FIELD') {
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('OBJECT_REQUIRED');
  for (const k of Object.keys(o)) if (!allowed.has(k)) fail(`${code}:${k}`);
}
function reqId(v, name) { if (typeof v !== 'string' || !ID_RE.test(v)) fail(`INVALID_${name}`); return v; }
function reqDigest(v, name) { if (typeof v !== 'string' || !DIGEST_RE.test(v)) fail(`INVALID_${name}`); return v; }
function reqInt(v, min, max, name) { if (!Number.isSafeInteger(v) || v < min || v > max) fail(`INVALID_${name}`); return v; }
function assertUnicode(s) {
  if (s.includes('\0')) fail('NUL_STRING');
  for (let i=0;i<s.length;i++) {
    const c=s.charCodeAt(i);
    if (c>=0xD800 && c<=0xDBFF) {
      const n=s.charCodeAt(++i); if (!(n>=0xDC00 && n<=0xDFFF)) fail('UNPAIRED_SURROGATE');
    } else if (c>=0xDC00 && c<=0xDFFF) fail('UNPAIRED_SURROGATE');
  }
  return s;
}
function scanJson(text) {
  if (typeof text !== 'string') fail('JSON_TEXT_REQUIRED');
  let i=0; const ws=()=>{while (/\s/.test(text[i]??'')) i++;};
  function str() {
    if (text[i] !== '"') fail('JSON_STRING_REQUIRED'); const start=i++;
    while (i<text.length) {
      if (text[i]==='\\') { i+=2; continue; }
      if (text[i]==='"') { i++; return assertUnicode(JSON.parse(text.slice(start,i))); }
      i++;
    }
    fail('UNTERMINATED_JSON_STRING');
  }
  function value(depth=0) {
    if (depth>MAX_DEPTH) fail('JSON_TOO_DEEP'); ws(); const c=text[i];
    if (c==='{') return object(depth+1); if (c==='[') return array(depth+1); if (c==='"') return void str();
    const start=i; while (i<text.length && !/[\s,\]}]/.test(text[i])) i++;
    const token=text.slice(start,i); if (!token) fail('INVALID_JSON_TOKEN');
    if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token)) fail('INVALID_JSON_TOKEN');
    if (!['true','false','null'].includes(token)) { const n=Number(token); if (!Number.isFinite(n)) fail('NONFINITE_NUMBER'); if (Number.isInteger(n)&&!Number.isSafeInteger(n)) fail('UNSAFE_INTEGER'); }
  }
  function object(depth) {
    i++; ws(); const keys=new Set(); if (text[i]==='}') { i++; return; }
    while (true) {
      ws(); const key=str(); if (keys.has(key)) fail(`DUPLICATE_JSON_KEY:${key}`); keys.add(key);
      ws(); if (text[i++]!==':') fail('JSON_COLON_REQUIRED'); value(depth); ws();
      if (text[i]==='}') { i++; return; } if (text[i++]!==',') fail('JSON_COMMA_REQUIRED');
    }
  }
  function array(depth) {
    i++; ws(); if (text[i]===']') { i++; return; }
    while (true) { value(depth); ws(); if (text[i]===']') { i++; return; } if (text[i++]!==',') fail('JSON_COMMA_REQUIRED'); }
  }
  value(0); ws(); if (i!==text.length) fail('JSON_TRAILING_DATA');
}
export function parseContractJson(text) { scanJson(text); return JSON.parse(text); }

function pathKey(raw) {
  if (typeof raw !== 'string' || !raw || raw !== raw.normalize('NFC')) fail('INVALID_PATH_UNICODE');
  if (raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('//')) fail('PATH_ESCAPE');
  const parts=raw.split('/'); if (parts.some(p=>!p || p==='.' || p==='..')) fail('PATH_ESCAPE');
  for (const p of parts) {
    if (/[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || WIN_RESERVED.test(p)) fail('WINDOWS_PATH_COLLISION');
  }
  return parts.join('/').toLocaleLowerCase('en-US');
}
function validatePaths(values, name) {
  if (!Array.isArray(values)) fail(`INVALID_${name}`); const seen=new Set();
  for (const p of values) { const k=pathKey(p); if (seen.has(k)) fail(`PATH_ALIAS:${p}`); seen.add(k); }
  return seen;
}
const ROOT_FIELDS = new Set(['schema_version','canonicalizer_version','contract_id','project_id','run_id','revision','plan_id','spec_revision','spec_digest','base_commit','base_tree','tasks','active_window_task_ids','root_budgets']);
const TASK_FIELDS = new Set(['task_id','root_task_id','depends_on','owned_paths','read_paths','forbidden_paths','shared_interfaces','requirement_ids','acceptance_case_ids','data_class','risk_class','model_profile_id','resource_request','expected_artifacts','review_policy','merge_policy','timeout_seconds']);
const RESOURCE_FIELDS = new Set(['cpu_millis','memory_mib','pids','disk_mib','network_mode','api_calls']);
const ARTIFACT_FIELDS = new Set(['path','kind','max_bytes']);
const IFACE_FIELDS = new Set(['interface_id','digest','mode']);
const ROOT_BUDGET_FIELDS = new Set(['root_task_id','max_candidates','max_replans']);
const DATA_CLASSES = new Set(['PUBLIC','SYNTHETIC']);
const RISK_CLASSES = new Set(['LOW','MEDIUM','HIGH']);

function validateTask(task) {
  assertKeys(task,TASK_FIELDS); reqId(task.task_id,'TASK_ID'); reqId(task.root_task_id,'ROOT_TASK_ID');
  if (!Array.isArray(task.depends_on)) fail('INVALID_DEPENDS_ON');
  const deps=new Set(); for (const d of task.depends_on) { reqId(d,'DEPENDENCY_ID'); if (deps.has(d)) fail('DUPLICATE_DEPENDENCY'); deps.add(d); }
  const owned=validatePaths(task.owned_paths,'OWNED_PATHS'); const read=validatePaths(task.read_paths,'READ_PATHS'); const forbidden=validatePaths(task.forbidden_paths,'FORBIDDEN_PATHS');
  for (const k of owned) if (forbidden.has(k)) fail('OWNED_FORBIDDEN_COLLISION');
  if (!Array.isArray(task.shared_interfaces)) fail('INVALID_SHARED_INTERFACES');
  const interfaces=new Set(); for (const x of task.shared_interfaces) { assertKeys(x,IFACE_FIELDS); reqId(x.interface_id,'INTERFACE_ID'); reqDigest(x.digest,'INTERFACE_DIGEST'); if (!['READ','WRITE','MIGRATION'].includes(x.mode)) fail('INVALID_INTERFACE_MODE'); if (interfaces.has(x.interface_id)) fail('DUPLICATE_INTERFACE'); interfaces.add(x.interface_id); }
  if (!Array.isArray(task.requirement_ids) || task.requirement_ids.length<1) fail('REQUIREMENT_IDS_REQUIRED');
  const reqs=new Set(); for (const r of task.requirement_ids) { reqId(r,'REQUIREMENT_ID'); if (reqs.has(r)) fail('DUPLICATE_REQUIREMENT_ID'); reqs.add(r); }
  if (!Array.isArray(task.acceptance_case_ids) || task.acceptance_case_ids.length<1) fail('ACCEPTANCE_CASE_IDS_REQUIRED');
  for (const a of task.acceptance_case_ids) reqId(a,'ACCEPTANCE_CASE_ID');
  if (!DATA_CLASSES.has(task.data_class)) fail('INVALID_DATA_CLASS'); if (!RISK_CLASSES.has(task.risk_class)) fail('INVALID_RISK_CLASS'); reqId(task.model_profile_id,'MODEL_PROFILE_ID');
  assertKeys(task.resource_request,RESOURCE_FIELDS); reqInt(task.resource_request.cpu_millis,1,64000,'CPU_MILLIS'); reqInt(task.resource_request.memory_mib,16,262144,'MEMORY_MIB'); reqInt(task.resource_request.pids,1,4096,'PIDS'); reqInt(task.resource_request.disk_mib,1,1048576,'DISK_MIB'); reqInt(task.resource_request.api_calls,0,10000,'API_CALLS');
  if (!['DENY','LIMITED'].includes(task.resource_request.network_mode)) fail('INVALID_NETWORK_MODE');
  if (!Array.isArray(task.expected_artifacts)) fail('INVALID_EXPECTED_ARTIFACTS');
  for (const a of task.expected_artifacts) { assertKeys(a,ARTIFACT_FIELDS); pathKey(a.path); if (!['FILE','DIRECTORY','RECEIPT'].includes(a.kind)) fail('INVALID_ARTIFACT_KIND'); reqInt(a.max_bytes,1,1073741824,'ARTIFACT_MAX_BYTES'); }
  if (!['FRESH_REQUIRED','NONE'].includes(task.review_policy)) fail('INVALID_REVIEW_POLICY');
  if (!['SERIAL_INTEGRATOR','NO_MERGE'].includes(task.merge_policy)) fail('INVALID_MERGE_POLICY');
  reqInt(task.timeout_seconds,1,MAX_TIMEOUT_SECONDS,'TIMEOUT_SECONDS');
  return {deps,owned,read,forbidden,reqs};
}

function validateRootBudgets(budgets, taskRoots) {
  if (!Array.isArray(budgets) || budgets.length<1) fail('ROOT_BUDGETS_REQUIRED'); const seen=new Set(); const out={};
  for (const b of budgets) {
    assertKeys(b,ROOT_BUDGET_FIELDS); reqId(b.root_task_id,'ROOT_BUDGET_ID');
    if (seen.has(b.root_task_id)) fail('DUPLICATE_ROOT_BUDGET'); seen.add(b.root_task_id);
    out[b.root_task_id]={max_candidates:reqInt(b.max_candidates,1,3,'MAX_CANDIDATES'),max_replans:reqInt(b.max_replans,0,1,'MAX_REPLANS')};
  }
  for (const r of taskRoots) if (!seen.has(r)) fail(`ROOT_BUDGET_MISSING:${r}`);
  for (const r of seen) if (!taskRoots.has(r)) fail(`ORPHAN_ROOT_BUDGET:${r}`);
  return out;
}
function topological(tasks, byId) {
  const indegree=new Map(tasks.map(t=>[t.task_id,0])); const next=new Map(tasks.map(t=>[t.task_id,[]]));
  for (const t of tasks) for (const d of t.depends_on) { if (!byId.has(d)) fail(`UNKNOWN_DEPENDENCY:${d}`); if (d===t.task_id) fail('DEPENDENCY_CYCLE'); indegree.set(t.task_id,indegree.get(t.task_id)+1); next.get(d).push(t.task_id); }
  const q=[...indegree].filter(([,n])=>n===0).map(([id])=>id).sort(); const order=[];
  while(q.length){ const id=q.shift(); order.push(id); for(const n of next.get(id).sort()){ indegree.set(n,indegree.get(n)-1); if(indegree.get(n)===0){q.push(n);q.sort();} } }
  if(order.length!==tasks.length) fail('DEPENDENCY_CYCLE'); return order;
}
export function compileTaskGraph(contract,{admittedProjectId,currentSpecDigest}={}) {
  assertKeys(contract,ROOT_FIELDS); if (contract.schema_version!==V47_SCHEMA) fail('V47_CONTRACT_REQUIRED');
  if (contract.canonicalizer_version!==CANONICALIZER_VERSION) fail('CANONICALIZER_VERSION_MISMATCH');
  reqId(contract.contract_id,'CONTRACT_ID'); reqId(contract.project_id,'PROJECT_ID'); reqId(contract.run_id,'RUN_ID'); reqInt(contract.revision,1,2147483647,'CONTRACT_REVISION'); reqId(contract.plan_id,'PLAN_ID'); reqInt(contract.spec_revision,1,2147483647,'SPEC_REVISION'); reqDigest(contract.spec_digest,'SPEC_DIGEST');
  if (typeof contract.base_commit!=='string'||!GIT_RE.test(contract.base_commit)) fail('INVALID_BASE_COMMIT'); if (typeof contract.base_tree!=='string'||!GIT_RE.test(contract.base_tree)) fail('INVALID_BASE_TREE');
  if (admittedProjectId!==contract.project_id) fail('PROJECT_NOT_ADMITTED'); if (currentSpecDigest!==contract.spec_digest) fail('STALE_SPEC_DIGEST');
  if (!Array.isArray(contract.tasks)||contract.tasks.length<1||contract.tasks.length>MAX_PLAN_TASKS) fail('INVALID_PLAN_TASK_COUNT');
  if (!Array.isArray(contract.active_window_task_ids)||contract.active_window_task_ids.length<1||contract.active_window_task_ids.length>MAX_ACTIVE_WINDOW) fail('INVALID_ACTIVE_WINDOW');
  const byId=new Map(), meta=new Map(), taskRoots=new Set(), owner=new Map();
  for (const task of contract.tasks) {
    const m=validateTask(task); if (byId.has(task.task_id)) fail('DUPLICATE_TASK_ID'); byId.set(task.task_id,task); meta.set(task.task_id,m); taskRoots.add(task.root_task_id);
    for (const p of m.owned) { if (owner.has(p)) fail(`PATH_OWNERSHIP_COLLISION:${p}`); owner.set(p,task.task_id); }
  }
  const activeSeen=new Set(); for (const id of contract.active_window_task_ids) { reqId(id,'ACTIVE_TASK_ID'); if(activeSeen.has(id)) fail('DUPLICATE_ACTIVE_TASK'); activeSeen.add(id); if(!byId.has(id)) fail(`ACTIVE_TASK_NOT_IN_PLAN:${id}`); }
  const rootBudgets=validateRootBudgets(contract.root_budgets,taskRoots); const order=topological(contract.tasks,byId); const digest=canonicalDigest(contract);
  const compiled=order.map(id=>{ const t=byId.get(id); return {...structuredClone(t),project_id:contract.project_id,run_id:contract.run_id,plan_id:contract.plan_id,spec_revision:contract.spec_revision,spec_digest:contract.spec_digest,contract_digest:digest,base_commit:contract.base_commit,base_tree:contract.base_tree,root_budget:structuredClone(rootBudgets[t.root_task_id])}; });
  return {schema:'factory.task_graph.v47',contract_id:contract.contract_id,contract_revision:contract.revision,contract_digest:digest,canonicalizer_version:CANONICALIZER_VERSION,project_id:contract.project_id,run_id:contract.run_id,plan_id:contract.plan_id,topological_order:order,active_window:[...contract.active_window_task_ids],root_budgets:rootBudgets,tasks:compiled};
}
function validateLegacyV1(contract) {
  reqId(contract.project_id,'PROJECT_ID');
  if (Array.isArray(contract.tasks) || Number.isInteger(contract.revision)) {
    validateBoundedContract(contract); return 'LEGACY_BOUNDED';
  }
  if (contract.contract_id !== undefined) reqId(contract.contract_id,'CONTRACT_ID');
  reqId(contract.task_id,'TASK_ID');
  if (!Array.isArray(contract.requirements) || !Array.isArray(contract.acceptance)) fail('LEGACY_SINGLE_REQUIREMENTS_REQUIRED');
  reqInt(contract.max_attempts,1,3,'MAX_ATTEMPTS');
  return 'LEGACY_SINGLE';
}
export function validateVersionedContract(input, context={}) {
  const contract=typeof input==='string'?parseContractJson(input):input;
  if (contract?.schema_version===LEGACY_SCHEMA) return {kind:validateLegacyV1(contract),valid:true,contract};
  if (contract?.schema_version===V47_SCHEMA) return {kind:'V47',valid:true,graph:compileTaskGraph(contract,context),contract};
  fail('UNKNOWN_CONTRACT_SCHEMA');
}
export function assertCandidatePromotionBinding(graph,{candidateContractDigest,candidateSpecDigest,currentSpecDigest}={}) {
  if (!graph || graph.schema!=='factory.task_graph.v47') fail('COMPILED_GRAPH_REQUIRED');
  if (candidateContractDigest!==graph.contract_digest) fail('CANDIDATE_CONTRACT_DIGEST_MISMATCH');
  if (candidateSpecDigest!==graph.tasks[0]?.spec_digest) fail('CANDIDATE_SPEC_DIGEST_MISMATCH');
  if (currentSpecDigest!==candidateSpecDigest) fail('STALE_CANDIDATE_SPEC');
  return true;
}
export function consumeRootBudget(ledger,graph,{root_task_id,candidate_delta=0,replan_delta=0}={}) {
  reqId(root_task_id,'ROOT_TASK_ID'); reqInt(candidate_delta,0,1,'CANDIDATE_DELTA'); reqInt(replan_delta,0,1,'REPLAN_DELTA');
  const limit=graph?.root_budgets?.[root_task_id]; if(!limit) fail('ROOT_BUDGET_NOT_FOUND');
  const next=structuredClone(ledger??{}); const cur=next[root_task_id]??{candidates_used:0,replans_used:0};
  const c=cur.candidates_used+candidate_delta, r=cur.replans_used+replan_delta;
  if(c>limit.max_candidates||r>limit.max_replans) fail('ROOT_BUDGET_EXHAUSTED'); next[root_task_id]={candidates_used:c,replans_used:r}; return next;
}
export function assertReplanPreservesRequirements(originalGraph,candidateContract,context={}) {
  const candidate=compileTaskGraph(candidateContract,context); const oldByRoot=new Map(), newByRoot=new Map();
  for(const t of originalGraph.tasks){ const s=oldByRoot.get(t.root_task_id)??new Set(); for(const r of t.requirement_ids)s.add(r); oldByRoot.set(t.root_task_id,s); }
  for(const t of candidate.tasks){ const s=newByRoot.get(t.root_task_id)??new Set(); for(const r of t.requirement_ids)s.add(r); newByRoot.set(t.root_task_id,s); }
  for(const [root,reqs] of oldByRoot){ const n=newByRoot.get(root); if(!n) fail(`REPLAN_REMOVED_ROOT:${root}`); for(const r of reqs) if(!n.has(r)) fail(`REPLAN_REMOVED_REQUIREMENT:${r}`); }
  return candidate;
}
