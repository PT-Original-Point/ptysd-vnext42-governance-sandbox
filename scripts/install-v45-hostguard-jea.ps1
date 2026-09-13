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

$id=[Security.Principal.WindowsIdentity]::GetCurrent();$p=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_SHELL_REQUIRED'}
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}
Import-Module Hyper-V -ErrorAction Stop
$vm=Get-VM -Name $ExpectedVmName -ErrorAction Stop
if($vm.Id -ne $ExpectedVmId){throw "VM_ID_MISMATCH expected=$ExpectedVmId actual=$($vm.Id)"}
if(Test-Path -LiteralPath $ModuleTarget){throw 'HOSTGUARD_MODULE_ALREADY_EXISTS_MANUAL_RECONCILIATION_REQUIRED'}
if(Test-Path -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Plugin\$Endpoint"){throw 'HOSTGUARD_ENDPOINT_ALREADY_EXISTS_MANUAL_RECONCILIATION_REQUIRED'}
$listenerReg='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Listener'
if(Test-Path $listenerReg){$old=@(Get-ChildItem $listenerReg -ErrorAction Stop);if($old.Count -gt 0){throw 'EXISTING_WINRM_LISTENER_REQUIRES_MANUAL_REVIEW'}}

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

$winrm=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
$preWinrmState=$winrm.State;$preWinrmStart=$winrm.StartMode
$groupCreated=$false;$moduleCopied=$false;$listenerCreated=$false;$endpointCreated=$false
try{
  $hg=Get-LocalGroup -Name $ReceiptGroup -ErrorAction SilentlyContinue
  if($hg){if($hg.Description -ne 'PTYSD VNEXT4.5 HostGuard receipt writers'){throw 'RECEIPT_GROUP_PREEXISTS_WITH_UNEXPECTED_DESCRIPTION'}}else{New-LocalGroup -Name $ReceiptGroup -Description 'PTYSD VNEXT4.5 HostGuard receipt writers'|Out-Null;$groupCreated=$true;$hg=Get-LocalGroup -Name $ReceiptGroup}
  New-Item -ItemType Directory -Force -Path $ReceiptRoot,$TranscriptRoot,$ConfigRoot|Out-Null
  $admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544');$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  foreach($dir in @($ReceiptRoot,$TranscriptRoot)){
    $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($admins)
    foreach($pair in @(@($admins,'FullControl'),@($system,'FullControl'),@($hg.SID,'Modify'))){$rule=New-Object Security.AccessControl.FileSystemAccessRule($pair[0],$pair[1],'ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)|Out-Null}
    Set-Acl -LiteralPath $dir -AclObject $acl
  }
  New-Item -ItemType Directory -Force -Path $ModuleTarget|Out-Null;Copy-Item -LiteralPath (Join-Path $stage '*') -Destination $ModuleTarget -Recurse -Force;$moduleCopied=$true
  Set-Service WinRM -StartupType Automatic;Start-Service WinRM
  $listener=New-Item -Path WSMan:\localhost\Listener -Transport HTTP -Address 'IP:127.0.0.1' -ErrorAction Stop;$listenerCreated=$true
  $hyperv=(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-578')).Translate([Security.Principal.NTAccount]).Value
  $networkService=(New-Object Security.Principal.SecurityIdentifier('S-1-5-20')).Translate([Security.Principal.NTAccount]).Value
  $pssc=Join-Path $ConfigRoot 'PTYSD.HostGuard.V45.pssc'
  $roles=@{$networkService=@{RoleCapabilities='PTYSDHostGuard'}}
  New-PSSessionConfigurationFile -Path $pssc -SessionType RestrictedRemoteServer -LanguageMode NoLanguage -RunAsVirtualAccount -RunAsVirtualAccountGroups @($hyperv,$ReceiptGroup) -TranscriptDirectory $TranscriptRoot -RoleDefinitions $roles
  if(-not(Test-PSSessionConfigurationFile -Path $pssc)){throw 'PSSC_VALIDATION_FAILED'}
  $sddl='O:NSG:BAD:P(A;;GA;;;NS)(A;;GA;;;BA)S:P'
  Register-PSSessionConfiguration -Name $Endpoint -Path $pssc -AccessMode Local -SecurityDescriptorSddl $sddl -Force -NoServiceRestart|Out-Null;$endpointCreated=$true
  Restart-Service WinRM -Force
  $cfg=Get-PSSessionConfiguration -Name $Endpoint -ErrorAction Stop
  $ls=@(Get-ChildItem WSMan:\localhost\Listener -ErrorAction Stop)
  [pscustomobject]@{Result='HOSTGUARD_JEA_INSTALLED';Endpoint=$Endpoint;AccessMode=$cfg.Permission;SourceCommit=$SourceCommit;Host=$env:COMPUTERNAME;VmName=$vm.Name;VmId=$vm.Id.ToString();WinRM=(Get-Service WinRM).Status.ToString();ListenerCount=$ls.Count;PublicFirewallMutation=$false;RunnerPrivilegeElevation=$false}|ConvertTo-Json -Depth 4
}catch{
  $err=$_.Exception.Message
  if($endpointCreated){Unregister-PSSessionConfiguration -Name $Endpoint -Force -NoServiceRestart -ErrorAction SilentlyContinue}
  if($listenerCreated){Get-ChildItem WSMan:\localhost\Listener -ErrorAction SilentlyContinue|Where-Object{$_.Keys -contains 'Address=IP:127.0.0.1'}|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue}
  if($moduleCopied -and (Test-Path $ModuleTarget)){Remove-Item -LiteralPath $ModuleTarget -Recurse -Force -ErrorAction SilentlyContinue}
  if($groupCreated){Remove-LocalGroup -Name $ReceiptGroup -ErrorAction SilentlyContinue}
  if($preWinrmState -eq 'Stopped'){Stop-Service WinRM -Force -ErrorAction SilentlyContinue}
  if($preWinrmStart -eq 'Manual'){Set-Service WinRM -StartupType Manual -ErrorAction SilentlyContinue}
  throw $err
}finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
