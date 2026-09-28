import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicyRequest } from '../policy-middleware.mjs';
import { compileAuthorizationEnvelope,compileHumanReservationPermit } from '../authorization-envelope.mjs';

const identity={project_id:'P',run_id:'R',task_id:'T',attempt_id:'A',attempt_epoch:1};
const capability={schema:'v48.cell-capability.v1',...identity,owned_paths:['src'],read_paths:['docs'],forbidden_paths:['governance'],resource_limits:{cpu_millis:1000,memory_mib:512,pids:32,disk_mib:128,provider_calls:0,network_mode:'DENY'},data_class:['PUBLIC','SYNTHETIC'],model_profile_id:'M1',model_profile_revision:'R1',execution_authorized:false};
const request=()=>({effect_class:'READ_ONLY',path:'docs/readme.md',resource_usage:{cpu_millis:10,memory_mib:16,pids:1,disk_mib:0,provider_calls:0,network_mode:'DENY'},data_class:'PUBLIC',model_profile_id:'M1',model_profile_revision:'R1',paid_fallback_allowed:false,incremental_usd:0,permission_decision:'ALLOW',interactive:false,ambient_env:{},secret_refs:[],git_argv:[],dispatch_requested:false});
const model=()=>({project_id:'P',profile_id:'M1',revision:'R1',data_classes:['PUBLIC','SYNTHETIC'],paid_fallback_allowed:false,incremental_usd:0,entitlement:'PASS_CURRENT_REAL_INFERENCE',expires_at:'2026-09-19T00:00:00Z'});
const cred=()=>({project_id:'P',profile_id:'C1',allowed_secret_refs:['secret://P/opencode'],raw_secret_values_present:false});

const authMission={project_id:'P',revision:'M1',hash:'sha256:'+'1'.repeat(64)};
const authSource={authorization_id:'AUTH-001',project_id:'P',mission_revision:'M1',mission_hash:authMission.hash,valid_until_mission_revision:'M1',scope_tags:['CURRENT_MISSION_PLAN'],allowed_mutation_classes:['LOCAL_PREPARATION','LOCAL_EXECUTION','PROVIDER_EFFECT'],forbidden_actions:[],human_reservations:['CODEX_LAST_MILE'],human_authorization_ref:'canonical://human/directive/20260921',issued_at:'2026-09-21T05:31:00Z'};

const evalReq=(overrides={},extra={})=>evaluatePolicyRequest({identity,capability,request:{...request(),...overrides},model_profile:model(),credential_profile:cred(),now:'2026-09-18T00:00:00Z',...extra});

test('baseline policy allows but shadow capability cannot dispatch',()=>{const x=evalReq();assert.equal(x.allow,true);assert.equal(x.dispatch_allowed,false);assert.equal(x.shadow_only,true);});
test('stale attempt epoch denies',()=>{const x=evaluatePolicyRequest({identity:{...identity,attempt_epoch:2},capability,request:request(),model_profile:model(),credential_profile:cred(),now:'2026-09-18T00:00:00Z'});assert.equal(x.allow,false);assert.ok(x.reason_codes.includes('STALE_ATTEMPT_EPOCH'));});
test('dot-dot traversal denies',()=>{const x=evalReq({path:'src/../governance/x',effect_class:'LOCAL_PREPARATION'});assert.ok(x.reason_codes.includes('PATH_TRAVERSAL'));});
test('absolute path denies',()=>{const x=evalReq({path:'/etc/passwd'});assert.ok(x.reason_codes.includes('PATH_ABSOLUTE_OR_SEPARATOR_ALIAS'));});
test('NUL path denies',()=>{const x=evalReq({path:'src/a\0b',effect_class:'LOCAL_PREPARATION'});assert.ok(x.reason_codes.includes('PATH_NUL'));});
test('NTFS 8.3 alias denies',()=>{const x=evalReq({path:'src/PROGRA~1/x',effect_class:'LOCAL_PREPARATION'});assert.ok(x.reason_codes.includes('PATH_NTFS_83_ALIAS'));});
test('case-fold forbidden alias is denied',()=>{const x=evalReq({path:'GoVeRnAnCe/current.json'});assert.ok(x.reason_codes.includes('PATH_FORBIDDEN'));});
test('symlink escape fact denies',()=>{const x=evalReq({path:'src/link/x',effect_class:'LOCAL_PREPARATION',path_resolution:{has_symlink:true,trusted:true,resolved_repo_relative:'../outside/x'}});assert.ok(x.reason_codes.includes('PATH_TRAVERSAL'));});
test('untrusted symlink resolution denies',()=>{const x=evalReq({path:'src/link/x',effect_class:'LOCAL_PREPARATION',path_resolution:{has_symlink:true,trusted:false,resolved_repo_relative:'src/x'}});assert.ok(x.reason_codes.includes('PATH_RESOLUTION_REQUIRED'));});
test('git config hook injection denies',()=>{const x=evalReq({git_argv:['git','-c','core.hooksPath=/tmp/pwn','status']});assert.ok(x.reason_codes.includes('GIT_CONFIG_OR_HOOK_INJECTION'));});
test('git config environment injection denies',()=>{const x=evalReq({ambient_env:{GIT_CONFIG_COUNT:'1'}});assert.ok(x.reason_codes.includes('GIT_ENV_INJECTION'));});
test('ambient secret inheritance denies',()=>{const x=evalReq({ambient_env:{OPENAI_API_KEY:'secret'}});assert.ok(x.reason_codes.includes('AMBIENT_SECRET_INHERITANCE'));});
test('noninteractive ASK becomes DENY',()=>{const x=evalReq({permission_decision:'ASK',interactive:false});assert.ok(x.reason_codes.includes('NONINTERACTIVE_ASK_DENY'));});
test('wrong project credential profile secret access denies',()=>{const x=evalReq({secret_refs:['secret://P/opencode']},{credential_profile:{...cred(),project_id:'OTHER'}});assert.ok(x.reason_codes.includes('CREDENTIAL_PROFILE_WRONG_PROJECT'));});
test('unknown secret ref denies',()=>{const x=evalReq({secret_refs:['secret://P/not-allowed']});assert.ok(x.reason_codes.includes('SECRET_REF_NOT_ALLOWED'));});
test('raw secret values deny',()=>{const x=evalReq({raw_secrets:{x:'y'}});assert.ok(x.reason_codes.includes('RAW_SECRET_OR_PROVIDER_WRITE_CREDENTIAL_FORBIDDEN'));});
test('missing required model profile denies',()=>{const x=evalReq({}, {model_profile:null});assert.ok(x.reason_codes.includes('MODEL_PROFILE_REQUIRED'));});
test('expired or unknown model entitlement denies',()=>{const x=evalReq({}, {model_profile:{...model(),entitlement:'UNKNOWN'}});assert.ok(x.reason_codes.includes('MODEL_PROFILE_ENTITLEMENT_UNKNOWN'));});
test('wrong project model profile denies',()=>{const x=evalReq({}, {model_profile:{...model(),project_id:'OTHER'}});assert.ok(x.reason_codes.includes('MODEL_PROFILE_WRONG_PROJECT'));});
test('paid fallback denies',()=>{const x=evalReq({paid_fallback_allowed:true,incremental_usd:1});assert.ok(x.reason_codes.includes('PAID_FALLBACK_FORBIDDEN'));});
test('resource widening denies',()=>{const x=evalReq({resource_usage:{cpu_millis:1001,memory_mib:16,pids:1,disk_mib:0,provider_calls:0,network_mode:'DENY'}});assert.ok(x.reason_codes.includes('RESOURCE_WIDEN_CPU_MILLIS'));});
test('provider effect requires ProviderGuard and provider permit',()=>{const x=evalReq({effect_class:'PROVIDER_EFFECT',path:undefined,effect_boundary:'OTHER',provider_permit_granted:false});assert.ok(x.reason_codes.includes('PROVIDERGUARD_REQUIRED'));assert.ok(x.reason_codes.includes('PROVIDER_PERMIT_REQUIRED'));});
test('human reserved effect requires human permit',()=>{const x=evalReq({effect_class:'HUMAN_RESERVED',path:undefined,human_permit_granted:false});assert.ok(x.reason_codes.includes('HUMAN_PERMIT_REQUIRED'));});
test('exact same input produces same decision digest',()=>{const a=evalReq(),b=evalReq();assert.equal(a.decision_digest,b.decision_digest);});

test('mutating policy request requires durable authorization envelope',()=>{
  const x=evalReq({effect_class:'LOCAL_EXECUTION',path:'src/x',action_id:'BUILD_TEST',authorization_scope_tag:'CURRENT_MISSION_PLAN'});
  assert.equal(x.allow,false); assert.ok(x.reason_codes.some(c=>c.startsWith('AUTHORIZATION_ENVELOPE_SCHEMA_MISMATCH')));
});
test('valid durable envelope authorizes in-scope local execution but does not change shadow dispatch authority',()=>{
  const envelope=compileAuthorizationEnvelope(authSource,authMission);
  const x=evalReq({effect_class:'LOCAL_EXECUTION',path:'src/x',action_id:'BUILD_TEST',authorization_scope_tag:'CURRENT_MISSION_PLAN'},{authorization_envelope:envelope,current_mission:authMission});
  assert.equal(x.allow,true); assert.equal(x.dispatch_allowed,false); assert.equal(x.authorization_id,'AUTH-001');
});
test('tool ASK is classified separately from human authorization',()=>{
  const envelope=compileAuthorizationEnvelope(authSource,authMission);
  const x=evalReq({effect_class:'LOCAL_EXECUTION',path:'src/x',action_id:'BUILD_TEST',authorization_scope_tag:'CURRENT_MISSION_PLAN',permission_decision:'ASK',interactive:false},{authorization_envelope:envelope,current_mission:authMission});
  assert.equal(x.allow,false); assert.equal(x.tool_confirmation_required,true); assert.equal(x.human_authorization_required,false);
});
test('legacy human_permit_granted true cannot bypass reservation',()=>{
  const s={...authSource,allowed_mutation_classes:[...authSource.allowed_mutation_classes,'HUMAN_RESERVED']};
  const envelope=compileAuthorizationEnvelope(s,authMission);
  const x=evalReq({effect_class:'HUMAN_RESERVED',path:undefined,action_id:'CODEX_LAST_MILE',authorization_scope_tag:'CURRENT_MISSION_PLAN',human_permit_granted:true},{authorization_envelope:envelope,current_mission:authMission});
  assert.equal(x.allow,false); assert.ok(x.reason_codes.some(c=>c.startsWith('HUMAN_PERMIT_REQUIRED')));
});
test('exact reservation permit is distinct from envelope and authorizes only exact action',()=>{
  const s={...authSource,allowed_mutation_classes:[...authSource.allowed_mutation_classes,'HUMAN_RESERVED']};
  const envelope=compileAuthorizationEnvelope(s,authMission);
  const permit=compileHumanReservationPermit({permit_id:'PERMIT-001',project_id:'P',mission_revision:'M1',mission_hash:authMission.hash,action_id:'CODEX_LAST_MILE',human_authorization_ref:'canonical://human/codex',issued_at:'2026-09-21T05:32:00Z'},authMission);
  const x=evalReq({effect_class:'HUMAN_RESERVED',path:undefined,action_id:'CODEX_LAST_MILE',authorization_scope_tag:'CURRENT_MISSION_PLAN'},{authorization_envelope:envelope,current_mission:authMission,human_reservation_permit:permit});
  assert.equal(x.allow,true); assert.equal(x.human_authorization_required,false);
});
