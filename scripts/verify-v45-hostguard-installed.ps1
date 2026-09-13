$ErrorActionPreference='Stop'
$ExpectedHost='DESKTOP-1B6PD2P'
$ExpectedVmName='PTYSD-WORKER-01'
$ExpectedVmId='881f7819-baa9-4a4e-8cca-8f6f18fb89a9'
$Endpoint='PTYSD.HostGuard.V45'

$caller=[Security.Principal.WindowsIdentity]::GetCurrent().Name
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}
if($caller -ne 'NT AUTHORITY\NETWORK SERVICE'){throw "RUNNER_IDENTITY_MISMATCH actual=$caller"}

$svc=Get-Service WinRM -ErrorAction Stop
if($svc.Status -ne 'Running'){throw "WINRM_NOT_RUNNING state=$($svc.Status)"}

$listen5985=@(Get-NetTCPConnection -State Listen -LocalPort 5985 -ErrorAction SilentlyContinue)
$listen5986=@(Get-NetTCPConnection -State Listen -LocalPort 5986 -ErrorAction SilentlyContinue)
if($listen5985.Count -lt 1){throw 'LOOPBACK_LISTENER_MISSING'}
if(@($listen5985|Where-Object{$_.LocalAddress -ne '127.0.0.1'}).Count -ne 0){throw ('NON_LOOPBACK_5985_LISTENER='+(@($listen5985|ForEach-Object{$_.LocalAddress}) -join ','))}
if($listen5986.Count -ne 0){throw 'UNEXPECTED_5986_LISTENER'}

$enabledRules=@()
$inbound=@(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -ErrorAction Stop)
foreach($r in $inbound){
  foreach($pf in @($r|Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)){
    if(([string]$pf.LocalPort) -in @('5985','5986')){$enabledRules+=$r}
  }
}
if($enabledRules.Count -ne 0){throw 'WINRM_INBOUND_FIREWALL_RULE_PRESENT'}

$status=Invoke-Command -ComputerName localhost -ConfigurationName $Endpoint -ScriptBlock { Get-PTYSDHostGuardStatus } -ErrorAction Stop
if($status.schema -ne 'v45.hostguard.status.v1'){throw "STATUS_SCHEMA_MISMATCH actual=$($status.schema)"}
if($status.host -ne $ExpectedHost){throw "STATUS_HOST_MISMATCH actual=$($status.host)"}
if($status.vm_name -ne $ExpectedVmName){throw "STATUS_VM_NAME_MISMATCH actual=$($status.vm_name)"}
if(([string]$status.vm_id).ToLowerInvariant() -ne $ExpectedVmId){throw "STATUS_VM_ID_MISMATCH actual=$($status.vm_id)"}

[pscustomobject]@{
  Result='HOSTGUARD_PROVIDER_READBACK_PASS'
  Caller=$caller
  Endpoint=$Endpoint
  WinRM=$svc.Status.ToString()
  Listener='127.0.0.1:5985'
  InboundFirewallRules5985Or5986=0
  Host=$status.host
  VmName=$status.vm_name
  VmId=$status.vm_id
  VmState=$status.vm_state
  GuestIp=$status.guest_ip
  Ssh22Reachable=$status.ssh22_reachable
  JeaRunAs=$status.run_as
  BootIdentity=$status.boot_identity
}|ConvertTo-Json -Depth 5
