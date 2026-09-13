param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit
)
$ErrorActionPreference='Stop'
$ExpectedHost='DESKTOP-1B6PD2P'
$ExpectedVmName='PTYSD-WORKER-01'
$ExpectedVmId=[Guid]'881f7819-baa9-4a4e-8cca-8f6f18fb89a9'
$Endpoint='PTYSD.HostGuard.V45'
$ModuleTarget=Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules\PTYSD.HostGuard'
$ManifestTarget=Join-Path $ModuleTarget 'PTYSD.HostGuard.psd1'
$BackupManifest=Join-Path $ModuleTarget 'PTYSD.HostGuard.psd1.pre-runtime-dependency-reconcile'
$CanonicalPssc='C:\ProgramData\PTYSD\HostGuard\config\PTYSD.HostGuard.V45.pssc'
$CandidateUrl="https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox/$SourceCommit/host/v45/PTYSD.HostGuard/PTYSD.HostGuard.psd1"
$ExpectedRequired=@('Hyper-V','CimCmdlets','NetTCPIP')

function Get-EnabledWinRmPortRules {
  $hits=@()
  $inbound=@(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -ErrorAction Stop)
  foreach($r in $inbound){
    foreach($pf in @($r|Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)){
      if(([string]$pf.LocalPort) -in @('5985','5986')){$hits+=$r}
    }
  }
  return @($hits)
}
function Get-LoopbackListenerState {
  $listeners=@(Get-WSManInstance -ResourceURI 'winrm/config/listener' -Enumerate -ErrorAction Stop)
  if($listeners.Count -ne 1){throw "WINRM_LISTENER_COUNT_INVALID count=$($listeners.Count)"}
  $listener=$listeners[0]
  $address=[string]$listener.Address;$transport=[string]$listener.Transport;$port=[int]$listener.Port;$enabled=[string]$listener.Enabled
  if($address -ne 'IP:127.0.0.1'){throw "WINRM_LISTENER_ADDRESS_NOT_LOOPBACK address=$address"}
  if($transport -ine 'HTTP'){throw "WINRM_LISTENER_TRANSPORT_INVALID transport=$transport"}
  if($port -ne 5985){throw "WINRM_LISTENER_PORT_INVALID port=$port"}
  if($enabled -ine 'true'){throw "WINRM_LISTENER_NOT_ENABLED enabled=$enabled"}
  $addresses=@()
  foreach($v in @($listener.ListeningOn)){
    foreach($a in @(([string]$v)-split '\s*,\s*')){if(-not [string]::IsNullOrWhiteSpace($a)){$addresses+=$a.Trim()}}
  }
  if($addresses.Count -eq 0){throw 'WINRM_LISTENING_ON_EMPTY'}
  if(@($addresses|Where-Object{$_ -notin @('127.0.0.1','::1')}).Count -ne 0){throw ('WINRM_LISTENING_ON_NOT_LOOPBACK_ONLY='+($addresses -join ','))}
  [pscustomobject]@{Address=$address;Transport=$transport;Port=$port;ListeningOn=@($addresses)}
}
function Get-RequiredModuleNames($data) {
  $names=@()
  foreach($entry in @($data.RequiredModules)){
    if($entry -is [string]){$names+=[string]$entry}
    elseif($null -ne $entry.ModuleName){$names+=[string]$entry.ModuleName}
  }
  @($names)
}
function Assert-ExactRequiredModules([string[]]$Actual,[string[]]$Expected,[string]$ErrorPrefix) {
  if($Actual.Count -ne $Expected.Count){throw "$ErrorPrefix count=$($Actual.Count) actual=$($Actual -join ',')"}
  for($i=0;$i -lt $Expected.Count;$i++){if($Actual[$i] -ne $Expected[$i]){throw "$ErrorPrefix actual=$($Actual -join ',')"}}
}

$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_SHELL_REQUIRED'}
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}
Import-Module Hyper-V -ErrorAction Stop
Import-Module Microsoft.WSMan.Management -ErrorAction Stop
$vm=Get-VM -Name $ExpectedVmName -ErrorAction Stop
if($vm.Id -ne $ExpectedVmId){throw "VM_ID_MISMATCH expected=$ExpectedVmId actual=$($vm.Id)"}
if(-not(Test-Path -LiteralPath $ManifestTarget)){throw 'HOSTGUARD_MANIFEST_MISSING'}
if(-not(Test-Path -LiteralPath $CanonicalPssc)){throw 'HOSTGUARD_PSSC_MISSING'}
if(-not(Test-Path -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Plugin\$Endpoint")){throw 'HOSTGUARD_ENDPOINT_MISSING'}
$pssc=Import-PowerShellDataFile -Path $CanonicalPssc
if([string]$pssc.ExecutionPolicy -ne 'Bypass'){throw "PSSC_EXECUTION_POLICY_NOT_BYPASS actual=$($pssc.ExecutionPolicy)"}
if([string]$pssc.SessionType -ne 'RestrictedRemoteServer'){throw "PSSC_SESSIONTYPE_INVALID actual=$($pssc.SessionType)"}
if([string]$pssc.LanguageMode -ne 'NoLanguage'){throw "PSSC_LANGUAGEMODE_INVALID actual=$($pssc.LanguageMode)"}
$svc=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
if($svc.State -ne 'Running'){throw "WINRM_NOT_RUNNING state=$($svc.State)"}
$listenerPre=Get-LoopbackListenerState
$profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
if(@($profiles|Where-Object{(-not [bool]$_.Enabled)-or([string]$_.DefaultInboundAction -ne 'Block')}).Count -ne 0){throw 'FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED'}
if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW'}
if(@(Get-NetTCPConnection -State Listen -LocalPort 5986 -ErrorAction SilentlyContinue).Count -ne 0){throw 'UNEXPECTED_5986_LISTENER'}

$current=Import-PowerShellDataFile -Path $ManifestTarget
$currentRequired=@(Get-RequiredModuleNames $current)
if($currentRequired.Count -eq 3 -and $currentRequired[0] -eq 'Hyper-V' -and $currentRequired[1] -eq 'CimCmdlets' -and $currentRequired[2] -eq 'NetTCPIP'){
  [pscustomobject]@{Result='HOSTGUARD_RUNTIME_DEPENDENCIES_ALREADY_RECONCILED';SourceCommit=$SourceCommit;Host=$env:COMPUTERNAME;VmName=$vm.Name;VmId=$vm.Id.ToString();RequiredModules=$ExpectedRequired;VmMutation=$false;PublicFirewallMutation=$false;RunnerPrivilegeElevation=$false;GlobalExecutionPolicyMutation=$false}|ConvertTo-Json -Depth 4
  exit 0
}
if($currentRequired.Count -ne 1 -or $currentRequired[0] -ne 'Hyper-V'){throw ('HOSTGUARD_REQUIRED_MODULE_PRESTATE_UNEXPECTED actual='+($currentRequired -join ','))}
if(Test-Path -LiteralPath $BackupManifest){throw 'RUNTIME_DEPENDENCY_RECONCILE_BACKUP_ALREADY_EXISTS_MANUAL_REVIEW'}

$stage=Join-Path $env:TEMP ('ptysd-hostguard-runtime-deps-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage|Out-Null
$candidate=Join-Path $stage 'PTYSD.HostGuard.psd1'
Invoke-WebRequest -UseBasicParsing -Uri $CandidateUrl -OutFile $candidate
$candidateData=Import-PowerShellDataFile -Path $candidate
if([string]$candidateData.RootModule -ne 'PTYSD.HostGuard.psm1'){throw 'CANDIDATE_ROOT_MODULE_INVALID'}
if([string]$candidateData.ModuleVersion -ne '0.1.0'){throw "CANDIDATE_MODULE_VERSION_INVALID actual=$($candidateData.ModuleVersion)"}
if([string]$candidateData.GUID -ne '47d70842-5fb8-4b59-a649-c187ae04cc1a'){throw "CANDIDATE_GUID_INVALID actual=$($candidateData.GUID)"}
$candidateRequired=@(Get-RequiredModuleNames $candidateData)
Assert-ExactRequiredModules -Actual $candidateRequired -Expected $ExpectedRequired -ErrorPrefix 'CANDIDATE_REQUIRED_MODULES_INVALID'
Test-ModuleManifest -Path $candidate -ErrorAction Stop|Out-Null

$manifestTouched=$false
Copy-Item -LiteralPath $ManifestTarget -Destination $BackupManifest -ErrorAction Stop
try{
  Copy-Item -LiteralPath $candidate -Destination $ManifestTarget -Force -ErrorAction Stop
  $manifestTouched=$true
  $installedData=Import-PowerShellDataFile -Path $ManifestTarget
  $installedRequired=@(Get-RequiredModuleNames $installedData)
  Assert-ExactRequiredModules -Actual $installedRequired -Expected $ExpectedRequired -ErrorPrefix 'INSTALLED_REQUIRED_MODULES_INVALID'
  Test-ModuleManifest -Path $ManifestTarget -ErrorAction Stop|Out-Null
  Remove-Module PTYSD.HostGuard -Force -ErrorAction SilentlyContinue
  Remove-Module CimCmdlets -Force -ErrorAction SilentlyContinue
  Remove-Module NetTCPIP -Force -ErrorAction SilentlyContinue
  Import-Module -Name $ManifestTarget -Force -ErrorAction Stop
  foreach($moduleName in $ExpectedRequired){if($null -eq (Get-Module -Name $moduleName -ErrorAction SilentlyContinue)){throw "REQUIRED_MODULE_NOT_LOADED module=$moduleName"}}
  $checks=@{
    'Get-VM'='Hyper-V'
    'Get-CimInstance'='CimCmdlets'
    'Test-NetConnection'='NetTCPIP'
  }
  foreach($name in $checks.Keys){$cmd=Get-Command $name -ErrorAction Stop;if([string]$cmd.ModuleName -ne $checks[$name]){throw "COMMAND_SOURCE_INVALID command=$name actual=$($cmd.ModuleName) expected=$($checks[$name])"}}
  Restart-Service WinRM -Force -ErrorAction Stop
  $listenerPost=Get-LoopbackListenerState
  if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_FIREWALL_RULE_APPEARED_UNEXPECTEDLY'}
  [pscustomobject]@{
    Result='HOSTGUARD_RUNTIME_DEPENDENCIES_RECONCILED'
    SourceCommit=$SourceCommit
    Host=$env:COMPUTERNAME
    VmName=$vm.Name
    VmId=$vm.Id.ToString()
    RequiredModules=$ExpectedRequired
    GetVmResolved=$true
    GetCimInstanceResolved=$true
    TestNetConnectionResolved=$true
    ListenerAddress=$listenerPost.Address
    ListenerTransport=$listenerPost.Transport
    ListenerPort=$listenerPost.Port
    ListeningOn=$listenerPost.ListeningOn
    BackupManifest=$BackupManifest
    VmMutation=$false
    PublicFirewallMutation=$false
    RunnerPrivilegeElevation=$false
    GlobalExecutionPolicyMutation=$false
  }|ConvertTo-Json -Depth 4
}catch{
  $err=$_.Exception.Message;$rollbackErrors=@()
  if($manifestTouched){try{Copy-Item -LiteralPath $BackupManifest -Destination $ManifestTarget -Force -ErrorAction Stop}catch{$rollbackErrors+="restore-manifest:$($_.Exception.Message)"}}
  try{Restart-Service WinRM -Force -ErrorAction Stop}catch{$rollbackErrors+="winrm:$($_.Exception.Message)"}
  if($rollbackErrors.Count -gt 0){throw ("RUNTIME_DEPENDENCY_RECONCILE_FAILED=$err;ROLLBACK_ERRORS="+($rollbackErrors -join '|'))}
  throw $err
}finally{
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
