#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskName = 'VNEXT5.1-R2-Supervisor'
$taskPath = '\'
$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop
$expectedRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'CSG\VNEXT5.1-R2-Supervisor'
$expectedNode = [System.IO.Path]::GetFullPath((Join-Path $expectedRoot 'runtime\node.exe'))
$expectedEntrypoint = [System.IO.Path]::GetFullPath((Join-Path $expectedRoot 'bin\host-supervisor.mjs'))
$expectedArguments = '"' + $expectedEntrypoint + '" --project-id CHATGPT_GLOBAL_SKILL_GOVERNANCE --locator refs/heads/governance/project-directory'
$identityMatches = [string]::Equals([string]$task.Principal.UserId, 'NT AUTHORITY\LOCAL SERVICE', [System.StringComparison]::OrdinalIgnoreCase) -and
  [string]$task.Principal.LogonType -eq 'ServiceAccount' -and [string]$task.Principal.RunLevel -eq 'Limited'
$actionMatches = @($task.Actions).Count -eq 1 -and
  [string]::Equals([string]$task.Actions[0].Execute, $expectedNode, [System.StringComparison]::OrdinalIgnoreCase) -and
  [string]::Equals([string]$task.Actions[0].Arguments, $expectedArguments, [System.StringComparison]::Ordinal) -and
  [string]::Equals([string]$task.Actions[0].WorkingDirectory, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)
if (-not ($identityMatches -and $actionMatches)) {
  throw [System.InvalidOperationException]::new('SUPERVISOR_TASK_IDENTITY_MISMATCH')
}
Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction Stop
$remaining = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if ($null -ne $remaining) {
  throw [System.InvalidOperationException]::new('SUPERVISOR_TASK_REMOVE_READBACK_MISMATCH')
}
[pscustomobject]@{status='REMOVED_EXACT_TASK';task_name=$taskName;task_path=$taskPath;action=$expectedNode;arguments=$expectedArguments} | ConvertTo-Json -Compress
