Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ExpectedHost = 'DESKTOP-1B6PD2P'
$script:ExpectedVmName = 'PTYSD-WORKER-01'
$script:ExpectedVmId = [Guid]'881f7819-baa9-4a4e-8cca-8f6f18fb89a9'
$script:GuestIp = '172.31.253.10'
$script:ReceiptRoot = 'C:\ProgramData\PTYSD\HostGuard\receipts'

function Get-PTYSDHostBootIdentity {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  '{0}|{1:o}' -f $env:COMPUTERNAME,$os.LastBootUpTime.ToUniversalTime()
}
function Assert-PTYSDHostIdentity {
  if ($env:COMPUTERNAME -ne $script:ExpectedHost) { throw "HOST_ID_MISMATCH expected=$($script:ExpectedHost) actual=$($env:COMPUTERNAME)" }
}
function Get-PTYSDExactVm {
  Assert-PTYSDHostIdentity
  $vm = Get-VM -Name $script:ExpectedVmName -ErrorAction Stop
  if ($vm.Id -ne $script:ExpectedVmId) { throw "VM_ID_MISMATCH expected=$($script:ExpectedVmId) actual=$($vm.Id)" }
  $vm
}
function Write-PTYSDHostReceipt {
  param([string]$Operation,[string]$Result,[string]$RunId,[string]$TaskId,[string]$AttemptId,[int]$AttemptEpoch,$Vm)
  foreach($v in @($RunId,$TaskId,$AttemptId)){ if($v -notmatch '^[A-Z0-9][A-Z0-9._-]{0,79}$'){ throw 'RECEIPT_ID_INVALID' } }
  if($AttemptEpoch -lt 0){ throw 'ATTEMPT_EPOCH_INVALID' }
  if(-not(Test-Path -LiteralPath $script:ReceiptRoot)){ throw 'HOSTGUARD_RECEIPT_ROOT_MISSING' }
  $r=[ordered]@{schema='v45.hostguard.receipt.v1';operation=$Operation;result=$Result;run_id=$RunId;task_id=$TaskId;attempt_id=$AttemptId;attempt_epoch=$AttemptEpoch;host=$env:COMPUTERNAME;boot_identity=Get-PTYSDHostBootIdentity;vm_name=$Vm.Name;vm_id=$Vm.Id.ToString();vm_state=$Vm.State.ToString();run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name;recorded_at_utc=[DateTime]::UtcNow.ToString('o')}
  $final=Join-Path $script:ReceiptRoot (('{0}-{1}-{2}-{3}-{4}.json' -f $RunId,$TaskId,$AttemptId,$AttemptEpoch,$Operation))
  $tmp=$final+'.tmp.'+[Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp,($r|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $final -Force
  [pscustomobject]$r
}
function Get-PTYSDHostGuardStatus {
  [CmdletBinding()]param()
  $vm=Get-PTYSDExactVm;$tcp=$false
  try{$tcp=[bool](Test-NetConnection -ComputerName $script:GuestIp -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue)}catch{}
  [pscustomobject]@{schema='v45.hostguard.status.v1';host=$env:COMPUTERNAME;boot_identity=Get-PTYSDHostBootIdentity;vm_name=$vm.Name;vm_id=$vm.Id.ToString();vm_state=$vm.State.ToString();guest_ip=$script:GuestIp;ssh22_reachable=$tcp;run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name}
}
function Invoke-PTYSDHostPrepare {
  [CmdletBinding()]param([Parameter(Mandatory)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$RunId,[Parameter(Mandatory)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$TaskId,[Parameter(Mandatory)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$AttemptId,[Parameter(Mandatory)][ValidateRange(0,2147483647)][int]$AttemptEpoch)
  $vm=Get-PTYSDExactVm
  Write-PTYSDHostReceipt -Operation prepare -Result VERIFIED -RunId $RunId -TaskId $TaskId -AttemptId $AttemptId -AttemptEpoch $AttemptEpoch -Vm $vm
}
function Start-PTYSDWorkerVm {
  [CmdletBinding()]param([Parameter(Mandatory)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$RunId,[Parameter(Mandatory)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$TaskId,[Parameter(Mandatory)][ValidatePattern('^[A-Z0-9][A-Z0-9._-]{0,79}$')][string]$AttemptId,[Parameter(Mandatory)][ValidateRange(0,2147483647)][int]$AttemptEpoch)
  $vm=Get-PTYSDExactVm
  if($vm.State -eq 'Running'){ return Write-PTYSDHostReceipt -Operation start -Result ALREADY_RUNNING -RunId $RunId -TaskId $TaskId -AttemptId $AttemptId -AttemptEpoch $AttemptEpoch -Vm $vm }
  if($vm.State -ne 'Off'){ throw "VM_STATE_NOT_STARTABLE state=$($vm.State)" }
  Start-VM -VM $vm -ErrorAction Stop|Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  do{Start-Sleep -Milliseconds 500;$vm=Get-PTYSDExactVm;if($vm.State -eq 'Running'){break}}while([DateTime]::UtcNow -lt $deadline)
  if($vm.State -ne 'Running'){throw "VM_START_READBACK_FAILED state=$($vm.State)"}
  Write-PTYSDHostReceipt -Operation start -Result STARTED -RunId $RunId -TaskId $TaskId -AttemptId $AttemptId -AttemptEpoch $AttemptEpoch -Vm $vm
}
Export-ModuleMember -Function Get-PTYSDHostGuardStatus,Invoke-PTYSDHostPrepare,Start-PTYSDWorkerVm
