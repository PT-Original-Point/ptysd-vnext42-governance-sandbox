#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ProjectId='CHATGPT_GLOBAL_SKILL_GOVERNANCE',
  [string]$Repo='PT-Original-Point/ptysd-vnext42-governance-sandbox',
  [int]$IssueNumber=310,
  [int]$ImplementationPullRequest=322,
  [string]$Workspace='C:\Users\x\Documents\ChatGPT\治理控制-自動軟體工廠',
  [string]$CodexHome='C:\Users\x\.codex',
  [string]$StateRoot=(Join-Path $env:LOCALAPPDATA 'PTYSD\AutonomySupervisor'),
  [int]$MaxRunSeconds=2700,
  [int]$MaxNoProgressOperations=5,
  [int]$MaxStageSeconds=3600,
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
  $g=Get-Command gh.exe -CommandType Application -ErrorAction SilentlyContinue
  if(-not $g){$g=Get-Command gh -CommandType Application -ErrorAction SilentlyContinue}
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
function Get-GhJsonFile([string]$Path,[string]$Ref){
  $escapedRef=[Uri]::EscapeDataString($Ref)
  $item=Gh ('repos/'+$Repo+'/contents/'+$Path+'?ref='+$escapedRef)
  if([string]$item.encoding -ne 'base64'){throw ('GITHUB_FILE_ENCODING_UNSUPPORTED: '+$Path)}
  $encoded=([string]$item.content -replace '\s','')
  $bytes=[Convert]::FromBase64String($encoded)
  $raw=[Text.Encoding]::UTF8.GetString($bytes)
  return [pscustomobject]@{path=$Path;ref=$Ref;blob=[string]$item.sha;raw_sha256=(Get-Sha256 $raw);data=($raw|ConvertFrom-Json)}
}
function Get-AnchoredGithubFile([string]$Reference){
  $m=[regex]::Match($Reference,'^github://[0-9]+/(?<path>.+)@(?<revision>[0-9a-f]{40})$')
  if(-not $m.Success){throw ('INVALID_IMMUTABLE_GITHUB_REF: '+$Reference)}
  return Get-GhJsonFile -Path $m.Groups['path'].Value -Ref $m.Groups['revision'].Value
}
function Get-LocalFactoryReadback {
  $taskRows=@();$serviceRows=@();$processRows=@();$errors=@();$roots=@()
  try{
    foreach($task in Get-ScheduledTask){
      $actions=@()
      foreach($action in @($task.Actions)){
        $execute=[string]$action.Execute
        $arguments=[string]$action.Arguments
        $combined=$execute+' '+$arguments
        if($combined -match '(?i)PTYSD|FactoryMCP|HostGuard|McpManagement|tunnel'){
          $actions+=@([ordered]@{execute=$execute;arguments_sha256=(Get-Sha256 $arguments)})
          foreach($match in [regex]::Matches($combined,'(?i)[A-Z]:\\[^""''\s]*(?:FactoryMCP|PTYSD\\MCP)[^""''\s]*')){
            $roots+=@($match.Value)
          }
        }
      }
      if($task.TaskName -match '(?i)PTYSD|Factory|HostGuard|McpManagement|Tunnel|Autonomy' -or $actions.Count -gt 0){
        $taskRows+=@([ordered]@{path=[string]$task.TaskPath;name=[string]$task.TaskName;state=[string]$task.State;user_id=[string]$task.Principal.UserId;logon_type=[string]$task.Principal.LogonType;run_level=[string]$task.Principal.RunLevel;actions=$actions})
      }
    }
  }catch{$errors+=@('TASK_READ:'+([string]$_.Exception.GetType().Name))}
  try{
    foreach($service in Get-CimInstance Win32_Service -ErrorAction Stop){
      $candidate=([string]$service.Name+' '+[string]$service.DisplayName+' '+[string]$service.PathName)
      if($candidate -match '(?i)PTYSD|FactoryMCP|HostGuard|McpManagement|tunnel'){
        $serviceRows+=@([ordered]@{name=[string]$service.Name;state=[string]$service.State;start_mode=[string]$service.StartMode;start_name=[string]$service.StartName;path_sha256=(Get-Sha256 ([string]$service.PathName))})
        foreach($match in [regex]::Matches([string]$service.PathName,'(?i)[A-Z]:\\[^""''\s]*(?:FactoryMCP|PTYSD\\MCP)[^""''\s]*')){
          $roots+=@($match.Value)
        }
      }
    }
  }catch{$errors+=@('SERVICE_READ:'+([string]$_.Exception.GetType().Name))}
  try{
    foreach($process in Get-CimInstance Win32_Process -ErrorAction Stop){
      if([int]$process.ProcessId -eq $PID){continue}
      $candidate=([string]$process.Name+' '+[string]$process.ExecutablePath+' '+[string]$process.CommandLine)
      if($candidate -match '(?i)PTYSD|FactoryMCP|HostGuard|McpManagement|tunnel|AutonomySupervisor'){
        $createdUtc=$null
        try{$createdUtc=[Management.ManagementDateTimeConverter]::ToDateTime([string]$process.CreationDate).ToUniversalTime().ToString('o')}catch{}
        $processRows+=@([ordered]@{pid=[int]$process.ProcessId;parent_pid=[int]$process.ParentProcessId;created_utc=$createdUtc;name=[string]$process.Name;executable=[string]$process.ExecutablePath;command_sha256=(Get-Sha256 ([string]$process.CommandLine))})
        foreach($match in [regex]::Matches([string]$process.CommandLine,'(?i)[A-Z]:\\[^""''\s]*(?:FactoryMCP|PTYSD\\MCP)[^""''\s]*')){
          $roots+=@($match.Value)
        }
      }
    }
  }catch{$errors+=@('PROCESS_READ:'+([string]$_.Exception.GetType().Name))}
  $uniqueRoots=@($roots|Sort-Object -Unique)
  return [ordered]@{
    host=$env:COMPUTERNAME
    principal=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    scheduled_tasks=@($taskRows)
    services=@($serviceRows)
    processes=@($processRows)
    path_candidates=$uniqueRoots
    read_errors=@($errors)
    readback_state=if($errors.Count){'PARTIAL'}else{'READ'}
  }
}
function Get-SupervisorSourceReadback {
  $relative=@(
    'ptysd-autonomy-supervisor.ps1',
    'lib\fingerprint.mjs',
    'lib\scheduler.mjs',
    'lib\supervisor-control.mjs',
    'lib\BoundedPipeCapture.cs',
    'schemas\readiness-result.schema.json'
  )
  $files=@()
  foreach($rel in $relative){
    $path=Join-Path $PSScriptRoot $rel
    if(Test-Path -LiteralPath $path -PathType Leaf){
      $item=Get-Item -LiteralPath $path
      $files+=@([ordered]@{path=$rel;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();length=[long]$item.Length})
    }else{$files+=@([ordered]@{path=$rel;missing=$true})}
  }
  $codex=Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue
  if(-not $codex){$codex=Get-Command codex -CommandType Application -ErrorAction SilentlyContinue}
  $cli=$null
  if($codex){
    $item=Get-Item -LiteralPath $codex.Source
    $cli=[ordered]@{path=[string]$codex.Source;file_version=[string]$item.VersionInfo.FileVersion;product_version=[string]$item.VersionInfo.ProductVersion;length=[long]$item.Length;last_write_utc=$item.LastWriteTimeUtc.ToString('o')}
  }
  return [ordered]@{root=$PSScriptRoot;files=$files;codex_cli=$cli}
}
function Get-WorkspaceReadback {
  $git=Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue
  if(-not $git){$git=Get-Command git -CommandType Application -ErrorAction SilentlyContinue}
  if(-not $git -or -not(Test-Path -LiteralPath $Workspace -PathType Container)){
    return [ordered]@{path=$Workspace;state='UNAVAILABLE'}
  }
  $scope=@('tools/csg/autonomy-supervisor','tools/csg/v51','governance/v51','governance/continuity','.github/workflows','tests/csg')
  try{
    $head=(& $git.Source -C $Workspace rev-parse HEAD 2>&1 | Out-String).Trim()
    if($LASTEXITCODE -ne 0){throw 'WORKSPACE_HEAD_READ_FAILED'}
    $status=@(& $git.Source -C $Workspace status --porcelain=v1 --untracked-files=all -- @scope 2>&1)
    if($LASTEXITCODE -ne 0){throw 'WORKSPACE_STATUS_READ_FAILED'}
    $diff=@(& $git.Source -C $Workspace diff --binary HEAD -- @scope 2>&1)
    if($LASTEXITCODE -ne 0){throw 'WORKSPACE_DIFF_READ_FAILED'}
    $tracked=@(& $git.Source -C $Workspace diff --name-only HEAD -- @scope 2>&1)
    if($LASTEXITCODE -ne 0){throw 'WORKSPACE_PATH_READ_FAILED'}
    $untracked=@(& $git.Source -C $Workspace ls-files --others --exclude-standard -- @scope 2>&1)
    if($LASTEXITCODE -ne 0){throw 'WORKSPACE_UNTRACKED_READ_FAILED'}
    $paths=@(@($tracked)+@($untracked)|Where-Object{$_}|Sort-Object -Unique)
    $root=[IO.Path]::GetFullPath($Workspace).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    $rows=@()
    foreach($relativePath in $paths){
      $candidate=[IO.Path]::GetFullPath((Join-Path $Workspace ([string]$relativePath)))
      if(-not $candidate.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'WORKSPACE_PATH_ESCAPE'}
      if(Test-Path -LiteralPath $candidate -PathType Leaf){
        $item=Get-Item -LiteralPath $candidate
        $rows+=@([ordered]@{path=[string]$relativePath;sha256=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant();length=[long]$item.Length})
      }else{$rows+=@([ordered]@{path=[string]$relativePath;missing=$true})}
    }
    return [ordered]@{path=$Workspace;state='READ';head=$head;scope=$scope;status_sha256=(Get-Sha256 (@($status) -join "`n"));tracked_diff_sha256=(Get-Sha256 (@($diff) -join "`n"));files=$rows}
  }catch{return [ordered]@{path=$Workspace;state='PARTIAL';error=[string]$_.Exception.Message}}
}
function Provider-Fingerprint {
  # Project Directory active_run_ref is the sole route to the current control pointer.
  $directoryBranch=Gh ('repos/'+$Repo+'/branches/governance/project-directory')
  $directoryHead=[string]$directoryBranch.commit.sha
  $directoryFile=Get-GhJsonFile -Path 'directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json' -Ref $directoryHead
  $directoryData=$directoryFile.data
  if([string]$directoryData.project_id -ne $ProjectId){throw 'DIRECTORY_PROJECT_ID_MISMATCH'}

  $locator=$directoryData.control_locator
  $activeLocator=$directoryData.active_run_ref.control_locator
  $directoryActiveRef=[string]$locator.ref
  $directoryActivePath=[string]$locator.current_path
  $locatorConsistent=([string]$activeLocator.ref -eq $directoryActiveRef -and [string]$activeLocator.current_path -eq $directoryActivePath)
  $controlBranchName=$directoryActiveRef -replace '^refs/heads/',''
  $controlBranch=Gh ('repos/'+$Repo+'/branches/'+$controlBranchName)
  $controlHead=[string]$controlBranch.commit.sha
  $pointerFile=Get-GhJsonFile -Path $directoryActivePath -Ref $controlHead
  $pointer=$pointerFile.data
  if([string]$pointer.project_id -ne $ProjectId){throw 'CONTROL_PROJECT_ID_MISMATCH'}
  $checkpointFile=Get-GhJsonFile -Path ([string]$pointer.checkpoint_path) -Ref $controlHead
  $checkpoint=$checkpointFile.data
  $checkpointDigestMatches=([string]$checkpoint.payload_digest -eq [string]$pointer.checkpoint_digest)
  $runRef=$checkpoint.run_ref
  $runFile=Get-GhJsonFile -Path ([string]$runRef.path) -Ref ([string]$runRef.revision)
  $run=$runFile.data
  $runIdentityMatches=([string]$run.project_id -eq $ProjectId -and [string]$run.active_task_id -eq [string]$checkpoint.task_id -and [string]$run.attempt_id -eq [string]$checkpoint.attempt_id -and [int]$run.attempt_epoch -eq [int]$checkpoint.attempt_epoch)

  $missionFile=Get-AnchoredGithubFile ([string]$checkpoint.mission_anchor.ref)
  $policyFile=Get-AnchoredGithubFile ([string]$checkpoint.policy_anchor.ref)
  $missionMatches=([string]$missionFile.data.mission_hash -eq [string]$checkpoint.mission_anchor.declared_hash)
  $policyMatches=([string]$policyFile.data.policy_hash -eq [string]$checkpoint.policy_anchor.declared_hash)

  $acceptedBranch=Gh ('repos/'+$Repo+'/branches/v49/accepted-source')
  $acceptedHead=[string]$acceptedBranch.commit.sha
  $mailboxFile=Get-GhJsonFile -Path 'governance/v50/controller-mailbox.json' -Ref $acceptedHead
  $issue=Gh ('repos/'+$Repo+'/issues/'+$IssueNumber)
  $commentCount=[int]$issue.comments
  $commentPage=if($commentCount -gt 0){[int][Math]::Ceiling($commentCount/100.0)}else{1}
  $commentResponse=Gh ('repos/'+$Repo+'/issues/'+$IssueNumber+'/comments?per_page=100&page='+$commentPage)
  $commentQueue=New-Object 'System.Collections.Generic.Queue[object]'
  $commentQueue.Enqueue($commentResponse)
  $commentItems=New-Object 'System.Collections.Generic.List[object]'
  while($commentQueue.Count -gt 0){
    $commentItem=$commentQueue.Dequeue()
    if($null -eq $commentItem){continue}
    if($commentItem -is [System.Array]){foreach($nestedComment in $commentItem){$commentQueue.Enqueue($nestedComment)}}
    elseif($commentItem.PSObject.Properties['id'] -and $commentItem.PSObject.Properties['body']){$commentItems.Add($commentItem)}
  }
  $latestComment=$null
  foreach($commentItem in $commentItems){
    if($null -eq $latestComment -or [int64]$commentItem.id -gt [int64]$latestComment.id){$latestComment=$commentItem}
  }
  $pr=Gh ('repos/'+$Repo+'/pulls/'+$ImplementationPullRequest)
  $prCommit=Gh ('repos/'+$Repo+'/git/commits/'+[string]$pr.head.sha)
  $prFiles=@(Gh ('repos/'+$Repo+'/pulls/'+$ImplementationPullRequest+'/files?per_page=100'))
  $prFileBindings=@($prFiles|ForEach-Object{[ordered]@{path=[string]$_.filename;blob=[string]$_.sha;status=[string]$_.status}}|Sort-Object path)
  $combinedStatus=Gh ('repos/'+$Repo+'/commits/'+[string]$pr.head.sha+'/status')
  $checkRuns=Gh ('repos/'+$Repo+'/commits/'+[string]$pr.head.sha+'/check-runs')
  $factory=Get-LocalFactoryReadback
  $supervisorSource=Get-SupervisorSourceReadback
  $workspace=Get-WorkspaceReadback

  return [ordered]@{
    project_id=$ProjectId
    directory=[ordered]@{head=$directoryHead;blob=$directoryFile.blob;raw_sha256=$directoryFile.raw_sha256;revision=$directoryData.directory_revision;binding_id=$directoryData.binding_id;binding_generation=$directoryData.binding_generation;active_run_ref=$directoryData.active_run_ref}
    control=[ordered]@{head=$controlHead;pointer_blob=$pointerFile.blob;pointer_raw_sha256=$pointerFile.raw_sha256;transition_id=$pointer.transition_id;checkpoint_seq=$pointer.checkpoint_seq;checkpoint_digest=$pointer.checkpoint_digest;reader_compatibility=$pointer.reader_compatibility}
    checkpoint=[ordered]@{blob=$checkpointFile.blob;raw_sha256=$checkpointFile.raw_sha256;seq=$checkpoint.checkpoint_seq;digest=$checkpoint.payload_digest;task_id=$checkpoint.task_id;attempt_id=$checkpoint.attempt_id;attempt_epoch=$checkpoint.attempt_epoch;atomic=$checkpoint.atomic;execution_fence=$checkpoint.atomic.execution_fence;blockers=$checkpoint.blockers;next_legal_transition=$checkpoint.next_legal_transition;digest_matches_pointer=$checkpointDigestMatches}
    run=[ordered]@{commit=$runRef.revision;path=$runRef.path;blob=$runFile.blob;raw_sha256=$runFile.raw_sha256;id=$run.run_id;revision=$run.revision;state=$run.state;task_id=$run.active_task_id;attempt_id=$run.attempt_id;attempt_epoch=$run.attempt_epoch;latest_checkpoint_ref=$run.latest_checkpoint_ref;remaining_attempts=$run.remaining_attempts;identity_matches_checkpoint=$runIdentityMatches}
    mission=[ordered]@{anchor_ref=([string]$checkpoint.mission_anchor.ref);blob=$missionFile.blob;raw_sha256=$missionFile.raw_sha256;revision=$missionFile.data.mission_revision_id;hash=$missionFile.data.mission_hash}
    execution_policy=[ordered]@{anchor_ref=([string]$checkpoint.policy_anchor.ref);blob=$policyFile.blob;raw_sha256=$policyFile.raw_sha256;revision=$policyFile.data.policy_revision_id;hash=$policyFile.data.policy_hash}
    accepted_source=[ordered]@{head=$acceptedHead;mailbox_blob=$mailboxFile.blob;mailbox_raw_sha256=$mailboxFile.raw_sha256}
    mailbox=[ordered]@{issue_number=$IssueNumber;issue_updated_at=[string]$issue.updated_at;comment_count=$commentCount;latest_comment_id=if($latestComment){[int64]$latestComment.id}else{$null};latest_comment_updated_at=if($latestComment){[string]$latestComment.updated_at}else{$null};latest_comment_sha256=if($latestComment){Get-Sha256 ([string]$latestComment.body)}else{$null};mailbox_authority=[string]$mailboxFile.data.coordination_mailbox.authority_class}
    implementation=[ordered]@{pull_request=$ImplementationPullRequest;base_sha=$pr.base.sha;head_sha=$pr.head.sha;head_branch=$pr.head.ref;tree_sha=$prCommit.tree.sha;head_repo=$pr.head.repo.full_name;state=$pr.state;draft=[bool]$pr.draft;merged_at=$pr.merged_at;files=$prFileBindings;combined_status=[string]$combinedStatus.state;status_count=(@($combinedStatus.statuses)).Count;check_run_count=(@($checkRuns.check_runs)).Count;check_runs=@($checkRuns.check_runs|ForEach-Object{[ordered]@{name=$_.name;status=$_.status;conclusion=$_.conclusion;head_sha=$_.head_sha;check_suite_id=$_.check_suite.id}})}
    factory=$factory
    runtime=Get-NodeRuntimeReadback
    supervisor_source=$supervisorSource
    workspace=$workspace
    coherence=[ordered]@{directory_active_ref_consistent=$locatorConsistent;checkpoint_digest_matches_pointer=$checkpointDigestMatches;mission_anchor_matches=$missionMatches;policy_anchor_matches=$policyMatches;run_identity_matches_checkpoint=$runIdentityMatches}
  }
}
function Get-NodeRuntimeReadback {
  $commands=@(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue)
  if(-not $commands){$commands=@(Get-Command node -CommandType Application -All -ErrorAction SilentlyContinue)}
  $paths=@($commands|ForEach-Object{[string]$_.Source}|Where-Object{$_}|Select-Object -Unique)
  if($paths.Count -eq 0){return [ordered]@{state='UNAVAILABLE';candidate_paths=@()}}
  $selectedPath=[IO.Path]::GetFullPath([string]$paths[0])
  if(-not(Test-Path -LiteralPath $selectedPath -PathType Leaf)){throw 'NODE_RUNTIME_PATH_MISSING'}
  $versionOutput=@(& $selectedPath '--version' 2>&1)
  $versionExit=[int]$LASTEXITCODE
  $version=($versionOutput -join ' ').Trim()
  if($versionExit -ne 0 -or $version -notmatch '^v(?<major>[0-9]+)\.') {throw 'NODE_RUNTIME_VERSION_READ_FAILED'}
  if([int]$Matches.major -lt 20){throw 'NODE_RUNTIME_VERSION_TOO_OLD'}
  $item=Get-Item -LiteralPath $selectedPath
  return [ordered]@{
    state='READY'
    selected_path=$selectedPath
    selected_sha256=(Get-FileHash -LiteralPath $selectedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    file_version=[string]$item.VersionInfo.FileVersion
    node_version=$version
    candidate_paths=$paths
  }
}
function Invoke-SupervisorControl([object]$Fingerprint,[object[]]$Units){
  $runtime=Get-NodeRuntimeReadback
  if([string]$runtime.state -ne 'READY'){throw 'NODE_RUNTIME_UNAVAILABLE_FOR_TRUSTED_SCHEDULER'}
  $controlPath=Join-Path $PSScriptRoot 'lib\supervisor-control.mjs'
  if(-not(Test-Path -LiteralPath $controlPath)){throw 'SUPERVISOR_CONTROL_MODULE_MISSING'}
  $payload=[ordered]@{fingerprint=$Fingerprint;units=@($Units)}
  $raw=$payload|ConvertTo-Json -Depth 24 -Compress
  $priorEncoding=$OutputEncoding
  $OutputEncoding=New-Object System.Text.UTF8Encoding($false)
  try{
    $output=$raw | & ([string]$runtime.selected_path) $controlPath 2>&1
    if($LASTEXITCODE -ne 0){throw ('SUPERVISOR_CONTROL_FAILED: '+($output -join [Environment]::NewLine))}
    $result=($output -join [Environment]::NewLine)|ConvertFrom-Json
    if([string]$result.schema -ne 'vnext5.autonomy-supervisor-control.v1'){throw 'SUPERVISOR_CONTROL_SCHEMA_MISMATCH'}
    return $result
  }finally{$OutputEncoding=$priorEncoding}
}
function Get-ProcessTreeIds([int]$RootPid){
  $all=@(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId)
  $ids=New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$ids.Add($RootPid)
  $changed=$true
  while($changed){
    $changed=$false
    foreach($proc in $all){
      $pidValue=[int]$proc.ProcessId
      $parentValue=[int]$proc.ParentProcessId
      if($ids.Contains($parentValue) -and -not $ids.Contains($pidValue)){
        [void]$ids.Add($pidValue)
        $changed=$true
      }
    }
  }
  return @($ids | Sort-Object)
}
function Test-TrackedCodexProcess([object]$State){
  if(-not $State -or [string]$State.active_pid -notmatch '^[0-9]+$'){return $false}
  if(-not $State.active_started_utc -or -not $State.active_executable_path){return $false}
  $pidValue=[int]$State.active_pid
  $process=Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if(-not $process){return $false}
  try{
    if(-not [string]::Equals([string]$process.Path,[string]$State.active_executable_path,[StringComparison]::OrdinalIgnoreCase)){return $false}
    $started=$process.StartTime.ToUniversalTime().ToString('o')
    return [string]::Equals($started,[string]$State.active_started_utc,[StringComparison]::Ordinal)
  }catch{return $false}
}
function Stop-CodexProcessTree([int]$RootPid,[int]$WaitSeconds=15){
  $observed=Get-ProcessTreeIds $RootPid
  $taskkill=Join-Path $env:SystemRoot 'System32\taskkill.exe'
  if(-not(Test-Path -LiteralPath $taskkill)){throw 'TASKKILL_UNAVAILABLE'}
  $null=& $taskkill /PID $RootPid /T /F 2>&1
  $killExit=[int]$LASTEXITCODE
  $timer=[Diagnostics.Stopwatch]::StartNew()
  do{
    $alive=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $observed -contains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })
    if($alive.Count -eq 0){break}
    Start-Sleep -Milliseconds 200
  }while($timer.Elapsed.TotalSeconds -lt $WaitSeconds)
  $remaining=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $observed -contains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })
  return [pscustomobject]@{root_pid=$RootPid;observed_tree_pids=$observed;taskkill_exit_code=$killExit;remaining_pids=$remaining;cleanup_proven=($remaining.Count -eq 0)}
}
function Invoke-CodexBounded([string]$CodexPath,[string]$Workspace,[string]$Prompt,[string]$StdoutPath,[string]$StderrPath,[string]$LastMessagePath,[string]$OutputSchemaPath,[string]$CodexHome,[int]$TimeoutSeconds,[scriptblock]$OnStarted){
  if(-not('Ptysd.AutonomySupervisor.BoundedPipeCapture' -as [type])){
    $captureSource=Join-Path $PSScriptRoot 'lib\BoundedPipeCapture.cs'
    if(-not(Test-Path -LiteralPath $captureSource)){throw 'BOUNDED_CAPTURE_SOURCE_MISSING'}
    Add-Type -Path $captureSource
  }

  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$CodexPath
  $q=[string][char]34
  $info.Arguments='exec --json --approve-for-me --output-schema '+$q+$OutputSchemaPath+$q+' --output-last-message '+$q+$LastMessagePath+$q
  $info.WorkingDirectory=$Workspace
  $info.UseShellExecute=$false
  $info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true
  $info.RedirectStandardOutput=$true
  $info.RedirectStandardError=$true
  if($CodexHome -and (Test-Path -LiteralPath $CodexHome)){$info.EnvironmentVariables['CODEX_HOME']=$CodexHome}

  $process=New-Object Diagnostics.Process
  $job=$null
  $process.StartInfo=$info
  if(-not $process.Start()){throw 'CODEX_PROCESS_START_FAILED'}
  $pidValue=[int]$process.Id
  $startedUtc=$process.StartTime.ToUniversalTime().ToString('o')
  try{$job=[Ptysd.AutonomySupervisor.KillOnCloseProcessJob]::Assign($process)}catch{
    $assignError=[string]$_.Exception.Message
    $cleanup=Stop-CodexProcessTree $pidValue
    $process.Dispose()
    if(-not $cleanup.cleanup_proven){throw 'CODEX_PROCESS_JOB_ASSIGN_FAILED_CLEANUP_UNPROVEN'}
    throw ('CODEX_PROCESS_JOB_ASSIGN_FAILED: '+$assignError)
  }
  $captureLimit=1048576
  $markerPattern='"type"\s*:\s*"turn\.completed"'
  $stdoutTask=[Ptysd.AutonomySupervisor.BoundedPipeCapture]::DrainAsync($process.StandardOutput.BaseStream,$StdoutPath,$captureLimit,$markerPattern)
  $stderrTask=[Ptysd.AutonomySupervisor.BoundedPipeCapture]::DrainAsync($process.StandardError.BaseStream,$StderrPath,$captureLimit,'')

  try{
    try{
      & $OnStarted $pidValue $startedUtc
      $process.StandardInput.Write($Prompt)
      $process.StandardInput.Close()
    }catch{
      try{$job.Terminate(122)}catch{}
      try{$job.Dispose();$job=$null}catch{}
      $cleanup=Stop-CodexProcessTree $pidValue
      if(-not $cleanup.cleanup_proven){throw 'CODEX_START_OR_INPUT_FAILURE_PROCESS_TREE_CLEANUP_UNPROVEN'}
      throw
    }

    $completedInTime=$process.WaitForExit($TimeoutSeconds*1000)
    $cleanup=$null
    $processTreeClean=$true
    $processTreeCleanupProven=$true
    $activeJobProcessesAtRootExit=0
    if(-not $completedInTime){
      try{$job.Terminate(124)}catch{}
      $cleanup=Stop-CodexProcessTree $pidValue
      $null=$process.WaitForExit(5000)
      $job.Dispose();$job=$null
      $cleanup=Stop-CodexProcessTree $pidValue
      $processTreeClean=$false
      $processTreeCleanupProven=[bool]$cleanup.cleanup_proven
    }else{
      $activeJobProcessesAtRootExit=[int]$job.ActiveProcessCount
      if($activeJobProcessesAtRootExit -gt 0){
        $processTreeClean=$false
        try{$job.Terminate(125)}catch{}
        $cleanup=Stop-CodexProcessTree $pidValue
        $null=$process.WaitForExit(5000)
        $job.Dispose();$job=$null
        $cleanup=Stop-CodexProcessTree $pidValue
        $processTreeCleanupProven=[bool]$cleanup.cleanup_proven
      }
    }
    $job.Dispose();$job=$null

    $captureTasks=[System.Threading.Tasks.Task[]]@($stdoutTask,$stderrTask)
    $capturesFinished=$false
    try{$capturesFinished=[System.Threading.Tasks.Task]::WaitAll($captureTasks,5000)}catch{$capturesFinished=$true}
    if(-not $capturesFinished){
      try{$process.StandardOutput.Close()}catch{}
      try{$process.StandardError.Close()}catch{}
      try{$null=[System.Threading.Tasks.Task]::WaitAll($captureTasks,1000)}catch{}
      throw 'BOUNDED_OUTPUT_CAPTURE_DID_NOT_DRAIN'
    }
    if($stdoutTask.IsFaulted -or $stderrTask.IsFaulted){throw 'BOUNDED_OUTPUT_CAPTURE_FAILED'}
    $stdout=$stdoutTask.GetAwaiter().GetResult()
    $stderr=$stderrTask.GetAwaiter().GetResult()
    $result=[pscustomobject]@{
      process_id=$pidValue
      process_started_utc=$startedUtc
      exit_code=if($completedInTime){[int]$process.ExitCode}else{124}
      timed_out=(-not $completedInTime)
      process_tree_cleanup_proven=$processTreeCleanupProven
      cleanup_evidence=$cleanup
      process_tree_clean=$processTreeClean
      active_job_processes_at_root_exit=$activeJobProcessesAtRootExit
      turn_completed=[bool]$stdout.MarkerFound
      stdout_path=$StdoutPath
      stderr_path=$StderrPath
      stdout_bytes_read=[long]$stdout.BytesRead
      stderr_bytes_read=[long]$stderr.BytesRead
      stdout_bytes_stored=[long]$stdout.BytesStored
      stderr_bytes_stored=[long]$stderr.BytesStored
      stdout_truncated=[bool]$stdout.Truncated
      stderr_truncated=[bool]$stderr.Truncated
    }
    return $result
  }finally{
    if($job){try{$job.Dispose()}catch{}}
    $process.Dispose()
  }
}
function Get-AuthorityReadback([object]$Fingerprint){
  return [ordered]@{
    project_directory_commit=[string]$Fingerprint.directory.head
    directory_active_ref_consistent=[bool]$Fingerprint.coherence.directory_active_ref_consistent
    control_head=[string]$Fingerprint.control.head
    checkpoint_seq=[int]$Fingerprint.checkpoint.seq
    checkpoint_digest=[string]$Fingerprint.checkpoint.digest
    checkpoint_digest_matches_pointer=[bool]$Fingerprint.coherence.checkpoint_digest_matches_pointer
    checkpoint_task_id=[string]$Fingerprint.checkpoint.task_id
    checkpoint_attempt_id=[string]$Fingerprint.checkpoint.attempt_id
    checkpoint_attempt_epoch=[int]$Fingerprint.checkpoint.attempt_epoch
    run_id=[string]$Fingerprint.run.id
    run_task_id=[string]$Fingerprint.run.task_id
    run_attempt_id=[string]$Fingerprint.run.attempt_id
    run_attempt_epoch=[int]$Fingerprint.run.attempt_epoch
    mission_revision=[string]$Fingerprint.mission.revision
    mission_hash=[string]$Fingerprint.mission.hash
    mission_anchor_matches=[bool]$Fingerprint.coherence.mission_anchor_matches
    execution_policy_revision=[string]$Fingerprint.execution_policy.revision
    execution_policy_hash=[string]$Fingerprint.execution_policy.hash
    policy_anchor_matches=[bool]$Fingerprint.coherence.policy_anchor_matches
    run_identity_matches_checkpoint=[bool]$Fingerprint.coherence.run_identity_matches_checkpoint
    accepted_source_head=[string]$Fingerprint.accepted_source.head
    latest_issue_comment_id=[string]$Fingerprint.mailbox.latest_comment_id
    implementation_head=[string]$Fingerprint.implementation.head_sha
    implementation_tree=[string]$Fingerprint.implementation.tree_sha
  }
}
function Test-CodexExecutionToken {
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  $isSystem=([string]$identity.User.Value -eq 'S-1-5-18')
  $isAdministrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if($isSystem -or $isAdministrator){throw 'CODEX_EXECUTOR_MUST_RUN_WITH_UNPRIVILEGED_CURRENT_USER_TOKEN'}
  return [ordered]@{user=[string]$identity.Name;sid=[string]$identity.User.Value;is_system=$isSystem;is_administrator=$isAdministrator}
}
function New-ReadinessSeed {
  return ,@([ordered]@{id='READINESS_RECOMPUTE';state='READY';priority=0;retry_allowed=$false})
}
function Copy-ReadinessUnits([object[]]$Units){
  $copy=@()
  foreach($unit in @($Units)){
    if(-not $unit){continue}
    $copy+=@([ordered]@{id=[string]$unit.id;state=[string]$unit.state;priority=[int]$unit.priority;retry_allowed=[bool]$unit.retry_allowed})
  }
  return ,$copy
}
function ConvertTo-StringMap([object]$Value){
  $map=@{}
  if(-not $Value){return $map}
  if($Value -is [System.Collections.IDictionary]){
    foreach($key in $Value.Keys){$map[[string]$key]=$Value[$key]}
  }else{
    foreach($entry in $Value.PSObject.Properties){$map[[string]$entry.Name]=$entry.Value}
  }
  return $map
}
function Normalize-State([object]$Value){
  $defaults=[ordered]@{
    readiness_fingerprint='';readiness_units=@();no_progress_counts=@{};last_action_hashes=@{};parked_reasons=@{}
    active_pid=$null;active_unit_id=$null;active_started_utc=$null;active_executable_path=$null;active_recovery=$null;unresolved_process_ids=@()
    next_single_action='';next_action_unit_id='';latest_message_sha256='';latest_message_path='';goal_completed=$false
  }
  foreach($key in $defaults.Keys){
    if($Value -is [System.Collections.IDictionary]){if(-not $Value.Contains($key)){$Value[$key]=$defaults[$key]}}
    elseif(-not $Value.PSObject.Properties[$key]){$Value|Add-Member -MemberType NoteProperty -Name $key -Value $defaults[$key]}
  }
  return $Value
}
function Set-ReadinessUnitState([object[]]$Units,[string]$UnitId,[string]$State){
  $copy=@();$found=$false
  foreach($unit in @(Copy-ReadinessUnits $Units)){
    if([string]$unit.id -eq $UnitId){$unit.state=$State;$found=$true}
    $copy+=@($unit)
  }
  if(-not $found){$copy+=@([ordered]@{id=$UnitId;state=$State;priority=2147483647;retry_allowed=$false})}
  return ,$copy
}
function Assert-ReadinessResult([object]$Result,[string]$ExpectedDigest,[object]$ExpectedReadback){
  if([string]$Result.schema -ne 'vnext5.autonomy-supervisor-readiness.v1'){throw 'READINESS_SCHEMA_MISMATCH'}
  if([string]$Result.based_on_fingerprint -ne $ExpectedDigest){throw 'READINESS_FINGERPRINT_MISMATCH'}
  if($Result.authority_sources_read -ne $true){throw 'AUTHORITY_READBACK_NOT_CONFIRMED'}
  if(-not $Result.authority_readback){throw 'AUTHORITY_READBACK_OBJECT_MISSING'}
  foreach($key in $ExpectedReadback.Keys){
    if([string]$Result.authority_readback.$key -ne [string]$ExpectedReadback[$key]){throw ('AUTHORITY_READBACK_MISMATCH:'+ $key)}
  }
  $units=@(Copy-ReadinessUnits @($Result.units))
  if($units.Count -eq 0){throw 'READINESS_UNIT_SET_EMPTY'}
  $ids=@($units|ForEach-Object{$_.id})
  if(@($ids|Sort-Object -Unique).Count -ne $ids.Count){throw 'READINESS_DUPLICATE_UNIT_ID'}
  $allowed=@('READY','RUNNING','WAITING_EXTERNAL','WAITING_HUMAN','DONE','FAILED_RETRYABLE','FAILED_TERMINAL')
  foreach($unit in $units){if($allowed -notcontains [string]$unit.state){throw 'READINESS_INVALID_UNIT_STATE'}}
  if(@($units|Where-Object{$_.state -eq 'RUNNING'}).Count -gt 0){throw 'READINESS_RESULT_RETAINED_RUNNING_OWNER'}
  return ,$units
}
function Get-ReadinessUnit([object[]]$Units,[string]$UnitId){
  foreach($unit in @($Units)){if([string]$unit.id -eq $UnitId){return $unit}}
  return $null
}
if($ReadOnlyPreflight){
  try{
    $material=Provider-Fingerprint
    $seed=New-ReadinessSeed
    $control=Invoke-SupervisorControl -Fingerprint $material -Units $seed
    $executionToken=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    [ordered]@{schema='vnext5.1.autonomy-supervisor-preflight.v2';project_id=$ProjectId;mode='READ_ONLY_PREFLIGHT';result='PASS';fingerprint_digest=$control.fingerprint_digest;scheduler=$control.scheduler;authority_readback=(Get-AuthorityReadback $material);authority_coherence=$material.coherence;runtime_readback=$material.runtime;executor_identity=$executionToken;state_root_mutated=$false;codex_dispatched=$false}|ConvertTo-Json -Depth 24 -Compress
    exit 0
  }catch{
    [ordered]@{schema='vnext5.1.autonomy-supervisor-preflight.v2';project_id=$ProjectId;mode='READ_ONLY_PREFLIGHT';result='FAIL';error=$_.Exception.Message;state_root_mutated=$false;codex_dispatched=$false}|ConvertTo-Json -Depth 8 -Compress
    exit 20
  }
}

try{$executorToken=Test-CodexExecutionToken}catch{exit 23}
if(-not $env:LOCALAPPDATA){exit 23}
$localStateRoot=[IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
$requestedStateRoot=[IO.Path]::GetFullPath($StateRoot)
if(-not $requestedStateRoot.StartsWith($localStateRoot,[StringComparison]::OrdinalIgnoreCase)){exit 23}
New-Item -ItemType Directory -Force -Path $StateRoot|Out-Null
$logDir=Join-Path $StateRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir|Out-Null
$statePath=Join-Path $StateRoot 'state.json'
$lockPath=Join-Path $StateRoot 'tick.lock'
$stopPath=Join-Path $StateRoot 'STOP'
if(Test-Path -LiteralPath $stopPath){exit 0}

$lock=$null
try{$lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{exit 0}
try{
  $state=Read-State $statePath
  if($state -and [string]$state.schema -ne 'vnext5.1.autonomy-supervisor-state.v1'){$state=$null}
  if(-not $state){$state=[pscustomobject]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId}}
  $state=Normalize-State $state
  $noProgressCounts=ConvertTo-StringMap $state.no_progress_counts
  $lastActionHashes=ConvertTo-StringMap $state.last_action_hashes
  $parkedReasons=ConvertTo-StringMap $state.parked_reasons
  $material=Provider-Fingerprint
  $digestProbe=Invoke-SupervisorControl -Fingerprint $material -Units @()
  $currentDigest=[string]$digestProbe.fingerprint_digest
  if($state -and [string]$state.active_recovery -eq 'PROCESS_TREE_CLEANUP_UNPROVEN'){
    $unresolvedIds=@($state.unresolved_process_ids|ForEach-Object{if([string]$_ -match '^[0-9]+$'){[int]$_}})
    if($unresolvedIds.Count -eq 0){exit 25}
    $remainingIdentity=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$unresolvedIds -contains [int]$_.ProcessId})
    if($remainingIdentity.Count -gt 0){exit 25}
    $state.active_recovery=$null
    $state.unresolved_process_ids=@()
  }
  if($state -and $state.active_pid){
    if(Test-TrackedCodexProcess $state){exit 0}
    $staleUnit=[string]$state.active_unit_id
    $savedUnits=@(Copy-ReadinessUnits @($state.readiness_units))
    if($staleUnit){$savedUnits=Set-ReadinessUnitState $savedUnits $staleUnit 'WAITING_EXTERNAL'}
    $state.readiness_units=$savedUnits
    if($staleUnit){$parkedReasons[$staleUnit]='STALE_EXECUTOR_REQUIRES_EFFECT_READBACK'}
    $state.active_pid=$null
    $state.active_started_utc=$null
    $state.active_executable_path=$null
    $state.active_unit_id=$null
    if([string]$state.active_recovery -ne 'PROCESS_TREE_CLEANUP_UNPROVEN'){$state.active_recovery='STALE_OR_UNVERIFIABLE_PROCESS_IDENTITY'}
    $state.readiness_fingerprint=$currentDigest
    $state.parked_reasons=$parkedReasons
    Write-AtomicJson $statePath $state
  }
  $units=@(Copy-ReadinessUnits @($state.readiness_units))
  $stateMatches=$state -and ([string]$state.readiness_fingerprint -eq $currentDigest)
  if(-not $stateMatches -or $units.Count -eq 0){$units=New-ReadinessSeed}
  if(@($units|Where-Object{$_.state -eq 'RUNNING'}).Count -gt 0){
    foreach($runningUnit in @($units|Where-Object{$_.state -eq 'RUNNING'})){$units=Set-ReadinessUnitState $units $runningUnit.id 'WAITING_EXTERNAL'}
    foreach($runningUnit in @($state.readiness_units|Where-Object{$_.state -eq 'RUNNING'})){$parkedReasons[[string]$runningUnit.id]='SUPERVISOR_RESTART_REQUIRES_EFFECT_READBACK'}
  }

  $codex=Get-Command codex.exe -ErrorAction SilentlyContinue
  if(-not $codex){$codex=Get-Command codex -ErrorAction SilentlyContinue}
  if(-not $codex){throw 'CODEX_CLI_UNAVAILABLE'}
  if(-not(Test-Path -LiteralPath $Workspace)){throw 'WORKSPACE_NOT_FOUND'}
  if(Test-Path -LiteralPath $CodexHome){$env:CODEX_HOME=$CodexHome}
  $stageClock=[Diagnostics.Stopwatch]::StartNew()
  if($state.next_single_action){$pendingActionHash=Get-Sha256 ([string]$state.next_action_unit_id+"`n"+[string]$state.next_single_action)}else{$pendingActionHash=''}
  $pendingActionUnit=[string]$state.next_action_unit_id
  $pendingActionText=[string]$state.next_single_action
  $turnNumber=0
  while($true){
    $turnNumber++
    $control=Invoke-SupervisorControl -Fingerprint $material -Units $units
    $decision=[string]$control.scheduler.decision
    if($decision -eq 'KEEP_RUNNING'){
      $record=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId;readiness_fingerprint=$currentDigest;readiness_units=$units;no_progress_counts=$noProgressCounts;last_action_hashes=$lastActionHashes;parked_reasons=$parkedReasons;active_pid=$null;active_unit_id=$null;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='RUNNING_OWNER_WITHOUT_VERIFIED_PROCESS'}
      Write-AtomicJson $statePath $record
      exit 25
    }
    if($decision -ne 'DISPATCH' -and $decision -ne 'RETRY_BOUNDED'){
      $record=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId;readiness_fingerprint=$currentDigest;readiness_units=$units;no_progress_counts=$noProgressCounts;last_action_hashes=$lastActionHashes;parked_reasons=$parkedReasons;active_pid=$null;active_unit_id=$null;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='NO_READY_LANES';scheduler_decision=$control.scheduler;goal_completed=$false}
      Write-AtomicJson $statePath $record
      exit 0
    }
    if($stageClock.Elapsed.TotalSeconds -ge $MaxStageSeconds){
      $record=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId;readiness_fingerprint=$currentDigest;readiness_units=$units;no_progress_counts=$noProgressCounts;last_action_hashes=$lastActionHashes;parked_reasons=$parkedReasons;active_pid=$null;active_unit_id=$null;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='STAGE_TIME_BUDGET_EXHAUSTED_WITH_READY_WORK';scheduler_decision=$control.scheduler;goal_completed=$false}
      Write-AtomicJson $statePath $record
      exit 0
    }
    $selected=[string]$control.scheduler.unit
    $selectedUnit=Get-ReadinessUnit $units $selected
    if(-not $selectedUnit){throw 'SCHEDULER_SELECTED_UNKNOWN_UNIT'}
    if($state.next_action_unit_id -eq $selected -and $state.next_single_action){$currentActionText=[string]$state.next_single_action}else{$currentActionText='Execute one selected READY unit and recompute readiness'}
    $priorActionHash=[string]$lastActionHashes[$selected]
    $actionHash=Get-Sha256 ($selected+"`n"+$currentActionText)
    if($stateMatches -and [string]$lastActionHashes[$selected] -eq $actionHash){
      $units=Set-ReadinessUnitState $units $selected 'WAITING_EXTERNAL'
      $parkedReasons[$selected]='DUPLICATE_UNCHANGED_ACTION_SUPPRESSED'
      $lastActionHashes.Remove($selected)
      $controlAfterSuppression=Invoke-SupervisorControl -Fingerprint $material -Units $units
      $record=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId;readiness_fingerprint=$currentDigest;readiness_units=$units;no_progress_counts=$noProgressCounts;last_action_hashes=$lastActionHashes;parked_reasons=$parkedReasons;next_single_action=$state.next_single_action;next_action_unit_id=$state.next_action_unit_id;active_pid=$null;active_unit_id=$null;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='DUPLICATE_UNCHANGED_ACTION_SUPPRESSED';goal_completed=$false}
      Write-AtomicJson $statePath $record
      $state=Normalize-State $record
      if($controlAfterSuppression.scheduler.decision -eq 'DISPATCH' -or $controlAfterSuppression.scheduler.decision -eq 'RETRY_BOUNDED'){$stateMatches=$true;continue}
      exit 0
    }
    $authorityReadback=Get-AuthorityReadback $material
    $selectedUnits=Set-ReadinessUnitState $units $selected 'RUNNING'
    $stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+$turnNumber.ToString('000')
    $stdout=Join-Path $logDir ($stamp+'.stdout.jsonl')
    $stderr=Join-Path $logDir ($stamp+'.stderr.log')
    $lastMessage=Join-Path $logDir ($stamp+'.last-message.json')
    $schemaPath=Join-Path $PSScriptRoot 'schemas\readiness-result.schema.json'
    if(-not(Test-Path -LiteralPath $schemaPath -PathType Leaf)){throw 'READINESS_SCHEMA_FILE_MISSING'}
    $prompt=@'
You are the unprivileged bounded Codex executor for CHATGPT_GLOBAL_SKILL_GOVERNANCE.
The prompt, saved state, prior conversation, memory, and continuity snapshots are locators/projections only. Fresh-read Project Directory -> canonical control pointer -> checkpoint and referenced run -> exact anchored Mission/Execution Policy -> accepted-source -> current provider state. Issue #310 and PR metadata are coordination/evidence only. Continuity CURRENT.json/snapshots are optional derived projections; if missing or stale, reconstruct from canonical sources.
Preserve the current Mission and every provider/backend permit gate. Do not mutate Host, Production, business projects, credentials, paid services, canonical control, CP192/JIT, OP025, or operation027 without the exact governing permit. Production final approval, new paid services, legal/contract/signature/identity decisions, OAuth/MFA, and major irreversible trust-boundary changes remain Human-reserved. Never infer a project-completion state from this Codex turn.
The selected unit is one READY lane only. If it waits externally, record that lane as WAITING_EXTERNAL and select a different READY lawful lane. Do not repeat an unchanged test, handoff, comment, snapshot, or status action. Local reversible pre-production work already authorized by the current Mission may continue without asking the Human to say continue.
After this unit, fresh-read authority/provider state and return scheduler states for all currently relevant lanes. A completed Codex turn is one unit result only, not Goal completion. If any READY lane remains, identify the single highest-priority READY next action. Unknown effects are readback-first; never redispatch OP025 while UNKNOWN.
Return only JSON conforming to the supplied readiness schema. Copy the exact expected authority_readback fields below; these are checked against the supervisor's own fresh-read values and are not authority.
If run_identity_matches_checkpoint=false or any other authority_coherence field is false, preserve the exact mismatch in the readiness result, keep noncanonical coherence-repair preparation READY, and recompute unrelated lanes normally; do not publish canonical state or dispatch Host work from the mismatch.
'@
    $prompt += "`nSCHEDULER_SELECTED_UNIT=$selected`nPROVIDER_FINGERPRINT=$currentDigest`nSCHEDULER_UNITS="+($units|ConvertTo-Json -Depth 12 -Compress)+"`nEXPECTED_AUTHORITY_READBACK="+($authorityReadback|ConvertTo-Json -Depth 8 -Compress)+"`n"
    $record=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId;readiness_fingerprint=$currentDigest;readiness_units=$selectedUnits;no_progress_counts=$noProgressCounts;last_action_hashes=$lastActionHashes;parked_reasons=$parkedReasons;active_unit_id=$selected;active_pid=$null;active_started_utc=$null;active_executable_path=$null;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='STARTING'}
    Write-AtomicJson $statePath $record
    $remainingSeconds=[Math]::Max(1,[int]($MaxStageSeconds-$stageClock.Elapsed.TotalSeconds))
    $runTimeout=[Math]::Min($MaxRunSeconds,$remainingSeconds)
    $onStarted={
      param($ProcessId,$StartedUtc)
      $record.active_pid=[int]$ProcessId
      $record.active_started_utc=[string]$StartedUtc
      $record.active_executable_path=[string]$codex.Source
      $record.last_result='RUNNING'
      Write-AtomicJson $statePath $record
    }
    $run=$null;$runError=$null;$result=$null
    try{$run=Invoke-CodexBounded -CodexPath $codex.Source -Workspace $Workspace -Prompt $prompt -StdoutPath $stdout -StderrPath $stderr -LastMessagePath $lastMessage -OutputSchemaPath $schemaPath -CodexHome $CodexHome -TimeoutSeconds $runTimeout -OnStarted $onStarted}catch{$runError=[string]$_.Exception.Message}
    if($runError){
      if($runError -match 'PROCESS_TREE_CLEANUP_UNPROVEN'){
        $record.last_result='PROCESS_TREE_CLEANUP_UNPROVEN'
        $record.active_recovery='PROCESS_TREE_CLEANUP_UNPROVEN'
        $record.unresolved_process_ids=@()
        $record.last_error=$runError
        Write-AtomicJson $statePath $record
        exit 24
      }
      $material=Provider-Fingerprint
      $digestProbe=Invoke-SupervisorControl -Fingerprint $material -Units @()
      $currentDigest=[string]$digestProbe.fingerprint_digest
      $units=if($currentDigest -ne [string]$record.readiness_fingerprint){New-ReadinessSeed}else{Set-ReadinessUnitState $selectedUnits $selected 'WAITING_EXTERNAL'}
      $lastActionHashes[$selected]=$actionHash
      $parkedReasons[$selected]='CODEX_TURN_FAILED:'+($runError -replace '[\r\n]+',' ')
      $record=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId;readiness_fingerprint=$currentDigest;readiness_units=$units;no_progress_counts=$noProgressCounts;last_action_hashes=$lastActionHashes;parked_reasons=$parkedReasons;active_pid=$null;active_unit_id=$null;last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');last_result='CODEX_TURN_FAILED';last_error=$parkedReasons[$selected];goal_completed=$false}
      Write-AtomicJson $statePath $record
      $state=Normalize-State $record
      $material=$material
      $stateMatches=$true
      $pendingActionHash='';$pendingActionUnit='';$pendingActionText=''
      continue
    }
    if(-not $run.process_tree_cleanup_proven){
      $lastActionHashes[$selected]=$actionHash
      $record.last_result='PROCESS_TREE_CLEANUP_UNPROVEN'
      $record.active_recovery='PROCESS_TREE_CLEANUP_UNPROVEN'
      $record.unresolved_process_ids=@($run.cleanup_evidence.remaining_pids|ForEach-Object{[int]$_})
      $record.timeout_cleanup=$run.cleanup_evidence
      Write-AtomicJson $statePath $record
      exit 24
    }
    $materialAfter=Provider-Fingerprint
    $afterProbe=Invoke-SupervisorControl -Fingerprint $materialAfter -Units @()
    $afterDigest=[string]$afterProbe.fingerprint_digest
    $record.active_pid=$null;$record.active_unit_id=$null;$record.active_started_utc=$null;$record.active_executable_path=$null
    $record.last_exit_code=[int]$run.exit_code
    $record.output_capture=[ordered]@{stdout_path=$run.stdout_path;stderr_path=$run.stderr_path;last_message_path=$lastMessage;stdout_bytes_read=$run.stdout_bytes_read;stderr_bytes_read=$run.stderr_bytes_read;stdout_bytes_stored=$run.stdout_bytes_stored;stderr_bytes_stored=$run.stderr_bytes_stored;stdout_truncated=$run.stdout_truncated;stderr_truncated=$run.stderr_truncated}
    $record.last_turn_marker=[bool]$run.turn_completed
    if($run.timed_out){
      $units=Set-ReadinessUnitState $selectedUnits $selected 'WAITING_EXTERNAL'
      $parkedReasons[$selected]='CODEX_TIMEOUT_EFFECT_READBACK_REQUIRED'
      $record.last_result='TIMEOUT_TREE_TERMINATED_AND_VERIFIED';$record.timeout_cleanup=$run.cleanup_evidence
    }elseif(-not $run.turn_completed -or [int]$run.exit_code -ne 0 -or -not(Test-Path -LiteralPath $lastMessage -PathType Leaf)){
      $units=Set-ReadinessUnitState $selectedUnits $selected 'WAITING_EXTERNAL'
      $parkedReasons[$selected]='TURN_RESULT_MISSING_OR_NONZERO_EXIT'
      $record.last_result='NO_VALID_TURN_RESULT'
    }else{
      $result=$null;$validatedUnits=$null;$validationError=$null
      try{$result=Get-Content -LiteralPath $lastMessage -Raw|ConvertFrom-Json;$validatedUnits=Assert-ReadinessResult -Result $result -ExpectedDigest $currentDigest -ExpectedReadback $authorityReadback}catch{$validationError=[string]$_.Exception.Message}
      if($validationError){
        $result=$null
        $units=Set-ReadinessUnitState $selectedUnits $selected 'WAITING_EXTERNAL'
        $parkedReasons[$selected]='INVALID_OR_STALE_READINESS_RESULT:'+($validationError -replace '[\r\n]+',' ')
        $record.last_result='INVALID_READINESS_RESULT';$record.last_error=$parkedReasons[$selected]
      }elseif($afterDigest -ne $currentDigest){
        $units=New-ReadinessSeed
        $noProgressCounts.Remove($selected)
        $lastActionHashes.Remove($selected)
        $record.last_result='TURN_COMPLETED_PROVIDER_DELTA_RECOMPUTE_READY'
        $record.completed_turn_unit=$selected
      }else{
        $units=$validatedUnits
        $returnedSelected=Get-ReadinessUnit $units $selected
        if($result.progress -eq 'WAITING_EXTERNAL'){$units=Set-ReadinessUnitState $units $selected 'WAITING_EXTERNAL';$parkedReasons[$selected]='GOVERNANCE_REPORTED_WAITING_EXTERNAL'}
        elseif($result.progress -eq 'WAITING_HUMAN'){$units=Set-ReadinessUnitState $units $selected 'WAITING_HUMAN';$parkedReasons[$selected]='GOVERNANCE_REPORTED_WAITING_HUMAN'}
        else{
          $count=if($noProgressCounts.ContainsKey($selected)){[int]$noProgressCounts[$selected]+1}else{1}
          $noProgressCounts[$selected]=$count
          if(($priorActionHash -and $priorActionHash -eq $actionHash) -or $count -ge $MaxNoProgressOperations){
            $units=Set-ReadinessUnitState $units $selected 'WAITING_EXTERNAL'
            $parkedReasons[$selected]=if($count -ge $MaxNoProgressOperations){'NO_PROGRESS_LIMIT_REACHED'}else{'DUPLICATE_UNCHANGED_ACTION_SUPPRESSED'}
          }elseif($returnedSelected -and $returnedSelected.state -eq 'DONE'){
            $units=Set-ReadinessUnitState $units $selected 'WAITING_EXTERNAL'
            $parkedReasons[$selected]='DONE_WITHOUT_VERIFIABLE_MATERIAL_DELTA'
          }
          $record.last_result='NO_MATERIAL_PROVIDER_OR_LOCAL_DELTA'
        }
      }
    }
    $record.readiness_fingerprint=$afterDigest
    $record.readiness_units=$units
    $record.no_progress_counts=$noProgressCounts
    $record.last_action_hashes=$lastActionHashes
    $record.parked_reasons=$parkedReasons
    $record.last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o')
    $record.goal_completed=$false
    if($lastMessage -and (Test-Path -LiteralPath $lastMessage -PathType Leaf)){
      $record.latest_message_sha256=(Get-FileHash -LiteralPath $lastMessage -Algorithm SHA256).Hash.ToLowerInvariant()
      $record.latest_message_path=$lastMessage
    }
    if($afterDigest -ne $currentDigest){
      $record.next_single_action='';$record.next_action_unit_id=''
      $lastActionHashes.Clear()
      $pendingActionHash='';$pendingActionUnit='';$pendingActionText=''
      $stateMatches=$true
    }elseif($result){
      $nextControl=Invoke-SupervisorControl -Fingerprint $materialAfter -Units $units
      if($nextControl.scheduler.decision -eq 'DISPATCH' -or $nextControl.scheduler.decision -eq 'RETRY_BOUNDED'){
        $pendingActionUnit=[string]$nextControl.scheduler.unit
        $pendingActionText=[string]$result.next_single_action
        $pendingActionHash=Get-Sha256 ($pendingActionUnit+"`n"+$pendingActionText)
      }else{$pendingActionUnit='';$pendingActionText='';$pendingActionHash=''}
      $record.next_single_action=$pendingActionText
      $record.next_action_unit_id=$pendingActionUnit
      $stateMatches=$true
    }else{$pendingActionHash='';$pendingActionUnit='';$pendingActionText='';$stateMatches=$true}
    if($result -and $afterDigest -eq $currentDigest){$lastActionHashes[$selected]=$actionHash}
    $record.no_progress_counts=$noProgressCounts
    $record.last_action_hashes=$lastActionHashes
    Write-AtomicJson $statePath $record
    $state=Normalize-State $record
    $material=$materialAfter
    $currentDigest=$afterDigest
  }
}catch{
  $s=Read-State $statePath
  if(-not $s){$s=[ordered]@{schema='vnext5.1.autonomy-supervisor-state.v1';project_id=$ProjectId}}
  $s.last_tick_utc=[DateTimeOffset]::UtcNow.ToString('o');$s.last_result='SUPERVISOR_ERROR';$s.last_error=$_.Exception.Message
  Write-AtomicJson $statePath $s
  exit 20
}finally{if($lock){$lock.Dispose()}}
