Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$sourceHead='1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$stageRoot=Join-Path 'C:\ProgramData\PTYSD\MCP\P5Staging' $sourceHead
$helper=Join-Path $stageRoot 'tools\csg\factory-mcp\broker\operation-claim.ps1'
$root=Join-Path $stageRoot 'live-canary-exactly-once-a47'
$claims=Join-Path $root 'claims'
$effect=Join-Path $root 'effect.log'
$firstScript=Join-Path $root 'first.ps1'
$retryScript=Join-Path $root 'retry.ps1'
if(!(Test-Path -LiteralPath $helper -PathType Leaf)){throw 'P5_EXACTLY_ONCE_HELPER_MISSING'}
if(Test-Path -LiteralPath $root){throw 'P5_EXACTLY_ONCE_CANARY_PREEXISTS'}
New-Item -ItemType Directory -Path $root,$claims -Force|Out-Null
$first=@'
param($Helper,$Claims,$Effect)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. $Helper
$req=[pscustomobject]@{project_id='CHATGPT_GLOBAL_SKILL_GOVERNANCE';run_id='CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-P5';task_id='GOV-HARDENING-P5';attempt_id='GOV-HARDENING-P5-ATTEMPT-047';attempt_epoch=47;authorization_generation=1;operation_id='GOV-HARDENING-P5-EXACTLY-ONCE-LIVE-001'}
[void](Acquire-PTYSDOperationDispatchClaim -Request $req -RequestId ('11'*16) -ClaimsRoot $Claims)
[IO.File]::AppendAllText($Effect,"EFFECT-ONCE`r`n",(New-Object Text.UTF8Encoding($false)))
exit 91
'@
$retry=@'
param($Helper,$Claims)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. $Helper
$req=[pscustomobject]@{project_id='CHATGPT_GLOBAL_SKILL_GOVERNANCE';run_id='CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-P5';task_id='GOV-HARDENING-P5';attempt_id='GOV-HARDENING-P5-ATTEMPT-047';attempt_epoch=47;authorization_generation=1;operation_id='GOV-HARDENING-P5-EXACTLY-ONCE-LIVE-001'}
try{[void](Acquire-PTYSDOperationDispatchClaim -Request $req -RequestId ('22'*16) -ClaimsRoot $Claims);exit 10}catch{if([string]$_.Exception.Message -eq 'OPERATION_ALREADY_DISPATCHED'){exit 42};throw}
'@
[IO.File]::WriteAllText($firstScript,$first,(New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($retryScript,$retry,(New-Object Text.UTF8Encoding($false)))
$ps=(Get-Command powershell.exe -ErrorAction Stop).Source
& $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $firstScript -Helper $helper -Claims $claims -Effect $effect
$firstExit=$LASTEXITCODE
if($firstExit -ne 91){throw ('P5_EXACTLY_ONCE_FIRST_EXIT_INVALID:'+ $firstExit)}
& $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $retryScript -Helper $helper -Claims $claims
$retry1=$LASTEXITCODE
& $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $retryScript -Helper $helper -Claims $claims
$retry2=$LASTEXITCODE
if($retry1 -ne 42 -or $retry2 -ne 42){throw ('P5_EXACTLY_ONCE_RETRY_DENY_INVALID:'+ $retry1+','+$retry2)}
if(!(Test-Path -LiteralPath $effect -PathType Leaf)){throw 'P5_EXACTLY_ONCE_EFFECT_MISSING'}
$lines=@(Get-Content -LiteralPath $effect)
if($lines.Count -ne 1 -or [string]$lines[0] -ne 'EFFECT-ONCE'){throw ('P5_EXACTLY_ONCE_EFFECT_COUNT_INVALID:'+ $lines.Count)}
$claimFiles=@(Get-ChildItem -LiteralPath $claims -File -Filter '*.json')
if($claimFiles.Count -ne 1){throw ('P5_EXACTLY_ONCE_CLAIM_COUNT_INVALID:'+ $claimFiles.Count)}
$claim=Get-Content -LiteralPath $claimFiles[0].FullName -Raw|ConvertFrom-Json -ErrorAction Stop
if([string]$claim.request_id -ne ('11'*16)){throw 'P5_EXACTLY_ONCE_FIRST_REQUEST_ID_MISMATCH'}
if([string]$claim.operation_id -ne 'GOV-HARDENING-P5-EXACTLY-ONCE-LIVE-001'){throw 'P5_EXACTLY_ONCE_OPERATION_MISMATCH'}
if([int]$claim.attempt_epoch -ne 47 -or [int]$claim.authorization_generation -ne 1){throw 'P5_EXACTLY_ONCE_CLAIM_FENCE_MISMATCH'}
if([string]$claim.state -ne 'DISPATCH_CLAIMED'){throw 'P5_EXACTLY_ONCE_CLAIM_STATE_INVALID'}
[ordered]@{schema='v49.p5.exactly-once-live-canary.v1';result='PASS';source_head=$sourceHead;helper_path=$helper;root=$root;operation_id=[string]$claim.operation_id;attempt_epoch=[int]$claim.attempt_epoch;authorization_generation=[int]$claim.authorization_generation;first_request_id=[string]$claim.request_id;first_child_exit=$firstExit;simulated_ack_loss=$true;retry1_exit=$retry1;retry2_exit=$retry2;duplicate_denial='OPERATION_ALREADY_DISPATCHED';claim_file_count=[int]$claimFiles.Count;effect_line_count=[int]$lines.Count;effect_value=[string]$lines[0];p4_files_mutated=$false;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 5 -Compress
