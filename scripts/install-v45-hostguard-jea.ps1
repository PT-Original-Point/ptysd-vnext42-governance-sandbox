param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit
)
$ErrorActionPreference='Stop'
$ExpectedHost='DESKTOP-1B6PD2P'
$ExpectedVmName='PTYSD-WORKER-01'
$ExpectedVmId=[Guid]'881f7819-baa9-4a4e-8cca-8f6f18fb89a9'
$Endpoint='PTYSD.HostGuard.V45'
$ModuleName='PTYSD.HostGuard'
$ReceiptGroup='PTYSDHostGuardReceiptWriters'
$Root='C:\ProgramData\PTYSD\HostGuard'
$ReceiptRoot=Join-Path $Root 'receipts'
$TranscriptRoot=Join-Path $Root 'transcripts'
$ConfigRoot=Join-Path $Root 'config'
$ModuleTarget=Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules\PTYSD.HostGuard'
$RawBase="https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox/$SourceCommit"
$listenerReg='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Listener'
$preListenerAddress='*'

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

$id=[Security.Principal.WindowsIdentity]::GetCurrent();$p=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_SHELL_REQUIRED'}
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}
Import-Module Hyper-V -ErrorAction Stop
$vm=Get-VM -Name $ExpectedVmName -ErrorAction Stop
if($vm.Id -ne $ExpectedVmId){throw "VM_ID_MISMATCH expected=$ExpectedVmId actual=$($vm.Id)"}
if(Test-Path -LiteralPath $Root){throw 'HOSTGUARD_ROOT_ALREADY_EXISTS_MANUAL_RECONCILIATION_REQUIRED'}
if(Test-Path -LiteralPath $ModuleTarget){throw 'HOSTGUARD_MODULE_ALREADY_EXISTS_MANUAL_RECONCILIATION_REQUIRED'}
if(Get-LocalGroup -Name $ReceiptGroup -ErrorAction SilentlyContinue){throw 'HOSTGUARD_RECEIPT_GROUP_ALREADY_EXISTS_MANUAL_RECONCILIATION_REQUIRED'}
if(Test-Path -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Plugin\$Endpoint"){throw 'HOSTGUARD_ENDPOINT_ALREADY_EXISTS_MANUAL_RECONCILIATION_REQUIRED'}

$winrm=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
$preWinrmState=$winrm.State;$preWinrmStart=$winrm.StartMode
$activeSockets=@()
foreach($port in @(5985,5986)){$activeSockets+=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)}
if($activeSockets.Count -ne 0){throw 'WINRM_PORT_ALREADY_LISTENING_MANUAL_REVIEW'}
$fwProfiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
if(@($fwProfiles|Where-Object{(-not [bool]$_.Enabled)-or([string]$_.DefaultInboundAction -ne 'Block')}).Count -ne 0){throw 'FIREWALL_DEFAULT_INBOUND_NOT_BLOCKED'}
if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_PORT_INBOUND_RULE_PRESENT_MANUAL_REVIEW'}

$listenerMode='NONE'
$old=@()
if(Test-Path $listenerReg){$old=@(Get-ChildItem -LiteralPath $listenerReg -ErrorAction Stop)}
if($old.Count -eq 0){
  $listenerMode='NONE'
}elseif($old.Count -eq 1 -and $old[0].PSChildName -eq '*+HTTP'){
  $lp=Get-ItemProperty -LiteralPath $old[0].PSPath -ErrorAction Stop
  if([int]$lp.Port -ne 5985 -or [string]$lp.uriprefix -ne 'wsman'){throw 'EXISTING_WINRM_LISTENER_SHAPE_UNEXPECTED'}
  if($preWinrmState -ne 'Stopped' -or $preWinrmStart -ne 'Manual'){throw 'EXISTING_WINRM_LISTENER_NOT_DORMANT'}
  $listenerMode='DORMANT_DEFAULT_WILDCARD'
}else{
  throw 'EXISTING_WINRM_LISTENER_REQUIRES_MANUAL_REVIEW'
}

$stage=Join-Path $env:TEMP ('ptysd-hostguard-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'RoleCapabilities')|Out-Null
$files=@{
  'host/v45/PTYSD.HostGuard/PTYSD.HostGuard.psm1'=(Join-Path $stage 'PTYSD.HostGuard.psm1')
  'host/v45/PTYSD.HostGuard/PTYSD.HostGuard.psd1'=(Join-Path $stage 'PTYSD.HostGuard.psd1')
  'host/v45/PTYSD.HostGuard/RoleCapabilities/PTYSDHostGuard.psrc'=(Join-Path $stage 'RoleCapabilities\PTYSDHostGuard.psrc')
}
foreach($path in $files.Keys){Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/$path" -OutFile $files[$path]}
Test-ModuleManifest -Path (Join-Path $stage 'PTYSD.HostGuard.psd1') -ErrorAction Stop|Out-Null
$role=Import-PowerShellDataFile -Path (Join-Path $stage 'RoleCapabilities\PTYSDHostGuard.psrc')
$expectedFns=@('Get-PTYSDHostGuardStatus','Invoke-PTYSDHostPrepare','Start-PTYSDWorkerVm')
if(@($role.VisibleFunctions).Count -ne 3 -or @($role.VisibleFunctions|Where-Object{$_ -notin $expectedFns}).Count -ne 0){throw 'ROLE_CAPABILITY_FUNCTION_SET_INVALID'}

$rootCreated=$false;$groupCreated=$false;$moduleCopied=$false;$listenerCreated=$false;$wildcardRemoved=$false;$endpointCreated=$false
try{
  New-Item -ItemType Directory -Force -Path $Root,$ReceiptRoot,$TranscriptRoot,$ConfigRoot|Out-Null;$rootCreated=$true
  $prestate=[ordered]@{CapturedUtc=(Get-Date).ToUniversalTime().ToString('o');WinRMState=$preWinrmState;WinRMStartMode=$preWinrmStart;ListenerMode=$listenerMode;FirewallProfiles=@($fwProfiles|Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction);EnabledInboundWinRmPortRules=0;ListeningSockets=0}
  $prestate|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $ConfigRoot 'preinstall-winrm-prestate.json') -Encoding UTF8
  if($listenerMode -eq 'DORMANT_DEFAULT_WILDCARD'){
    & "$env:SystemRoot\System32\reg.exe" export 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Listener' (Join-Path $ConfigRoot 'preinstall-winrm-listener.reg') /y|Out-Null
    if($LASTEXITCODE -ne 0){throw "WINRM_LISTENER_BACKUP_FAILED exit=$LASTEXITCODE"}
  }

  $hg=New-LocalGroup -Name $ReceiptGroup -Description 'PTYSD VNEXT4.5 HostGuard receipt writers' -ErrorAction Stop;$groupCreated=$true
  $admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544');$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  foreach($dir in @($ReceiptRoot,$TranscriptRoot)){
    $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($admins)
    foreach($pair in @(@($admins,'FullControl'),@($system,'FullControl'),@($hg.SID,'Modify'))){$rule=New-Object Security.AccessControl.FileSystemAccessRule($pair[0],$pair[1],'ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)|Out-Null}
    Set-Acl -LiteralPath $dir -AclObject $acl
  }
  New-Item -ItemType Directory -Force -Path $ModuleTarget|Out-Null;Copy-Item -Path (Join-Path $stage '*') -Destination $ModuleTarget -Recurse -Force;$moduleCopied=$true

  Set-Service WinRM -StartupType Automatic;Start-Service WinRM
  $listener=New-Item -Path WSMan:\localhost\Listener -Transport HTTP -Address 'IP:127.0.0.1' -ErrorAction Stop;$listenerCreated=$true
  if($listenerMode -eq 'DORMANT_DEFAULT_WILDCARD'){
    Remove-WSManInstance -ResourceURI 'winrm/config/listener' -SelectorSet @{Address='*';Transport='HTTP'} -ErrorAction Stop
    $wildcardRemoved=$true
  }
  $live=@(Get-ChildItem WSMan:\localhost\Listener -ErrorAction Stop)
  if($live.Count -ne 1 -or -not($live[0].Keys -contains 'Address=IP:127.0.0.1') -or -not($live[0].Keys -contains 'Transport=HTTP')){throw 'LOOPBACK_ONLY_LISTENER_VALIDATION_FAILED'}
  if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'WINRM_FIREWALL_RULE_APPEARED_UNEXPECTEDLY'}

  $hyperv=(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-578')).Translate([Security.Principal.NTAccount]).Value
  $networkService=(New-Object Security.Principal.SecurityIdentifier('S-1-5-20')).Translate([Security.Principal.NTAccount]).Value
  $pssc=Join-Path $ConfigRoot 'PTYSD.HostGuard.V45.pssc'
  $roles=@{$networkService=@{RoleCapabilities='PTYSDHostGuard'}}
  New-PSSessionConfigurationFile -Path $pssc -SessionType RestrictedRemoteServer -LanguageMode NoLanguage -ExecutionPolicy Bypass -RunAsVirtualAccount -RunAsVirtualAccountGroups @($hyperv,$ReceiptGroup) -TranscriptDirectory $TranscriptRoot -RoleDefinitions $roles
  if(-not(Test-PSSessionConfigurationFile -Path $pssc)){throw 'PSSC_VALIDATION_FAILED'}
  $sddl='O:NSG:BAD:P(A;;GA;;;NS)(A;;GA;;;BA)S:P'
  Register-PSSessionConfiguration -Name $Endpoint -Path $pssc -AccessMode Local -SecurityDescriptorSddl $sddl -Force -NoServiceRestart|Out-Null;$endpointCreated=$true
  Restart-Service WinRM -Force
  $cfg=Get-PSSessionConfiguration -Name $Endpoint -ErrorAction Stop
  $live=@(Get-ChildItem WSMan:\localhost\Listener -ErrorAction Stop)
  if($live.Count -ne 1 -or -not($live[0].Keys -contains 'Address=IP:127.0.0.1')){throw 'FINAL_LISTENER_VALIDATION_FAILED'}
  if((Get-EnabledWinRmPortRules).Count -ne 0){throw 'FINAL_WINRM_FIREWALL_RULE_UNEXPECTED'}
  [pscustomobject]@{Result='HOSTGUARD_JEA_INSTALLED';Endpoint=$Endpoint;AccessMode=$cfg.Permission;SourceCommit=$SourceCommit;Host=$env:COMPUTERNAME;VmName=$vm.Name;VmId=$vm.Id.ToString();WinRM=(Get-Service WinRM).Status.ToString();Listener='IP:127.0.0.1+HTTP';PreexistingListenerReconciled=$listenerMode;PublicFirewallMutation=$false;RunnerPrivilegeElevation=$false}|ConvertTo-Json -Depth 4
}catch{
  $err=$_.Exception.Message;$rollbackErrors=@()
  if($endpointCreated){try{Unregister-PSSessionConfiguration -Name $Endpoint -Force -NoServiceRestart -ErrorAction Stop}catch{$rollbackErrors+="endpoint:$($_.Exception.Message)"}}
  if($listenerCreated){try{Remove-WSManInstance -ResourceURI 'winrm/config/listener' -SelectorSet @{Address='IP:127.0.0.1';Transport='HTTP'} -ErrorAction Stop}catch{$rollbackErrors+="loopback:$($_.Exception.Message)"}}
  if($wildcardRemoved){try{New-Item -Path WSMan:\localhost\Listener -Transport HTTP -Address $preListenerAddress -Force -ErrorAction Stop|Out-Null}catch{$rollbackErrors+="wildcard:$($_.Exception.Message)"}}
  if($moduleCopied -and (Test-Path $ModuleTarget)){try{Remove-Item -LiteralPath $ModuleTarget -Recurse -Force -ErrorAction Stop}catch{$rollbackErrors+="module:$($_.Exception.Message)"}}
  if($groupCreated){try{Remove-LocalGroup -Name $ReceiptGroup -ErrorAction Stop}catch{$rollbackErrors+="group:$($_.Exception.Message)"}}
  if($rootCreated -and (Test-Path $Root)){try{Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction Stop}catch{$rollbackErrors+="root:$($_.Exception.Message)"}}
  try{if($preWinrmState -eq 'Stopped'){Stop-Service WinRM -Force -ErrorAction Stop};if($preWinrmStart -eq 'Manual'){Set-Service WinRM -StartupType Manual -ErrorAction Stop}}catch{$rollbackErrors+="winrm:$($_.Exception.Message)"}
  if($rollbackErrors.Count -gt 0){throw ("INSTALL_FAILED=$err;ROLLBACK_ERRORS="+($rollbackErrors -join '|'))}
  throw $err
}finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
