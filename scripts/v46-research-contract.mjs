import { createHash } from 'node:crypto';
import { evaluateModelProfile } from './v46-model-profile-guard.mjs';
import { validateBoundedContract } from '../tools/csg/cell-kernel/legacy-contract-compat.mjs';

const ALLOWED_DATA_CLASSES = new Set(['PUBLIC', 'SYNTHETIC']);
const MAX = Object.freeze({ queries: 24, sources: 40, branches: 4, depth: 2, wall: 60 });
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`INVALID_${name}`);
  return value;
}
function requiredArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function sha256(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}
function immutableGithubRef(ref) {
  return /^github:\/\/[^@]+@[0-9a-f]{40}$/i.test(ref);
}
export function validateResearchContract(contract) {
  if (!contract || contract.schema_version !== 'factory.research.v1') throw new Error('RESEARCH_CONTRACT_REQUIRED');
  for (const field of ['research_id','project_id','request_ref','decision_needed','baseline_ref','baseline_digest']) {
    requiredString(contract[field], field.toUpperCase());
  }
  if (!/^sha256:[0-9a-f]{64}$/i.test(contract.baseline_digest)) throw new Error('INVALID_BASELINE_DIGEST');
  requiredArray(contract.questions, 'QUESTIONS');
  if (contract.questions.length < 1) throw new Error('QUESTIONS_REQUIRED');
  if (!Number.isInteger(contract.minimum_options) || contract.minimum_options < 3) throw new Error('MINIMUM_OPTIONS_LT_3');
  if (contract.human_decision_required !== true) throw new Error('HUMAN_DECISION_REQUIRED');
  if (contract.evidence_policy !== 'primary_sources_with_counterevidence') throw new Error('INVALID_EVIDENCE_POLICY');
  const b = contract.budgets ?? {};
  const checks = [['query_limit',MAX.queries],['source_limit',MAX.sources],['branch_limit',MAX.branches],['depth_limit',MAX.depth],['wall_minutes',MAX.wall]];
  for (const [key, max] of checks) {
    if (!Number.isInteger(b[key]) || b[key] < 1 || b[key] > max) throw new Error(`INVALID_BUDGET_${key.toUpperCase()}`);
  }
  if (b.incremental_usd !== 0) throw new Error('INCREMENTAL_PAID_COST_FORBIDDEN');
  requiredArray(contract.data_classes, 'DATA_CLASSES');
  if (contract.data_classes.some(x => !ALLOWED_DATA_CLASSES.has(x))) throw new Error('RESEARCH_DATA_CLASS_FORBIDDEN');
  if (contract.coding_dispatch_allowed !== false) throw new Error('CODING_DISPATCH_MUST_BE_FALSE');
  return true;
}
function channelMap(channelInventory) {
  const rows = requiredArray(channelInventory, 'CHANNEL_INVENTORY');
  return new Map(rows.map(row => [row.channel, row]));
}

export function qualifyResearchChannels({ researchContract, channelInventory, requestedChannels, modelProfile = null, nowMs = Date.now() }) {
  validateResearchContract(researchContract);
  const inventory = channelMap(channelInventory);
  const requested = requiredArray(requestedChannels, 'REQUESTED_CHANNELS');
  if (requested.length < 1) throw new Error('REQUESTED_CHANNELS_REQUIRED');
  const failures = [];
  for (const name of requested) {
    const row = inventory.get(name);
    if (!row) { failures.push(`CHANNEL_UNKNOWN:${name}`); continue; }
    if (row.incremental_paid_cost_allowed !== false || row.paid_fallback_allowed !== false) failures.push(`CHANNEL_COST_POLICY:${name}`);
    if (name === 'model') {
      const gate = evaluateModelProfile(modelProfile, {
        provider_id:'opencode', model_id:'opencode/muse-spark-1.3-contributor-free',
        data_class:researchContract.data_classes[0], paid_fallback_allowed:false
      }, nowMs);
      if (!gate.allow) failures.push(...gate.failures.map(x => `MODEL_${x}`));
    } else if (name === 'research' || name === 'search') {
      if (row.scope !== 'CONTROLLER_ONLY') failures.push(`CHANNEL_SCOPE:${name}`);
    } else if (name === 'eval') {
      if (row.scope !== 'SELF_HOSTED_DETERMINISTIC') failures.push('CHANNEL_SCOPE:eval');
    } else {
      failures.push(`CHANNEL_NOT_RESEARCH_QUALIFIED:${name}`);
    }
  }
  return { allow: failures.length === 0, result: failures.length ? 'WAITING_RESOURCE' : 'PASS_RESEARCH_CHANNELS', failures, provider_calls: 0 };
}
export function compileResearchPhase({ authority, researchContract, channelInventory, requestedChannels, modelProfile = null, nowMs = Date.now() }) {
  const qualification = qualifyResearchChannels({researchContract, channelInventory, requestedChannels, modelProfile, nowMs});
  if (!qualification.allow) return {status:'WAITING_RESOURCE', provider_calls:0, failures:qualification.failures};
  for (const field of ['project_id','mission_revision_id','mission_hash','policy_revision_id','policy_hash','control_ref','run_id']) requiredString(authority?.[field], field.toUpperCase());
  if (authority.project_id !== researchContract.project_id) throw new Error('PROJECT_MISMATCH');
  const contract = {
    schema_version:'factory.contract.v1',
    contract_id:`RC-${researchContract.research_id}`,
    revision:researchContract.decision_revision,
    project_id:researchContract.project_id,
    run_id:authority.run_id,
    goal:researchContract.decision_needed,
    tasks:[{task_id:`${researchContract.research_id}-RESEARCH`, max_attempts:3}],
    allowed_tools:[...requestedChannels],
    allowed_effects:['governance-only research artifacts'],
    incremental_usd:0,
    time_budget_minutes:researchContract.budgets.wall_minutes,
    mission_revision_id:authority.mission_revision_id,
    mission_hash:authority.mission_hash,
    policy_revision_id:authority.policy_revision_id,
    policy_hash:authority.policy_hash,
    control_ref:authority.control_ref,
    research_id:researchContract.research_id,
    research_contract_digest:sha256(JSON.stringify(researchContract)),
    research_policy:{minimum_options:researchContract.minimum_options, exactly_one_recommendation:true, counterevidence_required:true, immutable_source_refs:true, coding_dispatch_allowed:false},
    second_runtime_created:false,
  };
  validateBoundedContract(contract);
  return {status:'READY', provider_calls:0, contract};
}
function deniedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '169.254.169.254') return true;
  if (PRIVATE_V4.some(re => re.test(h))) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local')) return true;
  return false;
}

export async function fetchResearchSourceSafely(candidate, fetchFn) {
  if (typeof fetchFn !== 'function') throw new Error('FETCH_FUNCTION_REQUIRED');
  let url;
  try { url = new URL(requiredString(candidate?.url, 'SOURCE_URL')); }
  catch { return {status:'REJECTED', reason:'INVALID_SOURCE_URL', egress_log:[], file_reads:0, instructions_executed:0}; }
  if (!['http:','https:'].includes(url.protocol) || deniedHost(url.hostname)) {
    return {status:'REJECTED', reason:'NETWORK_TARGET_DENIED', egress_log:[], file_reads:0, instructions_executed:0};
  }
  const body = String(await fetchFn(url.href));
  const suspicious = /(read\s+(?:the\s+)?secrets?|\/etc\/|\.ssh|169\.254\.169\.254|localhost|127\.0\.0\.1|curl\s+|powershell\s+)/i.test(body);
  return {
    status:'INGESTED', url:url.href, content:body,
    trust:suspicious ? 'LOW_UNTRUSTED_INSTRUCTION_TEXT' : 'NORMAL_UNTRUSTED_SOURCE',
    prompt_injection_suspected:suspicious,
    egress_log:[url.href], file_reads:0, instructions_executed:0,
  };
}
export function validateResearchArtifacts({researchContract, plan, report, claims, sources}) {
  validateResearchContract(researchContract);
  if (plan?.schema !== 'factory.research_plan.v1' || report?.schema !== 'factory.research_report.v1' || claims?.schema !== 'factory.research_claims.v1') throw new Error('RESEARCH_ARTIFACT_SCHEMA_MISMATCH');
  for (const x of [plan,report,claims]) if (x.research_id !== researchContract.research_id) throw new Error('RESEARCH_ID_MISMATCH');
  if (report.coding_dispatch_count !== 0) throw new Error('CODING_DISPATCH_BEFORE_DECISION');
  if (report.decision_state !== 'PENDING_HUMAN') throw new Error('DECISION_STATE_NOT_PENDING_HUMAN');
  const options = requiredArray(report.options, 'OPTIONS');
  if (options.length < researchContract.minimum_options) throw new Error('INSUFFICIENT_OPTIONS');
  if (new Set(options.map(x => x.option_id)).size !== options.length) throw new Error('DUPLICATE_OPTION_ID');
  const recommended = options.filter(x => x.recommended === true);
  if (recommended.length !== 1 || report.recommendation_id !== recommended[0].option_id) throw new Error('EXACTLY_ONE_RECOMMENDATION_REQUIRED');
  for (const option of options) {
    requiredString(option.option_id, 'OPTION_ID');
    requiredString(option.summary, 'OPTION_SUMMARY');
    if (!Array.isArray(option.counterevidence) || option.counterevidence.length < 1) throw new Error('COUNTEREVIDENCE_REQUIRED');
  }
  if (!Array.isArray(report.unknowns)) throw new Error('UNKNOWNS_REQUIRED');
  const sourceRows = requiredArray(sources, 'SOURCES');
  const sourceMap = new Map(sourceRows.map(x => [x.source_id, x]));
  for (const source of sourceRows) {
    requiredString(source.source_id, 'SOURCE_ID');
    if (!immutableGithubRef(requiredString(source.ref, 'SOURCE_REF'))) throw new Error('SOURCE_REF_NOT_IMMUTABLE');
    if (!/^sha256:[0-9a-f]{64}$/i.test(requiredString(source.sha256, 'SOURCE_SHA256'))) throw new Error('INVALID_SOURCE_SHA256');
  }
  const claimRows = requiredArray(claims.claims, 'CLAIMS');
  const claimIds = new Set();
  for (const claim of claimRows) {
    requiredString(claim.claim_id, 'CLAIM_ID');
    if (claimIds.has(claim.claim_id)) throw new Error('DUPLICATE_CLAIM_ID');
    claimIds.add(claim.claim_id);
    requiredString(claim.statement, 'CLAIM_STATEMENT');
    requiredString(claim.evidence_level, 'EVIDENCE_LEVEL');
    requiredString(claim.support_summary, 'SUPPORT_SUMMARY');
    if (!Array.isArray(claim.counterevidence)) throw new Error('CLAIM_COUNTEREVIDENCE_REQUIRED');
    const refs = requiredArray(claim.source_refs, 'CLAIM_SOURCE_REFS');
    if (refs.length < 1) throw new Error('CLAIM_SOURCE_REQUIRED');
    for (const ref of refs) if (!sourceMap.has(ref)) throw new Error('UNRESOLVED_SOURCE_REF');
  }
  for (const option of options) {
    for (const id of requiredArray(option.claim_refs, 'OPTION_CLAIM_REFS')) if (!claimIds.has(id)) throw new Error('UNRESOLVED_CLAIM_REF');
  }
  const reportRefs = requiredArray(report.claim_refs, 'REPORT_CLAIM_REFS');
  for (const id of reportRefs) if (!claimIds.has(id)) throw new Error('UNRESOLVED_REPORT_CLAIM_REF');
  const canonical = JSON.stringify({plan,report,claims,sources});
  return {accepted:true, artifact_digest:sha256(canonical), source_count:sourceRows.length, claim_count:claimRows.length, option_count:options.length};
}
