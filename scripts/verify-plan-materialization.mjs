import crypto from 'node:crypto';
import fs from 'node:fs';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const source = load('governance/construction-plan-source.json');
const planUrl = new URL(`../${source.plan_file_ref}`, import.meta.url);
const bytes = fs.readFileSync(planUrl);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const text = bytes.toString('utf8').replace(/^\uFEFF/, '');

assert(source.schema === 'PTYSD_CONSTRUCTION_PLAN_SOURCE_V3', 'plan source schema mismatch');
assert(source.source_authority === 'PROJECT_DATA_SOURCE', 'Project data source authority required');
assert(source.source_resolution_policy === 'PROJECT_SOURCE_FIRST_NO_RECONSTRUCTION_WHEN_EXACT_SOURCE_PRESENT', 'Project source-first policy missing');
assert(!fs.existsSync(new URL('../_plan.raw.gz.b64', import.meta.url)), 'reconstruction transport artifact forbidden');
assert(source.materialization_status === 'EXACT_PROJECT_SOURCE_BYTES_SHA256_VERIFIED', 'plan not exact-materialized');
assert(source.raw_byte_identity_claimed === true, 'raw identity not claimed');
assert(source.formal_b0_credit === true, 'plan B0 credit missing');
assert(source.raw_size_bytes === 40512 && bytes.length === 40512, 'plan size mismatch');
assert(source.raw_sha256 === '309a332ed781b8cbc479848c2c112bcdb26daf40eb1120320baeb035f2709199', 'source SHA mismatch');
assert(sha256 === source.raw_sha256, 'materialized plan SHA mismatch');
assert(source.mission_change_required === false, 'plan must not change Mission');
assert(source.current_b0_restart_required === false, 'plan must not restart B0');
assert(source.current_b0_harness_change_allowed === false, 'plan must not replace B0 harness');
assert(text.includes('PLAN_VERSION=\n4.2'), 'plan version marker missing');
assert(text.includes('B0_ACCEPTANCE_HARNESS=\nPINNED_CODEX_APP_SERVER'), 'B0 harness marker missing');
assert(text.includes('HARD_ISOLATION_BOUNDARY=\nHYPERV_UBUNTU_VM'), 'VM boundary marker missing');

console.log(JSON.stringify({
  plan_materialization: 'PASS',
  raw_size_bytes: bytes.length,
  raw_sha256: sha256,
  raw_byte_identity_claimed: true,
  plan_b0_credit: true,
  formal_b0_switch_ready: false
}, null, 2));
