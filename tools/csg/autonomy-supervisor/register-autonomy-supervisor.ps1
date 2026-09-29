#requires -Version 5.1
[CmdletBinding(SupportsShouldProcess)]
param([string]$TaskName='PTYSD-Autonomy-Supervisor-V51',[string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'PTYSD\AutonomySupervisor'),[string]$SourceRoot,[int]$RepeatMinutes=5)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

if(-not $env:LOCALAPPDATA){throw 'CURRENT_USER_LOCALAPPDATA_UNAVAILABLE'}
if($RepeatMinutes -lt 1 -or $RepeatMinutes -gt 60){throw 'REPEAT_MINUTES_OUT_OF_RANGE'}
if(-not $SourceRoot){$SourceRoot=$PSScriptRoot}
$SourceRoot=[IO.Path]::GetFullPath($SourceRoot)
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$localRoot=[IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
if(-not $InstallRoot.StartsWith($localRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'INSTALL_ROOT_MUST_BE_CURRENT_USER_SCOPED'}
if($InstallRoot -eq $localRoot.TrimEnd([IO.Path]::DirectorySeparatorChar)){throw 'INSTALL_ROOT_MUST_BE_A_CHILD_OF_LOCALAPPDATA'}

$runtimeFiles=@(
  'ptysd-autonomy-supervisor.ps1',
  'lib\fingerprint.mjs',
  'lib\scheduler.mjs',
  'lib\supervisor-control.mjs',
  'lib\BoundedPipeCapture.cs',
  'schemas\readiness-result.schema.json'
)
$sourceEntries=@()
foreach($relative in $runtimeFiles){
  $source=Join-Path $SourceRoot $relative
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw ('SUPERVISOR_RUNTIME_DEPENDENCY_MISSING:'+ $relative)}
  $sourceEntries+=@([ordered]@{path=$relative;source=$source;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()})
}

function Get-PolicyCompliantPowerShell([string]$ScriptPath){
  $candidates=@()
  $systemPwsh=Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
  if($systemPwsh -and (Test-Path -LiteralPath $systemPwsh -PathType Leaf)){$candidates+=@($systemPwsh)}
  foreach($name in @('pwsh.exe','powershell.exe')){
    foreach($command in @(Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue)){
      if($command.Source -and $candidates -notcontains $command.Source){$candidates+=@([string]$command.Source)}
    }
  }
  foreach($candidate in $candidates){
    try{
      $policyOutput=@(& $candidate -NoLogo -NoProfile -NonInteractive -Command 'Get-ExecutionPolicy' 2>$null)
      if($LASTEXITCODE -ne 0 -or $policyOutput.Count -eq 0){continue}
      $policy=[string]$policyOutput[-1]
      $scriptAllowed=$false
      if($policy -eq 'RemoteSigned' -or $policy -eq 'Unrestricted'){
        $zone=$null
        try{$zone=Get-Item -LiteralPath $ScriptPath -Stream Zone.Identifier -ErrorAction SilentlyContinue}catch{continue}
        $scriptAllowed=($null -eq $zone)
      }elseif($policy -eq 'AllSigned'){
        $signature=Get-AuthenticodeSignature -FilePath $ScriptPath
        $scriptAllowed=($signature.Status -eq 'Valid')
      }
      if($scriptAllowed){
        $item=Get-Item -LiteralPath $candidate
        return [ordered]@{path=[IO.Path]::GetFullPath($candidate);policy=$policy;sha256=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant();file_version=[string]$item.VersionInfo.FileVersion}
      }
    }catch{continue}
  }
  throw 'NO_POLICY_COMPLIANT_POWERSHELL_RUNTIME'
}

$sourceScript=Join-Path $SourceRoot 'ptysd-autonomy-supervisor.ps1'
$runtime=Get-PolicyCompliantPowerShell -ScriptPath $sourceScript
$installedScript=Join-Path $InstallRoot 'ptysd-autonomy-supervisor.ps1'
$stageRoot=$InstallRoot+'.stage.'+$PID
$existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if($existing){throw 'EXISTING_SUPERVISOR_TASK_REQUIRES_EXACT_BACKUP_AND_READBACK'}
if((Test-Path -LiteralPath $InstallRoot) -or (Test-Path -LiteralPath $stageRoot)){throw 'SUPERVISOR_INSTALL_TARGET_EXISTS_REQUIRES_EXACT_BACKUP_AND_READBACK'}

$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$actionArgs='-NoLogo -NoProfile -NonInteractive -File "'+$installedScript+'"'
$action=New-ScheduledTaskAction -Execute $runtime.path -Argument $actionArgs
$atLogOn=New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat=New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $RepeatMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 50)
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

if(-not $PSCmdlet.ShouldProcess($TaskName,'Stage exact supervisor runtime bundle and register unprivileged current-user task')){
  [ordered]@{state='WHATIF_OR_DECLINED';task_name=$TaskName;install_root=$InstallRoot;runtime=$runtime;files=$sourceEntries}|ConvertTo-Json -Depth 8 -Compress
  return
}

New-Item -ItemType Directory -Path $stageRoot | Out-Null
foreach($entry in $sourceEntries){
  $relative=$entry.path
  $destination=Join-Path $stageRoot $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $entry.source -Destination $destination
  $installedHash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if($installedHash -ne $entry.sha256){throw ('STAGED_RUNTIME_HASH_MISMATCH:'+ $relative)}
}
Move-Item -LiteralPath $stageRoot -Destination $InstallRoot

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atLogOn,$repeat) -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $TaskName
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
[ordered]@{
  state='REGISTERED'
  task_name=$task.TaskName
  task_state=[string]$task.State
  user_id=[string]$task.Principal.UserId
  run_level=[string]$task.Principal.RunLevel
  action_execute=$runtime.path
  action_arguments=$actionArgs
  install_root=$InstallRoot
  runtime=$runtime
  files=@($sourceEntries|ForEach-Object{[ordered]@{path=$_.path;sha256=(Get-FileHash -LiteralPath (Join-Path $InstallRoot $_.path) -Algorithm SHA256).Hash.ToLowerInvariant()}})
}|ConvertTo-Json -Depth 8 -Compress
