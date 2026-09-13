$ErrorActionPreference='Stop'
$ports=@('5985','5986')
$svc=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop

$profiles=@()
try {
  $profiles=@(Get-NetConnectionProfile -ErrorAction Stop | Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity,IPv6Connectivity)
} catch {
  $profiles=@([pscustomobject]@{Error=$_.Exception.Message})
}

$listeners=@()
try {
  foreach($port in $ports){
    $listeners += @(Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)
  }
} catch {
  $listeners=@([pscustomobject]@{Error=$_.Exception.Message})
}

$firewallReadable=$true
$firewallError=$null
$rules=@()
try {
  $inbound=@(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -ErrorAction Stop)
  foreach($r in $inbound){
    $pfs=@($r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)
    foreach($pf in $pfs){
      $lp=[string]$pf.LocalPort
      if($lp -in $ports){
        $sfs=@($r | Get-NetFirewallServiceFilter -ErrorAction SilentlyContinue)
        $rules += [pscustomobject]@{
          Name=$r.Name
          DisplayName=$r.DisplayName
          Action=[string]$r.Action
          Profile=[string]$r.Profile
          LocalPort=$lp
          Protocol=[string]$pf.Protocol
          Service=(@($sfs | ForEach-Object { $_.Service }) -join ',')
        }
      }
    }
  }
} catch {
  $firewallReadable=$false
  $firewallError=$_.Exception.Message
}

[pscustomobject]@{
  Probe='V45_WINRM_FIREWALL_READONLY'
  ComputerName=$env:COMPUTERNAME
  Identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  WinRM=[pscustomobject]@{State=$svc.State;StartMode=$svc.StartMode}
  NetworkProfiles=$profiles
  ListeningSockets=$listeners
  FirewallReadable=$firewallReadable
  FirewallError=$firewallError
  EnabledInboundRulesFor5985Or5986=$rules
}|ConvertTo-Json -Depth 8
