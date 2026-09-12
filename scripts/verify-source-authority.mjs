import fs from 'node:fs';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const source = load('governance/construction-plan-source.json');
const root = new URL('../', import.meta.url);

assert(source.schema === 'PTYSD_CONSTRUCTION_PLAN_SOURCE_V3', 'source schema mismatch');
assert(source.source_authority === 'PROJECT_DATA_SOURCE', 'Project source authority required');
assert(source.source_scope === 'CURRENT_PROJECT_HUMAN_DIRECTED_ARTIFACT', 'source scope mismatch');
assert(source.source_resolution_policy === 'PROJECT_SOURCE_FIRST_NO_RECONSTRUCTION_WHEN_EXACT_SOURCE_PRESENT', 'source-first policy missing');
assert(source.materialization_status === 'EXACT_PROJECT_SOURCE_BYTES_SHA256_VERIFIED', 'Project source bytes not verified');
assert(source.provenance.includes('PROJECT_DATA_SOURCE_EXACT_FILE_PRESENT'), 'Project source evidence missing');
assert(!source.provenance.some((x) => /RECOVER|RECONSTRUCT|REBUILD/i.test(x)), 'reconstruction provenance forbidden');
assert(Array.isArray(source.forbidden_fallbacks_when_project_source_present), 'fallback guard missing');
for (const x of ['FILE_LIBRARY_RECONSTRUCTION','PLAN_TEXT_REBUILD','GZIP_BASE64_REBUILD']) assert(source.forbidden_fallbacks_when_project_source_present.includes(x), `missing forbidden fallback: ${x}`);
assert(!fs.existsSync(new URL('_plan.raw.gz.b64', root)), 'reconstruction transport artifact must be absent');

console.log(JSON.stringify({
  source_authority: 'PASS_PROJECT_DATA_SOURCE_FIRST',
  reconstruction_fallback_present: false,
  reconstruction_transport_artifact_present: false,
  formal_b0_switch_ready: false
}, null, 2));
