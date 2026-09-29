import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const s=fs.readFileSync(new URL('../ptysd-autonomy-supervisor.ps1',import.meta.url),'utf8');
const r=fs.readFileSync(new URL('../register-autonomy-supervisor.ps1',import.meta.url),'utf8');

test('uses bounded noninteractive codex exec with schema-bound output',()=>{
  assert.match(s,/exec --json --approve-for-me/);
  assert.doesNotMatch(s,/exec --json --full-auto/);
  assert.match(s,/--output-schema/);
  assert.match(s,/--output-last-message/);
  assert.match(s,/markerPattern/);
});

test('same fingerprint does not suppress READY work and repeated actions are lane-local',()=>{
  assert.match(s,/readiness_fingerprint/);
  assert.match(s,/MaxNoProgressOperations/);
  assert.match(s,/DUPLICATE_UNCHANGED_ACTION_SUPPRESSED/);
  assert.doesNotMatch(s,/MaxSameFingerprintRetries/);
  assert.doesNotMatch(s,/if\(\$same -and .*\)\{exit 0\}/);
  assert.match(s,/FileShare\]::None/);
  const prior=s.indexOf('$priorActionHash=[string]$lastActionHashes[$selected]');
  const dispatch=s.indexOf('$run=Invoke-CodexBounded');
  const persisted=s.indexOf('if($result -and $afterDigest -eq $currentDigest){$lastActionHashes[$selected]=$actionHash}');
  assert.ok(prior>=0&&dispatch>prior&&persisted>dispatch);
});

test('production path invokes the scheduler and durable fingerprint bridge before and after turns',()=>{
  assert.match(s,/function Invoke-SupervisorControl/);
  assert.match(s,/Invoke-SupervisorControl -Fingerprint \$material -Units \$units/);
  assert.match(s,/Invoke-SupervisorControl -Fingerprint \$materialAfter -Units \$units/);
  assert.match(s,/while\(\$true\)/);
  assert.match(s,/TURN_COMPLETED_PROVIDER_DELTA_RECOMPUTE_READY/);
});

test('provider fingerprint binds current authority, PR exact tree and local supervisor sources',()=>{
  assert.match(s,/Project Directory active_run_ref/);
  assert.match(s,/canonical control pointer/);
  assert.match(s,/checkpoint and referenced run/);
  assert.match(s,/directory\/projects\/CHATGPT_GLOBAL_SKILL_GOVERNANCE\.json/);
  assert.match(s,/Issue #310/);
  assert.match(s,/ImplementationPullRequest=322/);
  assert.match(s,/tree_sha=\$prCommit\.tree\.sha/);
  assert.match(s,/prFileBindings/);
  assert.match(s,/Get-SupervisorSourceReadback/);
  assert.match(s,/Get-WorkspaceReadback/);
  assert.match(s,/commentPage=if\(\$commentCount -gt 0\)/);
  assert.match(s,/New-Object 'System\.Collections\.Generic\.Queue\[object\]'/);
  assert.match(s,/\[int64\]\$commentItem\.id -gt \[int64\]\$latestComment\.id/);
  assert.doesNotMatch(s,/latestComment=\$comments\[\$comments\.Count-1\]/);
  assert.match(s,/runtime=Get-NodeRuntimeReadback/);
  assert.match(s,/function Get-NodeRuntimeReadback/);
  assert.match(s,/selected_sha256=/);
  assert.match(s,/node_version=/);
  assert.match(s,/runtime\.selected_path/);
  assert.match(s,/directory_active_ref_consistent=\[bool\]\$Fingerprint\.coherence/);
  assert.match(s,/checkpoint_task_id=\[string\]\$Fingerprint\.checkpoint\.task_id/);
  assert.match(s,/run_identity_matches_checkpoint=\[bool\]\$Fingerprint\.coherence/);
  assert.match(s,/keep noncanonical coherence-repair preparation READY, and recompute unrelated lanes normally/);
  const readiness=JSON.parse(fs.readFileSync(new URL('../schemas/readiness-result.schema.json',import.meta.url),'utf8'));
  assert.ok(readiness.properties.authority_readback.required.includes('run_identity_matches_checkpoint'));
  assert.equal(readiness.properties.authority_readback.properties.directory_active_ref_consistent.type,'boolean');
  assert.doesNotMatch(s,/PR #316/);
});

test('mission, permits, Production, cost and unknown-effect boundaries remain in the executor prompt',()=>{
  assert.match(s,/every provider\/backend permit gate/);
  assert.match(s,/Do not mutate Host, Production, business projects, credentials, paid services/);
  assert.match(s,/never redispatch OP025 while UNKNOWN/);
  assert.match(s,/OAuth\/MFA/);
});

test('scheduled task is current-user limited and never launches Codex as SYSTEM',()=>{
  assert.match(r,/New-ScheduledTaskPrincipal -UserId \$user -LogonType Interactive -RunLevel Limited/);
  assert.match(r,/New-ScheduledTaskTrigger -AtLogOn -User \$user/);
  assert.doesNotMatch(r,/RunLevel Highest|ServiceAccount|UserId 'SYSTEM'/);
  assert.match(s,/CODEX_EXECUTOR_MUST_RUN_WITH_UNPRIVILEGED_CURRENT_USER_TOKEN/);
  assert.match(s,/IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
  assert.match(s,/StateRoot=\(Join-Path \$env:LOCALAPPDATA/);
});

test('installer fails closed on an existing task or file and keeps installation under LocalAppData',()=>{
  assert.match(r,/INSTALL_ROOT_MUST_BE_CURRENT_USER_SCOPED/);
  assert.match(r,/EXISTING_SUPERVISOR_TASK_REQUIRES_EXACT_BACKUP_AND_READBACK/);
  assert.match(r,/SUPERVISOR_INSTALL_TARGET_EXISTS_REQUIRES_EXACT_BACKUP_AND_READBACK/);
  for(const f of ['ptysd-autonomy-supervisor.ps1','lib\\fingerprint.mjs','lib\\scheduler.mjs','lib\\supervisor-control.mjs','lib\\BoundedPipeCapture.cs','schemas\\readiness-result.schema.json']) assert.ok(r.includes(f),`missing installed runtime dependency ${f}`);
  assert.match(r,/NO_POLICY_COMPLIANT_POWERSHELL_RUNTIME/);
  assert.doesNotMatch(r,/ExecutionPolicy\s+Bypass/i);
  assert.doesNotMatch(r,/Copy-Item[^\r\n]*-Force/i);
  assert.match(r,/Register-ScheduledTask/);
});

test('installer side effects are inside ShouldProcess and runtime path preserves sibling dependencies',()=>{
  const guard=r.indexOf('$PSCmdlet.ShouldProcess');
  assert.ok(guard>=0);
  for(const marker of ['New-Item -ItemType Directory -Path $stageRoot','Copy-Item -LiteralPath $entry.source','Move-Item -LiteralPath $stageRoot','Register-ScheduledTask','Start-ScheduledTask']) assert.ok(r.indexOf(marker)>guard,`${marker} must be after ShouldProcess`);
  assert.match(r,/Join-Path \$InstallRoot 'ptysd-autonomy-supervisor\.ps1'/);
  assert.match(r,/-File "'\+\$installedScript\+'"/);
});

test('canonical authority remains usable without continuity projections',()=>{
  assert.match(s,/Continuity CURRENT\.json\/snapshots are optional derived projections/);
  assert.match(s,/if missing or stale, reconstruct from canonical sources/);
  assert.match(s,/Project Directory active_run_ref/);
});

test('production supervisor records and revalidates OS process identity',()=>{
  assert.match(s,/process_id=\$pidValue/);
  assert.match(s,/active_started_utc/);
  assert.match(s,/Test-TrackedCodexProcess/);
  assert.doesNotMatch(s,/Start-Job|JobStateInfo\.InstanceId/);
});

test('timeout and root-exit paths contain and verify the complete Codex process tree',()=>{
  assert.match(s,/taskkill \/PID \$RootPid \/T \/F/);
  assert.match(s,/cleanup_proven=\(\$remaining\.Count -eq 0\)/);
  assert.match(s,/KillOnCloseProcessJob\]::Assign\(\$process\)/);
  assert.match(s,/ActiveProcessCount/);
  assert.match(s,/process_tree_cleanup_proven=/);
  assert.match(s,/PROCESS_TREE_CLEANUP_UNPROVEN/);
  assert.match(s,/unresolved_process_ids/);
  assert.ok(s.indexOf('KillOnCloseProcessJob]::Assign($process)')<s.indexOf('$process.StandardInput.Write($Prompt)'));
});

test('public GitHub provider fallback uses GET when gh is absent',()=>{
  assert.match(s,/Get-Command gh\.exe -CommandType Application/);
  assert.match(s,/https:\/\/api\.github\.com/);
  assert.match(s,/Invoke-RestMethod -Method Get/);
  assert.match(s,/X-GitHub-Api-Version/);
});

test('read-only preflight exits before persistent state writes or Codex dispatch',()=>{
  const start=s.indexOf('if($ReadOnlyPreflight)');
  const end=s.indexOf('New-Item -ItemType Directory -Force -Path $StateRoot');
  assert.ok(start>=0&&end>start);
  const block=s.slice(start,end);
  assert.match(block,/Provider-Fingerprint/);
  assert.match(block,/Invoke-SupervisorControl/);
  assert.match(block,/state_root_mutated=\$false/);
  assert.doesNotMatch(block,/Start-Job|Write-AtomicJson|New-Item|codex exec/);
});

test('TURN_COMPLETED is an iteration result and does not end the project loop',()=>{
  assert.match(s,/record\.last_turn_marker=\[bool\]\$run\.turn_completed/);
  assert.match(s,/\$materialAfter=Provider-Fingerprint/);
  assert.match(s,/\$nextControl=Invoke-SupervisorControl/);
  assert.match(s,/goal_completed=\$false/);
  assert.doesNotMatch(s,/if\(\$completed\)\{exit 0\}/);
});

test('bounded capture uses byte-limited stream drains',()=>{
  const c=fs.readFileSync(new URL('../lib/BoundedPipeCapture.cs',import.meta.url),'utf8');
  assert.match(s,/BoundedPipeCapture\]::DrainAsync/);
  assert.doesNotMatch(s,/ReadToEndAsync/);
  assert.match(c,/byte\[\] buffer = new byte\[8192\]/);
  assert.match(c,/BytesStored = bytesStored/);
});
