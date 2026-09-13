$ErrorActionPreference='Stop'
$manifest=Join-Path $PWD 'host\v45\PTYSD.HostGuard\PTYSD.HostGuard.psd1'
if(-not(Test-Path -LiteralPath $manifest)){throw "HOSTGUARD_MANIFEST_MISSING=$manifest"}
$data=Import-PowerShellDataFile -Path $manifest
$required=@($data.RequiredModules)
$names=@()
foreach($entry in $required){
  if($entry -is [string]){$names+=[string]$entry}
  elseif($null -ne $entry.ModuleName){$names+=[string]$entry.ModuleName}
}
$hypervMatches=@($names|Where-Object{$_ -eq 'Hyper-V'})
if($hypervMatches.Count -ne 1){throw "HOSTGUARD_HYPERV_REQUIRED_MODULE_COUNT_INVALID count=$($hypervMatches.Count) actual=$($names -join ',')"}
Remove-Module PTYSD.HostGuard -Force -ErrorAction SilentlyContinue
Remove-Module Hyper-V -Force -ErrorAction SilentlyContinue
Import-Module -Name $manifest -Force -ErrorAction Stop
$hyperv=Get-Module -Name Hyper-V -ErrorAction SilentlyContinue
if($null -eq $hyperv){throw 'HOSTGUARD_REQUIRED_HYPERV_MODULE_NOT_LOADED'}
$cmd=Get-Command Get-VM -ErrorAction Stop
if([string]$cmd.ModuleName -ne 'Hyper-V'){throw "GET_VM_SOURCE_INVALID actual=$($cmd.ModuleName)"}
[pscustomobject]@{
  Result='PASS_V45_HOSTGUARD_HYPERV_DEPENDENCY'
  RequiredModule='Hyper-V'
  RequiredModules=$names
  HyperVModuleLoaded=$true
  GetVmResolved=$true
  GetVmModule=[string]$cmd.ModuleName
}|ConvertTo-Json -Depth 4
