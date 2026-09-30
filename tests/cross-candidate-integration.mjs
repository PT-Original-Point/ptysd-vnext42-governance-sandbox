import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Supervisor } from '../src/core.ts';
import { createRecoveryEvidenceComposition } from '../src/recovery-evidence.ts';

const project='CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const expectedProducerHead='f1b95241b744bf57b924e5e7856f681fd20b216e';
const expectedPublisherBlob='a3b1925765d944f288279ee0242ed2592e713a35';
const candidateRoot=path.resolve(process.env.PTYSD_R2_03_WORKTREE||'');
assert.ok(process.env.PTYSD_R2_03_WORKTREE,'set PTYSD_R2_03_WORKTREE to the exact PR #342 worktree');
assert.equal(execFileSync('git',['-C',candidateRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),expectedProducerHead);
const publisherPath=path.join(candidateRoot,'tools','csg','factory-mcp','broker','owner-liveness-publisher.ps1');
assert.equal(execFileSync('git',['-C',candidateRoot,'hash-object',publisherPath],{encoding:'utf8'}).trim(),expectedPublisherBlob);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'v51-r2-cross-candidate-'));
const state=path.join(root,'state'); fs.mkdirSync(state);
const publicationPath=path.join(state,'owner-liveness.json');
const ps=String.raw`$payloadBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())
$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($payloadBytes)); . $payload.script_path
$state=$payload.state_directory
function Get-OwnerLivenessPublisherIdentitySid { return 'S-1-5-18' }
function Test-OwnerLivenessStateDirectoryBoundary { return $true }
function Test-OwnerLivenessProtectedReadFile { param([string]$Path) return $true }
function Set-OwnerLivenessPublishedFileAcl { param([string]$Path) }
function Get-CimInstance { param([string]$ClassName,[string]$Filter,[string]$ErrorAction) return @(
  [pscustomobject]@{Name='Codex.exe';ProcessId=101;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-5))},
  [pscustomobject]@{Name='ChatGPT.exe';ProcessId=102;CreationDate=[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddMinutes(-4))}) }
function Invoke-CimMethod { param($InputObject,[string]$MethodName,[string]$ErrorAction) return [pscustomobject]@{ReturnValue=0;Domain='TEST';User='Executor'} }
function Get-ScheduledTask { param([string]$TaskName,[string]$ErrorAction) return [pscustomobject]@{State='Disabled';Settings=[pscustomobject]@{Enabled=$false};Principal=[pscustomobject]@{UserId='x'}} }
$null=Publish-OwnerLivenessSnapshot
$published=[IO.File]::ReadAllText((Join-Path $state 'owner-liveness.json')) | ConvertFrom-Json
[Console]::Out.Write([string]$published.publisher_status)`;

try {
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{
    input:Buffer.from(JSON.stringify({script_path:publisherPath,state_directory:state}),'utf8').toString('base64'),
    encoding:'utf8',timeout:30000,windowsHide:true,
  });
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.equal(result.stdout.trim(),'PUBLISHED',JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message}));
  const publication=JSON.parse(fs.readFileSync(publicationPath,'utf8'));
  assert.deepEqual(publication.recovery_evidence,{schema:'PTYSD_RECOVERY_EVIDENCE_REFERENCES_V1',status:'UNAVAILABLE',
    reason_code:'TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED'});

  const runtimeRoot=process.cwd();
  const manifest=JSON.parse(fs.readFileSync(path.join(runtimeRoot,'config/runtime-manifest.json'),'utf8'));
  manifest.recovery_evidence.publication={status:'AVAILABLE',route_id:'PTYSD_FACTORY_MCP_OWNER_LIVENESS_PUBLICATION_V1',reason_code:null};
  const manifestPath=path.join(root,'runtime-manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest),{flag:'wx'});
  const composition=createRecoveryEvidenceComposition(manifestPath,project,Date.now(),{
    ownerLivenessPublication:{readCurrent:()=>fs.readFileSync(publicationPath)},
  });
  assert.throws(()=>composition.readCurrentObservation(),
    /OWNER_LIVENESS_SIGNED_EVIDENCE_UNAVAILABLE:TRUSTED_SIGNED_EVIDENCE_NOT_CONFIGURED/);

  let now=1000;
  const supervisor=new Supervisor(path.join(root,'runtime.db'),project,()=>now,composition.trust);
  try {
    supervisor.ingest({schema:'PTYSD_TASK_ENVELOPE_V1',task_id:'gen5-task',project_id:project,interrupt_epoch:0,
      objective:'integration fixture',provider_write:false,allowed_paths:['sandbox/**'],evidence_required:['TEST_PASS'],
      provider:'codex',owner_principal_id:'owner-gen5',owner_session_id:'session-gen5',provider_session_id:'provider-gen5'});
    supervisor.dispatch('gen5-task','worker-1',100);
    now=1200; supervisor.tick();
    assert.equal(supervisor.runtime().recovery_required,true);
    assert.throws(()=>supervisor.dispatch('next-task','worker-2',60000),/RECOVERY_REQUIRED/);
    assert.equal(supervisor.recoveryReceipts().length,0);
  } finally { supervisor.close(); }
  process.stdout.write('CROSS_CANDIDATE_PRODUCER_TO_RECOVERY_TRUST_FAIL_CLOSED_PASS\n');
} finally {
  const resolved=path.resolve(root), tempRoot=path.resolve(os.tmpdir()), info=fs.lstatSync(resolved);
  assert.equal(info.isDirectory(),true); assert.equal(info.isSymbolicLink(),false); assert.equal(path.dirname(resolved),tempRoot);
  fs.rmSync(resolved,{recursive:true,force:true});
}
