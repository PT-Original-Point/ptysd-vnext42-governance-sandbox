$ErrorActionPreference='Stop'
$listenerReg='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Listener'
$pluginReg='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Plugin'
$svc=Get-CimInstance Win32_Service -Filter "Name='WinRM'" -ErrorAction Stop
$listeners=@()
if(Test-Path -LiteralPath $listenerReg){
  foreach($k in @(Get-ChildItem -LiteralPath $listenerReg -ErrorAction Stop)){
    $p=Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction Stop
    $vals=[ordered]@{}
    foreach($prop in $p.PSObject.Properties){
      if($prop.Name -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$'){$vals[$prop.Name]=$prop.Value}
    }
    $listeners += [pscustomobject]@{key=$k.PSChildName;values=$vals}
  }
}
$ports=@()
try{
  $ports=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -in 5985,5986} | ForEach-Object {[pscustomobject]@{local_address=$_.LocalAddress;local_port=$_.LocalPort;owning_process=$_.OwningProcess}})
}catch{
  $ports=@([pscustomobject]@{probe_error=$_.Exception.Message})
}
$plugins=@()
if(Test-Path -LiteralPath $pluginReg){$plugins=@(Get-ChildItem -LiteralPath $pluginReg -ErrorAction Stop | Select-Object -ExpandProperty PSChildName)}
$result=[ordered]@{
  schema='v45.z4.winrm_listener_reconcile.v1'
  executor=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  machine=$env:COMPUTERNAME
  winrm_service_status=$svc.State
  winrm_service_start_mode=$svc.StartMode
  listener_count=$listeners.Count
  listeners=$listeners
  listening_ports_5985_5986=$ports
  hostguard_plugin_registry_present=($plugins -contains 'PTYSD.HostGuard.V45')
  plugin_names=$plugins
  mutation_performed=$false
}
$result|ConvertTo-Json -Depth 8 -Compress
