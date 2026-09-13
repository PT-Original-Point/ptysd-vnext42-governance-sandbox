param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit
)
$ErrorActionPreference='Stop'
$ExpectedHost='DESKTOP-1B6PD2P'
$ExpectedVmName='PTYSD-WORKER-01'
$ExpectedVmId=[Guid]'881f7819-baa9-4a4e-8cca-8f6f18fb89a9'
$Endpoint='PTYSD.HostGuard.V45'
$Root='C:\ProgramData\PTYSD\HostGuard'
$ConfigRoot=Join-Path $Root 'config'
$TranscriptRoot=Join-Path $Root 'transcripts'
$ModuleTarget=Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules\PTYSD.HostGuard'
$ReceiptGroup='PTYSDHostGuardReceiptWriters'
$CanonicalPssc=Join-Path $ConfigRoot 'PTYSD.HostGuard.V45.pssc'
$BackupPssc=Join-Path $ConfigRoot 'PTYSD.HostGuard.V45.pssc.pre-execution-policy-reconcile'
$Sddl='O:NSG:BAD:P(A;;GA;;;NS)(A;;GA;;;BA)S:P'

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
    foreach($a in @(([string]$v) -split '\s*,\s*')){if(-not [string]::IsNullOrWhiteSpace($a)){$addresses+=$a.Trim()}}
  }
  if($addresses.Count -eq 0){throw 'WINRM_LISTENING_ON_EMPTY'}
  $nonLoopback=@($addresses|Where-Object{$_ -notin @('127.0.0.1','::1')})
  if($nonLoopback.Count -ne 0){throw ('WINRM_LISTENING_ON_NOT_LOOPBACK_ONLY='+($nonLoopback -join ','))}
  [pscustomobject]@{Address=$address;Transport=$transport;Port=$port;Enabled=$enabled;ListeningOn=@($addresses)}
}

$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_SHELL_REQUIRED'}
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}
Import-Module Hyper-V -ErrorAction Stop
Import-Module Microsoft.WSMan.Management -ErrorAction Stop
$vm=Get-VM -Name $ExpectedVmName -ErrorAction Stop
if($vm.Id -ne $ExpectedVmId){throw "VM_ID_MISMATCH expected=$ExpectedVmId actual=$($vm.Id)"}
if(-not(Test-Path -LiteralPath $Root)){throw 'HOSTGUARD_ROOT_MISSING'}
if(-not(Test-Path -LiteralPath $ModuleTarget)){throw 'HOSTGUARD_MODULE_MISSING'}
if(-not(Test-Path -LiteralPath $CanonicalPssc)){throw 'HOSTGUARD_PSSC_MISSING'}
if(Test-Path -LiteralPath $BackupPssc){throw 'EXECUTION_POLICY_RECONCILE_BACKUP_ALREADY_EXISTS_MANUAL_REVIEW'}
if(-not(Test-Path -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Plugin\$Endpoint")){throw 'HOSTGUARD_ENDPOINT_MISSING'}
if(-not(Get-LocalGroup -Name $ReceiptGroup -ErrorAction SilentlyContinue)){throw 'HOSTGUARD_RECEIPT_GROUP_MISSING'}

$svc=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
if($svc.State -ne 'Running'){throw "WINRM_NOT_RUNNING state=$($svc.State)"}
$listenerPre=Get-LoopbackListenerState
$profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
if(@($profiles|Where-Object{(-not [bool]$_.Enabled)-or([string]$_.DefaultInboundAction -ne 'Block')}).Count -ne 0){throw 'FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED'}
if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW'}
if(@(Get-NetTCPConnection -State Listen -LocalPort 5986 -ErrorAction SilentlyContinue).Count -ne 0){throw 'UNEXPECTED_5986_LISTENER'}

$cfgReg=Get-PSSessionConfiguration -Name $Endpoint -ErrorAction Stop
$permissionPre=[string]$cfgReg.Permission
if($permissionPre -notmatch 'NETWORK SERVICE AccessAllowed'){throw ('NETWORK_SERVICE_ALLOW_MISSING pre='+$permissionPre)}
if($permissionPre -notmatch 'Administrators AccessAllowed'){throw ('ADMIN_ALLOW_MISSING pre='+$permissionPre)}
if($permissionPre -match 'NETWORK AccessDenied'){throw ('NETWORK_DENY_UNEXPECTED pre='+$permissionPre)}

$current=Import-PowerShellDataFile -Path $CanonicalPssc
if([string]$current.SessionType -ne 'RestrictedRemoteServer'){throw "PSSC_SESSIONTYPE_INVALID actual=$($current.SessionType)"}
if([string]$current.LanguageMode -ne 'NoLanguage'){throw "PSSC_LANGUAGEMODE_INVALID actual=$($current.LanguageMode)"}
if([string]$current.ExecutionPolicy -ne 'Restricted'){throw "PSSC_EXECUTION_POLICY_PRESTATE_UNEXPECTED actual=$($current.ExecutionPolicy)"}
if(-not [bool]$current.RunAsVirtualAccount){throw 'PSSC_VIRTUAL_ACCOUNT_REQUIRED'}
if([string]$current.TranscriptDirectory -ne $TranscriptRoot){throw "PSSC_TRANSCRIPT_DIRECTORY_MISMATCH actual=$($current.TranscriptDirectory)"}
$hyperv=(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-578')).Translate([Security.Principal.NTAccount]).Value
$networkService=(New-Object Security.Principal.SecurityIdentifier('S-1-5-20')).Translate([Security.Principal.NTAccount]).Value
$groups=@($current.RunAsVirtualAccountGroups)
if($groups.Count -ne 2 -or $hyperv -notin $groups -or $ReceiptGroup -notin $groups){throw ('PSSC_VIRTUAL_GROUPS_INVALID actual='+($groups -join ','))}
if(-not $current.RoleDefinitions.ContainsKey($networkService)){throw 'PSSC_NETWORK_SERVICE_ROLE_MISSING'}
$roleCaps=@($current.RoleDefinitions[$networkService].RoleCapabilities)
if($roleCaps.Count -ne 1 -or $roleCaps[0] -ne 'PTYSDHostGuard'){throw ('PSSC_ROLE_CAPABILITY_INVALID actual='+($roleCaps -join ','))}

$stage=Join-Path $env:TEMP ('ptysd-hostguard-ep-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage|Out-Null
$candidate=Join-Path $stage 'PTYSD.HostGuard.V45.pssc'
$roles=@{$networkService=@{RoleCapabilities='PTYSDHostGuard'}}
New-PSSessionConfigurationFile -Path $candidate -SessionType RestrictedRemoteServer -LanguageMode NoLanguage -ExecutionPolicy Bypass -RunAsVirtualAccount -RunAsVirtualAccountGroups @($hyperv,$ReceiptGroup) -TranscriptDirectory $TranscriptRoot -RoleDefinitions $roles
if(-not(Test-PSSessionConfigurationFile -Path $candidate)){throw 'PSSC_CANDIDATE_VALIDATION_FAILED'}
$candidateData=Import-PowerShellDataFile -Path $candidate
if([string]$candidateData.ExecutionPolicy -ne 'Bypass'){throw 'PSSC_CANDIDATE_EXECUTION_POLICY_NOT_BYPASS'}

$endpointTouched=$false;$canonicalReplaced=$false
Copy-Item -LiteralPath $CanonicalPssc -Destination $BackupPssc -ErrorAction Stop
try{
  Unregister-PSSessionConfiguration -Name $Endpoint -Force -NoServiceRestart -ErrorAction Stop
  $endpointTouched=$true
  Register-PSSessionConfiguration -Name $Endpoint -Path $candidate -AccessMode Remote -SecurityDescriptorSddl $Sddl -Force -NoServiceRestart -ErrorAction Stop|Out-Null
  Copy-Item -LiteralPath $candidate -Destination $CanonicalPssc -Force -ErrorAction Stop
  $canonicalReplaced=$true
  Restart-Service WinRM -Force -ErrorAction Stop

  $cfgPost=Get-PSSessionConfiguration -Name $Endpoint -ErrorAction Stop
  $permissionPost=[string]$cfgPost.Permission
  if($permissionPost -match 'NETWORK AccessDenied'){throw ('NETWORK_DENY_REAPPEARED post='+$permissionPost)}
  if($permissionPost -notmatch 'NETWORK SERVICE AccessAllowed'){throw ('NETWORK_SERVICE_ALLOW_MISSING post='+$permissionPost)}
  if($permissionPost -notmatch 'Administrators AccessAllowed'){throw ('ADMIN_ALLOW_MISSING post='+$permissionPost)}
  $postData=Import-PowerShellDataFile -Path $CanonicalPssc
  if([string]$postData.ExecutionPolicy -ne 'Bypass'){throw "PSSC_EXECUTION_POLICY_POST_INVALID actual=$($postData.ExecutionPolicy)"}
  if([string]$postData.SessionType -ne 'RestrictedRemoteServer'){throw 'PSSC_SESSIONTYPE_CHANGED'}
  if([string]$postData.LanguageMode -ne 'NoLanguage'){throw 'PSSC_LANGUAGEMODE_CHANGED'}
  $listenerPost=Get-LoopbackListenerState
  if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_FIREWALL_RULE_APPEARED_UNEXPECTEDLY'}
  $profilesPost=@(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
  if(@($profilesPost|Where-Object{(-not [bool]$_.Enabled)-or([string]$_.DefaultInboundAction -ne 'Block')}).Count -ne 0){throw 'FIREWALL_DEFAULT_INBOUND_CHANGED'}

  [pscustomobject]@{
    Result='HOSTGUARD_JEA_EXECUTION_POLICY_RECONCILED'
    Endpoint=$Endpoint
    SourceCommit=$SourceCommit
    Host=$env:COMPUTERNAME
    VmName=$vm.Name
    VmId=$vm.Id.ToString()
    ExecutionPolicyBefore='Restricted'
    ExecutionPolicyAfter='Bypass'
    SessionType='RestrictedRemoteServer'
    LanguageMode='NoLanguage'
    PermissionAfter=$permissionPost
    ListenerAddress=$listenerPost.Address
    ListenerTransport=$listenerPost.Transport
    ListenerPort=$listenerPost.Port
    ListeningOn=$listenerPost.ListeningOn
    BackupPssc=$BackupPssc
    GlobalExecutionPolicyMutation=$false
    PublicFirewallMutation=$false
    RunnerPrivilegeElevation=$false
    VmMutation=$false
  }|ConvertTo-Json -Depth 5
}catch{
  $err=$_.Exception.Message;$rollbackErrors=@()
  if($endpointTouched){
    try{if(Get-PSSessionConfiguration -Name $Endpoint -ErrorAction SilentlyContinue){Unregister-PSSessionConfiguration -Name $Endpoint -Force -NoServiceRestart -ErrorAction Stop}}catch{$rollbackErrors+="unregister-candidate:$($_.Exception.Message)"}
    try{Register-PSSessionConfiguration -Name $Endpoint -Path $BackupPssc -AccessMode Remote -SecurityDescriptorSddl $Sddl -Force -NoServiceRestart -ErrorAction Stop|Out-Null}catch{$rollbackErrors+="register-backup:$($_.Exception.Message)"}
  }
  try{Copy-Item -LiteralPath $BackupPssc -Destination $CanonicalPssc -Force -ErrorAction Stop}catch{$rollbackErrors+="restore-pssc:$($_.Exception.Message)"}
  try{Restart-Service WinRM -Force -ErrorAction Stop}catch{$rollbackErrors+="winrm:$($_.Exception.Message)"}
  if($rollbackErrors.Count -gt 0){throw ("EXECUTION_POLICY_RECONCILE_FAILED=$err;ROLLBACK_ERRORS="+($rollbackErrors -join '|'))}
  throw $err
}finally{
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
