import {createHash} from 'node:crypto';

const SHA=/^sha256:[0-9a-f]{64}$/i;
const GH=/^github:\/\/[1-9][0-9]*\/.+@[0-9a-f]{40}$/i;
const PRIVATE_V4=[/^10\./,/^127\./,/^169\.254\./,/^172\.(1[6-9]|2\d|3[01])\./,/^192\.168\./];
const req=(v,n)=>{if(typeof v!=='string'||!v.trim())throw new Error(`INVALID_${n}`);return v;};
const arr=(v,n)=>{if(!Array.isArray(v))throw new Error(`INVALID_${n}`);return v;};
const digest=v=>`sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`;

export function validateResearchEnvelope(c){
  if(!c||c.schema_version!=='factory.research.v1')throw new Error('RESEARCH_CONTRACT_REQUIRED');
  for(const f of ['research_id','project_id','request_ref','decision_needed','baseline_ref','baseline_digest'])req(c[f],f.toUpperCase());
  if(!SHA.test(c.baseline_digest))throw new Error('INVALID_BASELINE_DIGEST');
  if(arr(c.questions,'QUESTIONS').length<1)throw new Error('QUESTIONS_REQUIRED');
  if(!Number.isInteger(c.minimum_options)||c.minimum_options<3)throw new Error('MINIMUM_OPTIONS_LT_3');
  if(c.human_decision_required!==true)throw new Error('HUMAN_DECISION_REQUIRED');
  if(c.evidence_policy!=='primary_sources_with_counterevidence')throw new Error('INVALID_EVIDENCE_POLICY');
  if(c.coding_dispatch_allowed!==false)throw new Error('CODING_DISPATCH_MUST_BE_FALSE');
  return true;
}
function deniedHost(raw){
  const h=raw.toLowerCase().replace(/^\[|\]$/g,'');
  return h==='localhost'||h==='::1'||h==='0.0.0.0'||h==='169.254.169.254'||h.endsWith('.localhost')||h.endsWith('.local')||PRIVATE_V4.some(x=>x.test(h));
}
export async function fetchResearchSourceSafely(candidate,fetchFn){
  if(typeof fetchFn!=='function')throw new Error('FETCH_FUNCTION_REQUIRED');
  let u;try{u=new URL(req(candidate?.url,'SOURCE_URL'));}catch{return{status:'REJECTED',reason:'INVALID_SOURCE_URL',egress_log:[],file_reads:0,instructions_executed:0};}
  if(!['http:','https:'].includes(u.protocol)||deniedHost(u.hostname))return{status:'REJECTED',reason:'NETWORK_TARGET_DENIED',egress_log:[],file_reads:0,instructions_executed:0};
  const content=String(await fetchFn(u.href));
  const suspicious=/(read\s+(?:the\s+)?secrets?|\/etc\/|\.ssh|169\.254\.169\.254|localhost|127\.0\.0\.1|curl\s+|powershell\s+)/i.test(content);
  return{status:'INGESTED',url:u.href,content,trust:suspicious?'LOW_UNTRUSTED_INSTRUCTION_TEXT':'NORMAL_UNTRUSTED_SOURCE',prompt_injection_suspected:suspicious,egress_log:[u.href],file_reads:0,instructions_executed:0};
}
export function validateResearchArtifacts({researchContract,plan,report,claims,sources}){
  validateResearchEnvelope(researchContract);
  if(plan?.schema!=='factory.research_plan.v1'||report?.schema!=='factory.research_report.v1'||claims?.schema!=='factory.research_claims.v1')throw new Error('RESEARCH_ARTIFACT_SCHEMA_MISMATCH');
  for(const x of [plan,report,claims])if(x.research_id!==researchContract.research_id)throw new Error('RESEARCH_ID_MISMATCH');
  if(report.coding_dispatch_count!==0)throw new Error('CODING_DISPATCH_BEFORE_DECISION');
  if(report.decision_state!=='PENDING_HUMAN')throw new Error('DECISION_STATE_NOT_PENDING_HUMAN');
  const options=arr(report.options,'OPTIONS');if(options.length<researchContract.minimum_options)throw new Error('INSUFFICIENT_OPTIONS');
  if(new Set(options.map(x=>x.option_id)).size!==options.length)throw new Error('DUPLICATE_OPTION_ID');
  const recommended=options.filter(x=>x.recommended===true);if(recommended.length!==1||report.recommendation_id!==recommended[0].option_id)throw new Error('EXACTLY_ONE_RECOMMENDATION_REQUIRED');
  for(const o of options){req(o.option_id,'OPTION_ID');req(o.summary,'OPTION_SUMMARY');if(!Array.isArray(o.counterevidence)||o.counterevidence.length<1)throw new Error('COUNTEREVIDENCE_REQUIRED');}
  if(!Array.isArray(report.unknowns))throw new Error('UNKNOWNS_REQUIRED');
  const rows=arr(sources,'SOURCES'), sourceMap=new Map(rows.map(x=>[x.source_id,x]));
  for(const s of rows){req(s.source_id,'SOURCE_ID');if(!GH.test(req(s.ref,'SOURCE_REF')))throw new Error('SOURCE_REF_NOT_IMMUTABLE');if(!SHA.test(req(s.sha256,'SOURCE_SHA256')))throw new Error('INVALID_SOURCE_SHA256');}
  const claimRows=arr(claims.claims,'CLAIMS'), claimIds=new Set();
  for(const c of claimRows){req(c.claim_id,'CLAIM_ID');if(claimIds.has(c.claim_id))throw new Error('DUPLICATE_CLAIM_ID');claimIds.add(c.claim_id);req(c.statement,'CLAIM_STATEMENT');req(c.evidence_level,'EVIDENCE_LEVEL');req(c.support_summary,'SUPPORT_SUMMARY');if(!Array.isArray(c.counterevidence))throw new Error('CLAIM_COUNTEREVIDENCE_REQUIRED');for(const ref of arr(c.source_refs,'CLAIM_SOURCE_REFS'))if(!sourceMap.has(ref))throw new Error('UNRESOLVED_SOURCE_REF');}
  for(const o of options)for(const id of arr(o.claim_refs,'OPTION_CLAIM_REFS'))if(!claimIds.has(id))throw new Error('UNRESOLVED_CLAIM_REF');
  for(const id of arr(report.claim_refs,'REPORT_CLAIM_REFS'))if(!claimIds.has(id))throw new Error('UNRESOLVED_REPORT_CLAIM_REF');
  return{accepted:true,artifact_digest:digest({plan,report,claims,sources}),source_count:rows.length,claim_count:claimRows.length,option_count:options.length};
}
