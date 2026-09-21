[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceRef,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._-]{1,120}$')][string]$SelfTaskName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourceRef = $SourceRef.ToLowerInvariant()
$repoRaw = 'https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox'
$relativeRoot = 'tools/csg/factory-mcp'
$base = 'C:\ProgramData\PTYSD\MCP'
$install = Join-Path $base 'FactoryMCP'
$brokerTask = 'PTYSD-FactoryMCP-HostGuard-Broker-V47'
$tunnelTask = 'PTYSD-FactoryMCP-Tunnel-V47'
$health = Join-Path $install 'state\broker-health.json'
$tunnelHealthUrlFile = Join-Path $base 'state\tunnel-health-url.txt'
$resultPath = Join-Path $base 'qualification\factory-mcp-p4-current-fence-deploy.json'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$staging = Join-Path $base ('staging\factory-mcp-p4-' + $stamp)
$backup = Join-Path $base ('backup\factory-mcp-p4-' + $stamp)
$git = 'C:\Program Files\Git\cmd\git.exe'
$node = 'C:\Program Files\nodejs\node.exe'
$targets = [ordered]@{
  'src/index.mjs' = '04af14b745650755d551ec268d864e6acea08cb7'
  'src/current-execution-fence.mjs' = 'cdece384b22b1555870204213d5630f29d536fe1'
  'src/invoke-hostguard.ps1' = '1c70aaed4b10c32ed703388488fb69287b730996'
  'broker/hostguard-broker.ps1' = 'cfd23344b2c7b4073a9e6cac1e50a1cdcbcc0e47'
  'broker/current-execution-fence.ps1' = '899f0a398b6f15da1ad176d943187ca78478b4e0'
  'config/system-capability.json' = '6cbc824c700c87c66d2be628f0d304d1f2cd8f8f'
  'tests/protocol-smoke.mjs' = '2bbc52ff29e248c75a0b4014bed40b2146c7123a'
  'tests/control-lane-source-regression.mjs' = 'c6723a1139774e5b8730b457e19c1e4faba1d72f'
}

function Write-AtomicJson([string]$Path,$Value) {
  $tmp = $Path + '.tmp.' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp,($Value|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Get-BlobSha([string]$Path) {
  $sha = (& $git hash-object -- $Path 2>$null | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw 'GIT_HASH_OBJECT_FAILED' }
  return $sha
}
function Parse-PowerShell([string]$Path) {
  $tokens=$null;$errors=$null
  [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)|Out-Null
  if($errors.Count){throw ('POWERSHELL_PARSE_FAILED:' + (($errors|ForEach-Object{$_.Message}) -join ';'))}
}
function Wait-TaskNotRunning([string]$Name,[int]$Seconds) {
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  do{$state=(Get-ScheduledTask -TaskName $Name).State.ToString();if($state-ne'Running'){return};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow-lt$deadline)
  throw ('TASK_STOP_TIMEOUT:'+$Name)
}
function Wait-BrokerReady([int]$Seconds) {
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  do{
    if(Test-Path $health){
      try{$h=Get-Content $health -Raw|ConvertFrom-Json;if($h.status-eq'READY'-and$h.run_as-eq'NT AUTHORITY\SYSTEM'){return $h}}catch{}
    }
    Start-Sleep -Milliseconds 250
  }while([DateTime]::UtcNow-lt$deadline)
  throw 'BROKER_READY_TIMEOUT'
}
function Wait-TunnelReady([int]$Seconds) {
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  do{
    $taskState=(Get-ScheduledTask -TaskName $tunnelTask).State.ToString()
    $url=$null
    if(Test-Path $tunnelHealthUrlFile){try{$candidate=(Get-Content $tunnelHealthUrlFile -Raw).Trim().TrimEnd('/');if($candidate-match'^http://127\.0\.0\.1:\d{1,5}$'){$url=$candidate}}catch{}}
    if($taskState-eq'Running'-and$url){
      try{$live=Invoke-WebRequest -UseBasicParsing -Uri ($url+'/healthz') -TimeoutSec 2;$ready=Invoke-WebRequest -UseBasicParsing -Uri ($url+'/readyz') -TimeoutSec 2;if($live.StatusCode-eq200-and$ready.StatusCode-eq200){return [ordered]@{task_state=$taskState;live=$true;ready=$true;url=$url}}}catch{}
    }
    Start-Sleep -Milliseconds 500
  }while([DateTime]::UtcNow-lt$deadline)
  throw 'TUNNEL_READY_TIMEOUT'
}
function Restore-Backup($Absent) {
  foreach($rel in $targets.Keys){
    $src=Join-Path $backup $rel;$dst=Join-Path $install $rel
    if(Test-Path $src){New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force|Out-Null;Copy-Item $src $dst -Force}
    elseif($Absent -contains $rel){Remove-Item $dst -Force -ErrorAction SilentlyContinue}
  }
}

New-Item -ItemType Directory -Path $staging,$backup,(Split-Path $resultPath -Parent) -Force|Out-Null
$absent=@()
$deployed=$false
Start-Sleep -Seconds 5
try {
  foreach($rel in $targets.Keys){
    $dst=Join-Path $staging $rel
    New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force|Out-Null
    $uri=$repoRaw+'/'+$sourceRef+'/'+$relativeRoot+'/'+$rel
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $dst -Headers @{'Cache-Control'='no-cache'} -TimeoutSec 15
    if((Get-BlobSha $dst)-ne[string]$targets[$rel]){throw ('STAGING_BLOB_MISMATCH:'+$rel)}
  }
  foreach($rel in @('src/invoke-hostguard.ps1','broker/hostguard-broker.ps1','broker/current-execution-fence.ps1')){Parse-PowerShell (Join-Path $staging $rel)}
  foreach($rel in @('src/index.mjs','src/current-execution-fence.mjs','tests/protocol-smoke.mjs','tests/control-lane-source-regression.mjs')){& $node --check (Join-Path $staging $rel);if($LASTEXITCODE-ne0){throw ('NODE_CHECK_FAILED:'+$rel)}}
  foreach($rel in $targets.Keys){
    $src=Join-Path $install $rel
    if(Test-Path $src){$dst=Join-Path $backup $rel;New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force|Out-Null;Copy-Item $src $dst -Force}else{$absent+=$rel}
  }
  Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue
  Wait-TaskNotRunning $tunnelTask 15;Wait-TaskNotRunning $brokerTask 15
  foreach($rel in $targets.Keys){$src=Join-Path $staging $rel;$dst=Join-Path $install $rel;New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force|Out-Null;Copy-Item $src $dst -Force}
  foreach($rel in $targets.Keys){if((Get-BlobSha (Join-Path $install $rel))-ne[string]$targets[$rel]){throw ('INSTALLED_BLOB_MISMATCH:'+$rel)}}
  Remove-Item $health -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $brokerTask
  $broker=Wait-BrokerReady 30
  Remove-Item $tunnelHealthUrlFile -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $tunnelTask
  $tunnel=Wait-TunnelReady 120
  $deployed=$true
  $installed=[ordered]@{}
  foreach($rel in $targets.Keys){$installed[$rel]=Get-BlobSha (Join-Path $install $rel)}
  Write-AtomicJson $resultPath ([ordered]@{schema='v49.factory-mcp.p4-deploy.v1';result='PASS';source_ref=$sourceRef;host=$env:COMPUTERNAME;run_as=[Security.Principal.WindowsIdentity]::GetCurrent().Name;installed=$installed;backup=$backup;broker_pid=$broker.pid;tunnel=$tunnel;recorded_at_utc=[DateTime]::UtcNow.ToString('o')})
} catch {
  $err=[string]$_.Exception.Message
  Stop-ScheduledTask -TaskName $tunnelTask -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $brokerTask -ErrorAction SilentlyContinue
  try{Restore-Backup $absent;Remove-Item $health -Force -ErrorAction SilentlyContinue;Start-ScheduledTask $brokerTask;[void](Wait-BrokerReady 30);Remove-Item $tunnelHealthUrlFile -Force -ErrorAction SilentlyContinue;Start-ScheduledTask $tunnelTask;[void](Wait-TunnelReady 120);$rollback='READY'}catch{$rollback='UNVERIFIED:'+[string]$_.Exception.Message}
  Write-AtomicJson $resultPath ([ordered]@{schema='v49.factory-mcp.p4-deploy.v1';result='FAILED';source_ref=$sourceRef;error=$err;rollback=$rollback;backup=$backup;recorded_at_utc=[DateTime]::UtcNow.ToString('o')})
  throw
} finally {
  try{Unregister-ScheduledTask -TaskName $SelfTaskName -Confirm:$false -ErrorAction SilentlyContinue}catch{}
  try{Start-Process -FilePath 'cmd.exe' -ArgumentList '/c',('timeout /t 5 /nobreak >nul & rmdir /s /q "'+$staging+'"') -WindowStyle Hidden}catch{}
}
