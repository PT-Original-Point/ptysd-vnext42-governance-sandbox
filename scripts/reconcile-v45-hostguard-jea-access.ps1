param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit
)
$ErrorActionPreference='Stop'
$ExpectedHost='DESKTOP-1B6PD2P'
$ExpectedVmName='PTYSD-WORKER-01'
$ExpectedVmId=[Guid]'881f7819-baa9-4a4e-8cca-8f6f18fb89a9'
$Endpoint='PTYSD.HostGuard.V45'
$Root='C:\ProgramData\PTYSD\HostGuard'
$ModuleTarget=Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules\PTYSD.HostGuard'
$ReceiptGroup='PTYSDHostGuardReceiptWriters'
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

function Get-HostGuardListenerState {
  $listeners=@(Get-ChildItem WSMan:\localhost\Listener -ErrorAction Stop)
  if($listeners.Count -ne 1){throw "WINRM_LISTENER_COUNT_INVALID count=$($listeners.Count)"}
  $listener=$listeners[0]
  if(-not($listener.Keys -contains 'Address=IP:127.0.0.1')){throw ('WINRM_LISTENER_ADDRESS_NOT_LOOPBACK keys='+($listener.Keys -join ','))}
  if(-not($listener.Keys -contains 'Transport=HTTP')){throw ('WINRM_LISTENER_TRANSPORT_INVALID keys='+($listener.Keys -join ','))}
  $listeningItem=Get-Item -Path ($listener.PSPath+'\ListeningOn') -ErrorAction Stop
  $addresses=@()
  foreach($v in @($listeningItem.Value)){
    foreach($a in @(([string]$v) -split '\s*,\s*')){if(-not [string]::IsNullOrWhiteSpace($a)){$addresses+=$a.Trim()}}
  }
  if($addresses.Count -eq 0){throw 'WINRM_LISTENING_ON_EMPTY'}
  $nonLoopback=@($addresses|Where-Object{$_ -notin @('127.0.0.1','::1')})
  if($nonLoopback.Count -ne 0){throw ('WINRM_LISTENING_ON_NOT_LOOPBACK_ONLY='+($nonLoopback -join ','))}
  [pscustomobject]@{Keys=@($listener.Keys);ListeningOn=@($addresses)}
}

$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_SHELL_REQUIRED'}
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}
Import-Module Hyper-V -ErrorAction Stop
$vm=Get-VM -Name $ExpectedVmName -ErrorAction Stop
if($vm.Id -ne $ExpectedVmId){throw "VM_ID_MISMATCH expected=$ExpectedVmId actual=$($vm.Id)"}
if(-not(Test-Path -LiteralPath $Root)){throw 'HOSTGUARD_ROOT_MISSING'}
if(-not(Test-Path -LiteralPath $ModuleTarget)){throw 'HOSTGUARD_MODULE_MISSING'}
if(-not(Get-LocalGroup -Name $ReceiptGroup -ErrorAction SilentlyContinue)){throw 'HOSTGUARD_RECEIPT_GROUP_MISSING'}
if(-not(Test-Path -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Plugin\$Endpoint")){throw 'HOSTGUARD_ENDPOINT_MISSING'}

$svc=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
if($svc.State -ne 'Running'){throw "WINRM_NOT_RUNNING state=$($svc.State)"}
$listenerPre=Get-HostGuardListenerState
$fwProfiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
if(@($fwProfiles|Where-Object{(-not [bool]$_.Enabled)-or([string]$_.DefaultInboundAction -ne 'Block')}).Count -ne 0){throw 'FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED'}
if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW'}
if(@(Get-NetTCPConnection -State Listen -LocalPort 5986 -ErrorAction SilentlyContinue).Count -ne 0){throw 'UNEXPECTED_5986_LISTENER'}

$cfgPre=Get-PSSessionConfiguration -Name $Endpoint -ErrorAction Stop
$permissionPre=[string]$cfgPre.Permission
if($permissionPre -notmatch 'NETWORK SERVICE AccessAllowed'){throw ('NETWORK_SERVICE_ALLOW_MISSING pre='+$permissionPre)}
if($permissionPre -notmatch 'NETWORK AccessDenied'){throw ('EXPECTED_NETWORK_DENY_MISSING pre='+$permissionPre)}

$changed=$false
try{
  Set-PSSessionConfiguration -Name $Endpoint -AccessMode Remote -SecurityDescriptorSddl $Sddl -Force -NoServiceRestart -ErrorAction Stop|Out-Null
  $changed=$true
  Restart-Service WinRM -Force -ErrorAction Stop

  $cfgPost=Get-PSSessionConfiguration -Name $Endpoint -ErrorAction Stop
  $permissionPost=[string]$cfgPost.Permission
  if($permissionPost -match 'NETWORK AccessDenied'){throw ('NETWORK_DENY_STILL_PRESENT post='+$permissionPost)}
  if($permissionPost -notmatch 'NETWORK SERVICE AccessAllowed'){throw ('NETWORK_SERVICE_ALLOW_MISSING post='+$permissionPost)}
  $listenerPost=Get-HostGuardListenerState
  if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_FIREWALL_RULE_APPEARED_UNEXPECTEDLY'}
  $profilesPost=@(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
  if(@($profilesPost|Where-Object{(-not [bool]$_.Enabled)-or([string]$_.DefaultInboundAction -ne 'Block')}).Count -ne 0){throw 'FIREWALL_DEFAULT_INBOUND_CHANGED'}

  [pscustomobject]@{
    Result='HOSTGUARD_JEA_ACCESS_RECONCILED'
    Endpoint=$Endpoint
    SourceCommit=$SourceCommit
    Host=$env:COMPUTERNAME
    VmName=$vm.Name
    VmId=$vm.Id.ToString()
    PermissionBefore=$permissionPre
    PermissionAfter=$permissionPost
    AccessModeRemoteUsedOnlyToRemoveNetworkDeny=$true
    ListenerKeys=$listenerPost.Keys
    ListeningOn=$listenerPost.ListeningOn
    PublicFirewallMutation=$false
    RunnerPrivilegeElevation=$false
    VmMutation=$false
  }|ConvertTo-Json -Depth 5
}catch{
  $err=$_.Exception.Message;$rollbackErrors=@()
  if($changed){
    try{Set-PSSessionConfiguration -Name $Endpoint -AccessMode Local -SecurityDescriptorSddl $Sddl -Force -NoServiceRestart -ErrorAction Stop|Out-Null}catch{$rollbackErrors+="endpoint:$($_.Exception.Message)"}
    try{Restart-Service WinRM -Force -ErrorAction Stop}catch{$rollbackErrors+="winrm:$($_.Exception.Message)"}
  }
  if($rollbackErrors.Count -gt 0){throw ("RECONCILE_FAILED=$err;ROLLBACK_ERRORS="+($rollbackErrors -join '|'))}
  throw $err
}
