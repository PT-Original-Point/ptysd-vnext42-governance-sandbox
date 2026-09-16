function fail(code){const e=new Error(code);e.code=code;throw e;}
export function evaluateNonBypassTrust(snapshot){
  if(!snapshot||typeof snapshot!=='object')fail('SNAPSHOT_REQUIRED');
  const findings=[];
  if(snapshot.canonical_branch_protected!==true)findings.push('CANONICAL_BRANCH_UNPROTECTED');
  if(snapshot.required_status_checks_enforcement!=='enforced')findings.push('REQUIRED_STATUS_CHECKS_NOT_ENFORCED');
  if(!Array.isArray(snapshot.required_checks)||snapshot.required_checks.length<1)findings.push('NO_TRUSTED_REQUIRED_CHECK');
  if(!Array.isArray(snapshot.rulesets)||snapshot.rulesets.length<1)findings.push('NO_REPOSITORY_RULESET');
  if(snapshot.normal_actor_can_push_raw===true)findings.push('NORMAL_ACTOR_RAW_PUSH_CAPABLE');
  if(snapshot.normal_actor_admin===true)findings.push('NORMAL_ACTOR_ADMIN_CAPABLE');
  if(snapshot.candidate_can_modify_rules===true)findings.push('CANDIDATE_CAN_MODIFY_RULES');
  if(snapshot.candidate_can_forge_required_check===true)findings.push('CANDIDATE_CAN_FORGE_REQUIRED_CHECK');
  if(snapshot.verifier_trust_root_pinned!==true)findings.push('VERIFIER_TRUST_ROOT_NOT_PINNED');
  if(snapshot.recovery_channel_scoped!==true)findings.push('RECOVERY_CHANNEL_NOT_SCOPED');
  return {pass:findings.length===0,findings};
}
export function requireNonBypass(snapshot){const r=evaluateNonBypassTrust(snapshot);if(!r.pass)fail(`NONBYPASS_BLOCKED:${r.findings.join(',')}`);return r;}
