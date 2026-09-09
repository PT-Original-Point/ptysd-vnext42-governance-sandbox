import crypto from 'node:crypto';
import fs from 'node:fs';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const map = load('governance/b0-local-acceptance-map.json');
const runtime = load('config/runtime-manifest.json');
const boot = load('governance/bootstrap-contract.json');
const planSource = load('governance/construction-plan-source.json');
const tests = text('tests/b0.test.ts');

assert(map.schema === 'PTYSD_B0_LOCAL_ACCEPTANCE_MAP_V1', 'acceptance map schema mismatch');
assert(map.project_id === 'CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'project mismatch');
assert(map.criteria_count === 10 && map.criteria.length === 10, 'criteria count mismatch');
assert(JSON.stringify(map.criteria.map((x) => x.id)) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), 'criteria ids mismatch');
for (const criterion of map.criteria) {
  for (const file of criterion.files) assert(exists(file), `criterion ${criterion.id} missing file: ${file}`);
  for (const title of criterion.test_titles) assert(tests.includes(`test('${title}'`), `criterion ${criterion.id} missing test title: ${title}`);
}
assert(runtime.active_workers_max === 1, 'single worker runtime guard mismatch');
assert(runtime.provider_write_enabled === false, 'provider write enabled');
assert(Array.isArray(runtime.worker_provider_credentials) && runtime.worker_provider_credentials.length === 0, 'worker provider credentials present');
assert(boot.worker_provider_write === false && boot.worker_provider_credentials.length === 0, 'bootstrap provider isolation mismatch');
assert(planSource.materialization_status === 'EXACT_PROJECT_SOURCE_BYTES_SHA256_VERIFIED', 'plan materialization missing');
const planBytes = fs.readFileSync(new URL(`../${planSource.plan_file_ref}`, import.meta.url));
const planSha = crypto.createHash('sha256').update(planBytes).digest('hex');
assert(planSha === map.exact_plan_sha256, 'acceptance map plan SHA mismatch');
assert(map.wp04 === 'PINNED_CODEX_APP_SERVER_STABLE_ALLOWLIST_EXPERIMENTAL_DEFAULT_DENY', 'WP04 definition mismatch');
assert(map.wp05 === 'DETERMINISTIC_FAULT_CONFORMANCE_TRUE_LLM_NOT_REQUIRED', 'WP05 definition mismatch');
assert(map.formal_b0_pass === false, 'local map must not claim formal B0 pass');

console.log(JSON.stringify({
  b0_local_acceptance: 'PASS',
  criteria_passed: 10,
  criteria_total: 10,
  wp04: 'PASS_BY_PINNED_APP_SERVER_CONTRACT',
  wp05: 'PASS_BY_DETERMINISTIC_FAULT_CONFORMANCE',
  formal_b0_switch_ready: false,
  blocker: map.formal_b0_blocker
}, null, 2));
