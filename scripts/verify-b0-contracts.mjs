import crypto from 'node:crypto';
import fs from 'node:fs';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const boot = load('governance/bootstrap-contract.json');
const plan = load('governance/construction-plan-source.json');
const pin = load('protocol/app-server/pin.json');
const allow = load('protocol/app-server/method-allowlist.json');
const methods = text('protocol/app-server/stable-methods.txt').trim().split(/\r?\n/).filter(Boolean);
const planBytes = fs.readFileSync(new URL(`../${plan.plan_file_ref}`, import.meta.url));
const planSha = crypto.createHash('sha256').update(planBytes).digest('hex');

assert(boot.project_id === 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'project_id mismatch');
assert(boot.mission_revision === '20260831T103813+0800', 'mission revision mismatch');
assert(boot.execution_policy_revision === '20260908T235130+0800-EP52', 'policy revision mismatch');
assert(boot.controller_contract === 'CHAT_CODEX_EXECUTION_CONTRACT_V8_1_19_CANDIDATE', 'controller mismatch');
assert(boot.canonical_state_store === 'sqlite-wal', 'state store mismatch');
assert(boot.workflow_authority === 'supervisor-fsm', 'workflow authority mismatch');
assert(boot.active_workers_max === 1, 'worker bound mismatch');
assert(boot.worker_provider_write === false && boot.worker_provider_credentials.length === 0, 'worker provider isolation failed');
assert(boot.business_ingress === false && boot.production === false, 'business/production guard failed');
assert(boot.recovery.ambiguous_side_effect_readback_first === true && boot.recovery.blind_retry === false, 'recovery guard failed');
assert(pin.codex_cli_version === '0.153.4' && pin.experimental_included === false, 'protocol pin mismatch');
assert(pin.stable_method_count === 99, 'stable method count pin mismatch');
assert(methods.length === 99 && new Set(methods).size === 99, 'stable method universe mismatch');
assert([...methods].sort().join('\n') === methods.join('\n'), 'stable methods not sorted');
assert(allow.policy === 'DENY_BY_DEFAULT', 'allowlist must deny by default');
const expected = ['initialize','thread/items/list','thread/read','thread/resume','thread/start','thread/turns/list','turn/interrupt','turn/start'];
assert(JSON.stringify(allow.allowed_methods) === JSON.stringify(expected), 'B0 allowlist mismatch');
for (const method of allow.allowed_methods) assert(methods.includes(method), `allowed method absent from stable protocol: ${method}`);
const forbiddenPrefixes = ['account/','command/','config/','externalAgentConfig/','fs/','marketplace/','mcpServer/','plugin/','skills/','windowsSandbox/'];
for (const method of allow.allowed_methods) assert(!forbiddenPrefixes.some((p) => method.startsWith(p)), `forbidden method escaped allowlist: ${method}`);
assert(allow.provider_side_effects_authorized === false, 'provider side effects unexpectedly authorized');
assert(plan.schema === 'PTYSD_CONSTRUCTION_PLAN_SOURCE_V3', 'construction plan source schema mismatch');
assert(plan.source_authority === 'PROJECT_DATA_SOURCE', 'construction plan must use Project data source authority');
assert(plan.source_resolution_policy === 'PROJECT_SOURCE_FIRST_NO_RECONSTRUCTION_WHEN_EXACT_SOURCE_PRESENT', 'construction plan source-first policy mismatch');
assert(!fs.existsSync(new URL('../_plan.raw.gz.b64', import.meta.url)), 'reconstruction transport artifact forbidden');
assert(plan.formal_b0_credit === true, 'construction plan materialization credit missing');
assert(plan.materialization_status === 'EXACT_PROJECT_SOURCE_BYTES_SHA256_VERIFIED', 'construction plan source status mismatch');
assert(plan.raw_byte_identity_claimed === true, 'construction plan raw identity mismatch');
assert(planBytes.length === 40512 && plan.raw_size_bytes === 40512, 'construction plan size mismatch');
assert(planSha === '309a332ed781b8cbc479848c2c112bcdb26daf40eb1120320baeb035f2709199' && plan.raw_sha256 === planSha, 'construction plan SHA mismatch');

console.log(JSON.stringify({
  contracts: 'PASS',
  stable_method_count: methods.length,
  allowed_method_count: allow.allowed_methods.length,
  construction_plan_materialized: true,
  construction_plan_raw_identity: true,
  formal_b0_switch_ready: false,
  blocker: 'SHARED_PUBLICATION_CI_AND_FORMAL_GATE_NOT_YET_CREDITED'
}, null, 2));
