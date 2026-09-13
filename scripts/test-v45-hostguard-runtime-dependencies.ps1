$ErrorActionPreference='Stop'
$manifest=Join-Path $PWD 'host\v45\PTYSD.HostGuard\PTYSD.HostGuard.psd1'
if(-not(Test-Path -LiteralPath $manifest)){throw "HOSTGUARD_MANIFEST_MISSING=$manifest"}
$data=Import-PowerShellDataFile -Path $manifest
$required=@($data.RequiredModules)
$names=@()
foreach($entry in $required){if($entry -is [string]){$names+=[string]$entry}elseif($null -ne $entry.ModuleName){$names+=[string]$entry.ModuleName}}
$expected=@('Hyper-V','CimCmdlets','NetTCPIP')
if($names.Count -ne $expected.Count){throw "HOSTGUARD_REQUIRED_MODULE_COUNT_INVALID count=$($names.Count) actual=$($names -join ',')"}
for($i=0;$i -lt $expected.Count;$i++){if($names[$i] -ne $expected[$i]){throw "HOSTGUARD_REQUIRED_MODULE_ORDER_INVALID actual=$($names -join ',')"}}
Remove-Module PTYSD.HostGuard -Force -ErrorAction SilentlyContinue
Remove-Module Hyper-V -Force -ErrorAction SilentlyContinue
Remove-Module CimCmdlets -Force -ErrorAction SilentlyContinue
Remove-Module NetTCPIP -Force -ErrorAction SilentlyContinue
Import-Module -Name $manifest -Force -ErrorAction Stop
foreach($moduleName in $expected){if($null -eq (Get-Module -Name $moduleName -ErrorAction SilentlyContinue)){throw "HOSTGUARD_REQUIRED_MODULE_NOT_LOADED module=$moduleName"}}
$checks=@{
  'Get-VM'='Hyper-V'
  'Get-CimInstance'='CimCmdlets'
  'Test-NetConnection'='NetTCPIP'
}
foreach($name in $checks.Keys){$cmd=Get-Command $name -ErrorAction Stop;if([string]$cmd.ModuleName -ne $checks[$name]){throw "HOSTGUARD_COMMAND_SOURCE_INVALID command=$name actual=$($cmd.ModuleName) expected=$($checks[$name])"}}
[pscustomobject]@{
  Result='PASS_V45_HOSTGUARD_RUNTIME_DEPENDENCIES'
  RequiredModules=$names
  HyperVModuleLoaded=[bool](Get-Module Hyper-V)
  CimCmdletsModuleLoaded=[bool](Get-Module CimCmdlets)
  NetTCPIPModuleLoaded=[bool](Get-Module NetTCPIP)
  GetVmResolved=$true
  GetCimInstanceResolved=$true
  TestNetConnectionResolved=$true
}|ConvertTo-Json -Depth 4
