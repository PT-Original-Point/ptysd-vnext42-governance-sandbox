import { createHash } from 'node:crypto';

export const ADVISOR_GUARD_VERSION = 'v48.advisor-guard.v1';
export const OBJECTIVE_TRIGGER_CODES = Object.freeze(['T1','T2','T3','T4','T5','T6','T7']);
export const ADVISOR_AUTHORITY = Object.freeze({ mode:'READ_ONLY', edit:false, shell:false, provider_write:false, promotion:false });
export const PACKET_LIMITS = Object.freeze({
  problem_chars:2000,
  acceptance_chars:2000,
  evidence_items:12,
  evidence_item_chars:1000,
  diff_chars:6000,
  symbol_items:24,
  symbol_chars:200,
  repair_attempts:8,
  repair_attempt_chars:1000,
  disagreement_chars:2000,
});

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OUTPUTS = new Set(['PLAN','CORRECTION','STOP']);
const ALLOWED_PACKET_KEYS = new Set([
  'trigger_code','project_id','run_id','root_task_id','task_id','spec_digest','contract_digest',
  'problem_statement','failing_acceptance','deterministic_evidence','bounded_diff',
  'dependency_ranked_symbols_interfaces','repair_attempts','reviewer_disagreement','requested_output'
]);
const ROOT_CAUSE_T5 = new Set(['SECURITY','TRUST_BOUNDARY','SCHEMA_MIGRATION','CONCURRENCY']);
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])) : v;
const digest = v => `sha256:${createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}`;
const fail = (code, detail='') => { throw new Error(detail ? `${code}:${detail}` : code); };
const reqId = (v, name) => { if (typeof v !== 'string' || !ID_RE.test(v)) fail(`INVALID_${name}`); return v; };
const reqDigest = (v, name) => { if (typeof v !== 'string' || !DIGEST_RE.test(v)) fail(`INVALID_${name}`); return v; };
const reqText = (v, max, name) => { if (typeof v !== 'string' || !v.trim()) fail(`INVALID_${name}`); if ([...v].length > max) fail(`${name}_TOO_LARGE`); return v; };
const reqInt = (v, min, max, name) => { if (!Number.isSafeInteger(v) || v < min || v > max) fail(`INVALID_${name}`); return v; };

function boundedStringArray(v, maxItems, maxChars, name) {
  if (!Array.isArray(v)) fail(`INVALID_${name}`);
  if (v.length > maxItems) fail(`${name}_TOO_MANY_ITEMS`);
  return v.map((x,i)=>reqText(x,maxChars,`${name}_${i}`));
}

export function evaluateObjectiveAdvisorTriggers(event = {}) {
  const codes=[];
  if (Number.isSafeInteger(event.same_failure_signature_count) && event.same_failure_signature_count >= 2) codes.push('T1');
  if (Number.isSafeInteger(event.same_requirement_fresh_review_rejections) && event.same_requirement_fresh_review_rejections >= 2) codes.push('T2');
  if (event.reviewer_conflict_on_blocking_root_cause === true) codes.push('T3');
  if (event.cross_module_shared_interface_conflict === true && event.deterministic_resolution_available === false) codes.push('T4');
  if (typeof event.root_cause_class === 'string' && ROOT_CAUSE_T5.has(event.root_cause_class)) codes.push('T5');
  if (Number.isSafeInteger(event.cross_component_regression_count) && event.cross_component_regression_count >= 2) codes.push('T6');
  if (event.bounded_muse_budget_exhausted === true && event.would_enter_blocked_architecture === true) codes.push('T7');
  return { triggered:codes.length>0, trigger_codes:codes };
}

export function evaluateAdvisorPermit(input = {}) {
  const triggerCodes = Array.isArray(input.trigger_codes) ? [...new Set(input.trigger_codes)] : [];
  if (triggerCodes.length < 1 || triggerCodes.some(x=>!OBJECTIVE_TRIGGER_CODES.includes(x))) {
    return {allow:false,dispatch_allowed:false,state:'NO_OBJECTIVE_TRIGGER',reason_codes:['OBJECTIVE_TRIGGER_REQUIRED']};
  }
  reqId(input.root_task_id,'ROOT_TASK_ID');
  const used=reqInt(input.calls_used,0,100,'CALLS_USED');
  const paidRoute = input.route === 'API_KEY_PAID_ROUTE' || input.api_key_paid_route === true;
  const zenPaid = input.zen_paid_fallback === true;
  const cost = input.incremental_usd ?? 0;
  if (paidRoute || zenPaid || cost !== 0) {
    return {allow:false,dispatch_allowed:false,state:'DENY',reason_codes:[
      ...(paidRoute?['API_KEY_PAID_ROUTE_DENIED']:[]),
      ...(zenPaid?['ZEN_PAID_FALLBACK_DENIED']:[]),
      ...(cost!==0?['INCREMENTAL_PAID_COST_DENIED']:[]),
    ]};
  }
  if (input.quota_state === 'UNKNOWN') return {allow:false,dispatch_allowed:false,state:'CONSERVE',reason_codes:['UNKNOWN_QUOTA_CONSERVE']};
  if (input.quota_state === 'RATE_LIMIT_429') return {allow:false,dispatch_allowed:false,state:'WAITING_ADVISOR_RESOURCE',reason_codes:['ADVISOR_429_WAIT']};
  if (input.quota_state !== 'AVAILABLE') return {allow:false,dispatch_allowed:false,state:'WAITING_ADVISOR_RESOURCE',reason_codes:['ADVISOR_QUOTA_UNAVAILABLE']};
  if (used >= 2) return {allow:false,dispatch_allowed:false,state:'BUDGET_EXHAUSTED',reason_codes:['MAX_TWO_ADVISOR_CALLS_HARD_CAP']};
  if (used === 1 && input.conflicting_evidence_reconciliation !== true) return {allow:false,dispatch_allowed:false,state:'BUDGET_EXHAUSTED',reason_codes:['SECOND_CALL_REQUIRES_CONFLICTING_EVIDENCE_RECONCILIATION']};
  const callOrdinal=used+1;
  return {allow:true,dispatch_allowed:true,state:'READY',call_ordinal:callOrdinal,max_default_calls:1,max_hard_calls:2,second_call_reason:callOrdinal===2?'CONFLICTING_EVIDENCE_RECONCILIATION':null,incremental_usd:0,paid_fallback_allowed:false};
}

export function buildAdvisorPacket(input = {}) {
  for (const key of Object.keys(input)) if (!ALLOWED_PACKET_KEYS.has(key)) fail('ADVISOR_PACKET_UNKNOWN_FIELD',key);
  if (!OBJECTIVE_TRIGGER_CODES.includes(input.trigger_code)) fail('INVALID_TRIGGER_CODE');
  const out={
    schema:'v48.advisor-packet.v1',
    trigger_code:input.trigger_code,
    project_id:reqId(input.project_id,'PROJECT_ID'),
    run_id:reqId(input.run_id,'RUN_ID'),
    root_task_id:reqId(input.root_task_id,'ROOT_TASK_ID'),
    task_id:reqId(input.task_id,'TASK_ID'),
    spec_digest:reqDigest(input.spec_digest,'SPEC_DIGEST'),
    contract_digest:reqDigest(input.contract_digest,'CONTRACT_DIGEST'),
    problem_statement:reqText(input.problem_statement,PACKET_LIMITS.problem_chars,'PROBLEM_STATEMENT'),
    failing_acceptance:reqText(input.failing_acceptance,PACKET_LIMITS.acceptance_chars,'FAILING_ACCEPTANCE'),
    deterministic_evidence:boundedStringArray(input.deterministic_evidence,PACKET_LIMITS.evidence_items,PACKET_LIMITS.evidence_item_chars,'DETERMINISTIC_EVIDENCE'),
    bounded_diff:reqText(input.bounded_diff,PACKET_LIMITS.diff_chars,'BOUNDED_DIFF'),
    dependency_ranked_symbols_interfaces:boundedStringArray(input.dependency_ranked_symbols_interfaces,PACKET_LIMITS.symbol_items,PACKET_LIMITS.symbol_chars,'DEPENDENCY_RANKED_SYMBOLS_INTERFACES'),
    repair_attempts:boundedStringArray(input.repair_attempts,PACKET_LIMITS.repair_attempts,PACKET_LIMITS.repair_attempt_chars,'REPAIR_ATTEMPTS'),
    reviewer_disagreement:reqText(input.reviewer_disagreement,PACKET_LIMITS.disagreement_chars,'REVIEWER_DISAGREEMENT'),
    requested_output:OUTPUTS.has(input.requested_output)?input.requested_output:(()=>{fail('INVALID_REQUESTED_OUTPUT')})(),
    authority:ADVISOR_AUTHORITY,
  };
  out.packet_digest=digest(out);
  return out;
}
