$ErrorActionPreference = 'Stop'

$result = [ordered]@{
  schema = 'v45.z4.host_qualification.v1'
  executor = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  machine = $env:COMPUTERNAME
  vm_name = 'PTYSD-WORKER-01'
  vm_found = $false
  vm_state = $null
  vm_id = $null
  hyperv_read_ok = $false
  hyperv_error = $null
  ssh_target = '172.31.253.10:22'
  ssh22_reachable = $false
  fixed_control_services = @()
}

try {
  Import-Module Hyper-V -ErrorAction Stop
  $vm = Get-VM -Name 'PTYSD-WORKER-01' -ErrorAction Stop
  $result.hyperv_read_ok = $true
  $result.vm_found = $true
  $result.vm_state = $vm.State.ToString()
  $result.vm_id = $vm.Id.ToString()
} catch {
  $result.hyperv_error = $_.Exception.Message
}

try {
  $tcp = Test-NetConnection -ComputerName '172.31.253.10' -Port 22 -WarningAction SilentlyContinue
  $result.ssh22_reachable = [bool]$tcp.TcpTestSucceeded
} catch {
  $result.ssh22_reachable = $false
}

$result.fixed_control_services = @(
  Get-Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'hostguard|workerctl|ptysd' -or $_.DisplayName -match 'hostguard|workerctl|ptysd' } |
    Select-Object Name, DisplayName, Status, StartType
)

$result | ConvertTo-Json -Compress -Depth 5
