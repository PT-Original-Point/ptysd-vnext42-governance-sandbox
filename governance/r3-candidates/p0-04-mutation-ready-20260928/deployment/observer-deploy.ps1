Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='C:\ProgramData\PTYSD\MCP'
$install=Join-Path $root 'FactoryMCP'
$brokerTask='PTYSD-FactoryMCP-HostGuard-Broker-V47'
$tunnelTask='PTYSD-FactoryMCP-Tunnel-V47'
$health=Join-Path $install 'state\broker-health.json'
$tunnelHealthUrlFile=Join-Path $root 'state\tunnel-health-url.txt'
$sourceCommit='7104a1a5b460b4e90ad6029464f9b1a79291906a'
$rawRoot='https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox'
$operationId='GOV-R3-P0-04-OBSERVER-INSTALL-001'
$stage=Join-Path $root ('staging\'+$operationId)
$backup=Join-Path $root ('backup\'+$operationId)
$claimDir=Join-Path $root 'state\operation-claims'
$claim=Join-Path $claimDir ($operationId+'.json')
$targets=@(
 @{src='governance/r3-candidates/p0-04-mutation-ready-20260928/runtime/broker/hostguard-broker.ps1';dst='broker\hostguard-broker.ps1';oid='f73c5e1b5aab23ad3e0de410c1956b683fc76781'},
 @{src='governance/r3-candidates/p0-04-mutation-ready-20260928/runtime/src/index.mjs';dst='src\index.mjs';oid='e64e859deb07eba696d94bb9ebaede645b88290d'},
 @{src='governance/r3-candidates/p0-04-mutation-ready-20260928/runtime/src/orphan-status.mjs';dst='src\orphan-status.mjs';oid='1e1067bf6617bf4a94018460bc916d7862c430fc'},
 @{src='governance/r3-candidates/p0-04-mutation-ready-20260928/runtime/config/system-capability.json';dst='config\system-capability.json';oid='2c6f052721b1308b70d82990bbeb80d1d6e6adad'}
)
function GitBlobOid([string]$Path){
 $b=[IO.File]::ReadAllBytes($Path);$p=[Text.Encoding]::ASCII.GetBytes(('blob '+$b.Length+"`0"));$all=New-Object byte[] ($p.Length+$b.Length);[Array]::Copy($p,0,$all,0,$p.Length);[Array]::Copy($b,0,$all,$p.Length,$b.Length);$h=[Security.Cryptography.SHA1]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($all)).Replace('-','').ToLowerInvariant())}finally{$h.Dispose()}
}
function Wait-TaskRunning([string]$Name,[int]$Seconds){$d=[DateTime]::UtcNow.AddSeconds($Seconds);do{try{$s=(Get-ScheduledTask -TaskName $Name).State.ToString()}catch{$s='MISSING'};if($s -eq 'Running'){return};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $d);throw ('TASK_NOT_RUNNING:'+ $Name)}
function Wait-Broker([int]$Seconds){$d=[DateTime]::UtcNow.AddSeconds($Seconds);do{if(Test-Path -LiteralPath $health){try{$o=Get-Content -LiteralPath $health -Raw|ConvertFrom-Json -ErrorAction Stop;if($o.status -eq 'READY' -and $o.run_as -eq 'NT AUTHORITY\SYSTEM'){return}}catch{}};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $d);throw 'BROKER_NOT_READY'}
function Wait-Tunnel([int]$Seconds){$d=[DateTime]::UtcNow.AddSeconds($Seconds);do{if((Get-ScheduledTask -TaskName $tunnelTask).State.ToString() -eq 'Running' -and (Test-Path -LiteralPath $tunnelHealthUrlFile)){try{$u=(Get-Content -LiteralPath $tunnelHealthUrlFile -Raw).Trim().TrimEnd('/');if($u -match '^http://127\.0\.0\.1:\d{1,5}$'){if((Invoke-WebRequest -UseBasicParsing -Uri ($u+'/readyz') -TimeoutSec 2).StatusCode -eq 200){return}}}catch{}};Start-Sleep -Milliseconds 500}while([DateTime]::UtcNow -lt $d);throw 'TUNNEL_NOT_READY'}
if([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne 'NT AUTHORITY\SYSTEM'){throw 'SYSTEM_REQUIRED'}
if(-not(Test-Path -LiteralPath $install)){throw 'INSTALL_ROOT_MISSING'}
foreach($n in @($brokerTask,$tunnelTask)){if(-not(Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue)){throw ('TASK_MISSING:'+$n)}}
New-Item -ItemType Directory -Force -Path $claimDir,$stage,$backup|Out-Null
$fs=$null
try{$fs=[IO.File]::Open($claim,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$bytes=[Text.Encoding]::UTF8.GetBytes(('{"operation_id":"'+$operationId+'","state":"CLAIMED","source_commit":"'+$sourceCommit+'"}'));$fs.Write($bytes,0,$bytes.Length)}catch{throw 'OPERATION_ALREADY_CLAIMED'}finally{if($fs){$fs.Dispose()}}
$pre=@{}
try{
 foreach($t in $targets){$sp=Join-Path $stage $t.dst;New-Item -ItemType Directory -Force -Path (Split-Path $sp -Parent)|Out-Null;Invoke-WebRequest -UseBasicParsing -Uri ($rawRoot+'/'+$sourceCommit+'/'+$t.src) -OutFile $sp -TimeoutSec 20;if((GitBlobOid $sp) -ne $t.oid){throw ('SOURCE_OID_MISMATCH:'+$t.dst)};$dp=Join-Path $install $t.dst;if(-not(Test-Path -LiteralPath $dp)){throw ('TARGET_MISSING:'+$t.dst)};$pre[$t.dst]=GitBlobOid $dp;$bp=Join-Path $backup $t.dst;New-Item -ItemType Directory -Force -Path (Split-Path $bp -Parent)|Out-Null;Copy-Item -LiteralPath $dp -Destination $bp -Force}
 Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue;Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue;Start-Sleep -Seconds 1
 foreach($t in $targets){$sp=Join-Path $stage $t.dst;$dp=Join-Path $install $t.dst;$tmp=$dp+'.tmp.'+[Guid]::NewGuid().ToString('N');Copy-Item -LiteralPath $sp -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $dp -Force;if((GitBlobOid $dp) -ne $t.oid){throw ('POSTWRITE_OID_MISMATCH:'+$t.dst)}}
 Remove-Item -LiteralPath $health -Force -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $tunnelHealthUrlFile -Force -ErrorAction SilentlyContinue;Start-ScheduledTask -TaskName $brokerTask;Wait-Broker 30;Start-ScheduledTask -TaskName $tunnelTask;Wait-Tunnel 90
 $out=[ordered]@{result='PASS';operation_id=$operationId;source_commit=$sourceCommit;broker_task=$brokerTask;tunnel_task=$tunnelTask;prestate=$pre;installed=@{}};foreach($t in $targets){$out.installed[$t.dst]=GitBlobOid (Join-Path $install $t.dst)};[IO.File]::WriteAllText($claim,($out|ConvertTo-Json -Depth 8 -Compress),(New-Object Text.UTF8Encoding($false)));$out|ConvertTo-Json -Depth 8 -Compress
}catch{
 $err=[string]$_.Exception.Message;Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue;Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue;$rb='ROLLED_BACK';try{foreach($t in $targets){$bp=Join-Path $backup $t.dst;$dp=Join-Path $install $t.dst;if(Test-Path -LiteralPath $bp){Copy-Item -LiteralPath $bp -Destination $dp -Force}};Remove-Item -LiteralPath $health -Force -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $tunnelHealthUrlFile -Force -ErrorAction SilentlyContinue;Start-ScheduledTask -TaskName $brokerTask;Wait-Broker 30;Start-ScheduledTask -TaskName $tunnelTask;Wait-Tunnel 90}catch{$rb='ROLLBACK_UNVERIFIED'};$f=[ordered]@{result='FAILED';operation_id=$operationId;error=$err;rollback=$rb};try{[IO.File]::WriteAllText($claim,($f|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))}catch{};throw
}finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
