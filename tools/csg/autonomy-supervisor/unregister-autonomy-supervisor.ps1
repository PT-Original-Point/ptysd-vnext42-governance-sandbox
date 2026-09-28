#requires -Version 5.1
[CmdletBinding(SupportsShouldProcess)]
param([string]$TaskName='PTYSD-Autonomy-Supervisor-V50')
$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if(-not $task){'{"state":"NOT_INSTALLED"}';exit 0}
if($PSCmdlet.ShouldProcess($TaskName,'Unregister autonomy supervisor')){Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false}
'{"state":"UNREGISTERED"}'
