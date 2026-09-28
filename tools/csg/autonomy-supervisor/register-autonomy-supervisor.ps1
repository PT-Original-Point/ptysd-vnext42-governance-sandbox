#requires -Version 5.1
[CmdletBinding(SupportsShouldProcess)]
param([string]$TaskName='PTYSD-Autonomy-Supervisor-V50',[string]$InstallRoot='C:\ProgramData\PTYSD\AutonomySupervisor',[string]$SourceScript,[ValidateSet('SYSTEM','CURRENT_USER')][string]$PrincipalMode='SYSTEM',[int]$RepeatMinutes=5)
$ErrorActionPreference='Stop'
if(-not $SourceScript){$SourceScript=Join-Path $PSScriptRoot 'ptysd-autonomy-supervisor.ps1'}
if(-not(Test-Path -LiteralPath $SourceScript)){throw 'SUPERVISOR_SOURCE_NOT_FOUND'}
New-Item -ItemType Directory -Force -Path $InstallRoot|Out-Null
$dest=Join-Path $InstallRoot 'ptysd-autonomy-supervisor.ps1'
Copy-Item -LiteralPath $SourceScript -Destination $dest -Force
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $dest)
$startup=New-ScheduledTaskTrigger -AtStartup
$repeat=New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $RepeatMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 50)
if($PrincipalMode -eq 'SYSTEM'){$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest}else{$id=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$principal=New-ScheduledTaskPrincipal -UserId $id -LogonType Interactive -RunLevel Highest}
if($PSCmdlet.ShouldProcess($TaskName,'Register autonomy supervisor')){Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($startup,$repeat) -Settings $settings -Principal $principal -Force|Out-Null;Start-ScheduledTask -TaskName $TaskName}
Get-ScheduledTask -TaskName $TaskName|Select-Object TaskName,State,@{n='UserId';e={$_.Principal.UserId}},@{n='RunLevel';e={$_.Principal.RunLevel}}|ConvertTo-Json -Compress
