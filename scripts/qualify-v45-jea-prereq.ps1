$ErrorActionPreference = 'Stop'

function Exists-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$hypervSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-578')
$networkServiceSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-20')

$result = [ordered]@{
  schema = 'v45.z4.jea_prereq.v1'
  executor = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  executor_sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  machine = $env:COMPUTERNAME
  powershell_version = $PSVersionTable.PSVersion.ToString()
  powershell_edition = $PSVersionTable.PSEdition
  winrm_service_status = $null
  winrm_service_start_type = $null
  wsman_localhost_reachable = $false
  jea_cmdlets = [ordered]@{
    register_pssessionconfiguration = (Exists-Command 'Register-PSSessionConfiguration')
    new_psrolecapabilityfile = (Exists-Command 'New-PSRoleCapabilityFile')
    new_pssessionconfigurationfile = (Exists-Command 'New-PSSessionConfigurationFile')
    test_pssessionconfigurationfile = (Exists-Command 'Test-PSSessionConfigurationFile')
  }
  hyperv_administrators_sid = $hypervSid.Value
  hyperv_administrators_name = $null
  network_service_sid = $networkServiceSid.Value
  network_service_name = $null
  openssh_client = $null
  hostguard_endpoint_present = $false
}

try {
  $svc = Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
  $result.winrm_service_status = $svc.State
  $result.winrm_service_start_type = $svc.StartMode
} catch {
  $result.winrm_service_status = 'QUERY_FAILED'
}

try { $result.wsman_localhost_reachable = [bool](Test-WSMan localhost -ErrorAction Stop) } catch { $result.wsman_localhost_reachable = $false }
try { $result.hyperv_administrators_name = $hypervSid.Translate([System.Security.Principal.NTAccount]).Value } catch { $result.hyperv_administrators_name = 'UNRESOLVED' }
try { $result.network_service_name = $networkServiceSid.Translate([System.Security.Principal.NTAccount]).Value } catch { $result.network_service_name = 'UNRESOLVED' }

$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if ($ssh) { $result.openssh_client = $ssh.Source }

try {
  $cfg = Get-PSSessionConfiguration -Name 'PTYSD.HostGuard.V45' -ErrorAction Stop
  if ($cfg) { $result.hostguard_endpoint_present = $true }
} catch {
  $result.hostguard_endpoint_present = $false
}

$result | ConvertTo-Json -Compress -Depth 5
