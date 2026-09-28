#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ProjectId='CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  [string]$Repo='PT-Original-Point/ptysd-vnext42-governance-sandbox',
  [int]$IssueNumber=310,
  [int]$R4PullRequest=316,
  [string]$Workspace='C:\Users\x\Documents\ChatGPT\治理控制-自動軟體工廠',
  [string]$CodexHome='C:\Users\x\.codex',
  [string]$StateRoot='C:\ProgramData\PTYSD\AutonomySupervisor',
  [int]$MaxRunSeconds=2700,
  [int]$MaxSameFingerprintRetries=1,
  [switch]$ReadOnlyPreflight
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Write-AtomicJson([string]$Path,[object]$Value){
  $tmp=$Path+'.tmp.'+$PID
  [IO.File]::WriteAllText($tmp,($Value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Read-State([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){return $null}
  try{return Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json}catch{return $null}
}
function Get-Sha256([string]$Text){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Gh([string]$ApiPath){
  $g=Get-Command gh.exe -ErrorAction SilentlyContinue
  if(-not $g){$g=Get-Command gh -ErrorAction SilentlyContinue}
  if($g){
    $o=& $g.Source api $ApiPath 2>&1
    if($LASTEXITCODE -ne 0){throw ('GH_API_FAILED: '+($o -join "`n"))}
    return (($o -join "`n")|ConvertFrom-Json)
  }
  if($PSVersionTable.PSVersion.Major -le 5){[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12}
  $uri='https://api.github.com/'+$ApiPath.TrimStart('/')
  $headers=@{
    'Accept'='application/vnd.github+json'
    'X-GitHub-Api-Version'='2022-11-28'
    'User-Agent'='PTYSD-VNext5-AutonomySupervisor'
  }
  try{return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 20}
  catch{throw ('GITHUB_READ_FAILED: '+$_.Exception.Message)}
}
function Provider-Fingerprint {
  $d=Gh ('repos/'+$Repo+'/branches/governance/project-directory')
  $c=Gh ('repos/'+$Repo+'/branches/v45/factory-control')
  $p=Gh ('repos/'+$Repo+'/pulls/'+$R4PullRequest)
  $m=Gh ('repos/'+$Repo+'/issues/'+$IssueNumber+'/comments?per_page=100')
  $last='NONE'
  if($m.Count -gt 0){$last=[string]$m[$m.Count-1].id}
  $material=[ordered]@{project_id=$ProjectId;directory_head=$d.commit.sha;control_head=$c.commit.sha;r4_head=$p.head.sha;mailbox_last_comment_id=$last}
  $j=$material|ConvertTo-Json -Compress
  return [ordered]@{digest=('sha256:'+(Get-Sha256 $j));material=$material}
}


if($ReadOnlyPreflight){
  try{
    $fp=Provider-Fingerprint
    [ordered]@{schema='vnext5.r4.autonomy-supervisor-preflight.v1';project_id=$ProjectId;mode='READ_ONLY_PREFLIGHT';result='PASS';fingerprint=$fp.digest;material=$fp.material;state_root_mutated=$false;codex_dispatched=$false}|ConvertTo-Json -Compress
    exit 0
  }catch{
    [ordered]@{schema='vnext5.r4.autonomy-supervisor-preflight.v1';project_id=$ProjectId;mode='READ_ONLY_PREFLIGHT';result='FAIL';error=$_.Exception.Message;state_root_mutated=$false;codex_dispatched=$false}|ConvertTo-Json -Compress
    exit 20
  }
}

New-Item -ItemType Directory -Force -Path $StateRoot|Out-Null
$logDir=Join-Path $StateRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir|Out-Null
$statePath=Join-Path $StateRoot 'state.json'
$lockPath=Join-Path $StateRoot 'tick.lock'
$stopPath=Join-Path $StateRoot 'STOP'
$promptPath=Join-Path $StateRoot 'codex-bootstrap-prompt.txt'
if(Test-Path -LiteralPath $stopPath){exit 0}

$lock=$null
try{$lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{exit 0}
try{
  $state=Read-State $statePath
  $fp=Provider-Fingerprint
  if($state -and $state.active_pid){
    if(Get-Process -Id ([int]$state.active_pid) -ErrorAction SilentlyContinue){exit 0}
  }
  $same=$state -and ([string]$state.last_dispatched_fingerprint -eq [string]$fp.digest)
  $lastOk=$state -and ([string]$state.last_result -eq 'TURN_COMPLETED')
  $retry=if($state -and $null -ne $state.same_fingerprint_retries){[int]$state.same_fingerprint_retries}else{0}
  if($same -and $lastOk){exit 0}
  if($same -and $retry -ge $MaxSameFingerprintRetries){exit 0}

  $codex=Get-Command codex.exe -ErrorAction SilentlyContinue
  if(-not $codex){$codex=Get-Command codex -ErrorAction SilentlyContinue}
  if(-not $codex){throw 'CODEX_CLI_UNAVAILABLE'}
  if(-not(Test-Path -LiteralPath $Workspace)){throw 'WORKSPACE_NOT_FOUND'}
  if(Test-Path -LiteralPath $CodexHome){$env:CODEX_HOME=$CodexHome}

  $prompt=@'
You are the bounded non-interactive executor for CHATGPT_GLOBAL_SKILL_GOVERNANCE.
Do not use this prompt or chat history as current authority. First read governance/continuity/CURRENT.json and the exact immutable snapshot commit/path it references, then fresh-read Project Directory, canonical control/checkpoint/run, Current Mission/Execution Policy, accepted-source, Issue #310, and PR #316 exact current head. Canonical/provider truth wins on mismatch.
The Human has already decided EXECUTE_NOW for normal reversible pre-Production work. Do not ask whether to execute or review first. Do not require Human relay or periodic wake-up.
Operate as an execution loop, not a reporting loop. WAITING_EXTERNAL yields the executor slot. Continue the next READY independent lawful unit.
No evidence delta means no duplicate snapshot, handoff, test, or non-idempotent dispatch. Unknown effects are readback-first; never redispatch OP025 while UNKNOWN.
Preserve Mission, Production final, new cost, legal/contract/signature/identity, OAuth/MFA, and major irreversible authority gates.
After each material result, persist provider-addressable evidence, append a new continuity snapshot under governance/continuity/snapshots/, advance governance/continuity/CURRENT.json, fresh-read, and continue. A snapshot is a derived handoff only, never a second control plane. If the durable fingerprint is unchanged, do not publish a duplicate snapshot. Exit only at Mission acceptance or a genuine Human-reserved/all-lanes-unavailable condition with exact re-entry evidence.
'@
  [IO.File]::WriteAllText($promptPath,$prompt,[Text.UTF8Encoding]::new($false))
  $stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $stdout=Join-Path $logDir ($stamp+'.stdout.jsonl')
  $stderr=Join-Path $logDir ($stamp+'.stderr.log')

  $job=Start-Job -ScriptBlock {
    param($Codex,$Workspace,$PromptPath,$Stdout,$Stderr,$CodexHome)
    if(Test-Path -LiteralPath $CodexHome){$env:CODEX_HOME=$CodexHome}
    Set-Location -LiteralPath $Workspace
    $prompt=Get-Content -LiteralPath $PromptPath -Raw
    $out=$prompt | & $Codex exec --json --approve-for-me 2> $Stderr
    $out | Set-Content -LiteralPath $Stdout -Encoding UTF8
    return $LASTEXITCODE
  } -ArgumentList $codex.Source,$Workspace,$promptPath,$stdout,$stderr,$CodexHome

  $record=[ordered]@{schema='vnext5.r4.autonomy-supervisor-state.v1';project_id=$ProjectId;last_provider_fingerprint=$fp.digest;last_dispatched_fingerprint=$fp.digest;same_fingerprint_retries=if($same){$retry+1}else{0};active_pid=$job.ChildJobs[0].JobStateInfo.InstanceId.ToString();active_job_id=$job.Id;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='RUNNING'}
  Write-AtomicJson $statePath $record
  $done=Wait-Job -Job $job -Timeout $MaxRunSeconds
  if(-not $done){
    Stop-Job -Job $job -ErrorAction SilentlyContinue
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    $record.active_pid=$null;$record.active_job_id=$null;$record.last_result='TIMEOUT_KILLED';$record.last_exit_code=124
    Write-AtomicJson $statePath $record
    exit 124
  }
  $exit=Receive-Job -Job $job
  Remove-Job -Job $job -Force
  $completed=$false
  if(Test-Path -LiteralPath $stdout){
    foreach($line in Get-Content -LiteralPath $stdout){
      if($line -match '"type"\s*:\s*"turn.completed"'){$completed=$true;break}
    }
  }
  $record.active_pid=$null;$record.active_job_id=$null;$record.last_exit_code=[int]($exit|Select-Object -Last 1);$record.last_result=if($completed){'TURN_COMPLETED'}else{'NO_TURN_COMPLETED'};$record.last_successful_tick_utc=if($completed){[DateTimeOffset]::UtcNow.ToString('o')}else{$null}
  Write-AtomicJson $statePath $record
  if($completed){exit 0}else{exit 21}
}catch{
  $s=Read-State $statePath
  if(-not $s){$s=[ordered]@{schema='vnext5.r4.autonomy-supervisor-state.v1';project_id=$ProjectId}}
  $s.last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');$s.last_result='SUPERVISOR_ERROR';$s.last_error=$_.Exception.Message
  Write-AtomicJson $statePath $s
  exit 20
}finally{if($lock){$lock.Dispose()}}
