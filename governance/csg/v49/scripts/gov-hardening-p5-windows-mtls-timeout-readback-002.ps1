Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$requestId = '280c25cc2543451b9ef1487667b5d443'
$factoryRoot = 'C:\ProgramData\PTYSD\MCP\FactoryMCP'
$receiptPath = Join-Path $factoryRoot ('state\exec-receipts\' + $requestId + '.json')
$outboxPath = Join-Path $factoryRoot ('queue\outbox\' + $requestId + '.json')
$sinceUtc = [DateTime]::Parse('2026-09-22T00:35:00Z').ToUniversalTime()

function Get-SafeProp {
  param($Object,[string]$Name)
  if ($null -eq $Object) { return $null }
  if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
  return $null
}
function Get-Sha256Text {
  param([AllowEmptyString()][string]$Text)
  if ($null -eq $Text) { $Text = '' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

$receipt = $null
if (Test-Path -LiteralPath $receiptPath) {
  try { $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json -ErrorAction Stop } catch {}
}
$receiptSafe = [ordered]@{
  present = [bool](Test-Path -LiteralPath $receiptPath)
  schema = Get-SafeProp $receipt 'schema'
  request_id = Get-SafeProp $receipt 'request_id'
  state = Get-SafeProp $receipt 'state'
  project_id = Get-SafeProp $receipt 'project_id'
  operation_id = Get-SafeProp $receipt 'operation_id'
  run_id = Get-SafeProp $receipt 'run_id'
  task_id = Get-SafeProp $receipt 'task_id'
  attempt_id = Get-SafeProp $receipt 'attempt_id'
  attempt_epoch = Get-SafeProp $receipt 'attempt_epoch'
  timed_out = Get-SafeProp $receipt 'timed_out'
  exit_code = Get-SafeProp $receipt 'exit_code'
  side_effect_state = Get-SafeProp $receipt 'side_effect_state'
  script_sha256 = Get-SafeProp $receipt 'script_sha256'
  stdout_bytes = Get-SafeProp $receipt 'stdout_bytes'
  stderr_bytes = Get-SafeProp $receipt 'stderr_bytes'
  stdout_sha256 = Get-SafeProp $receipt 'stdout_sha256'
  stderr_sha256 = Get-SafeProp $receipt 'stderr_sha256'
  started_at_utc = Get-SafeProp $receipt 'started_at_utc'
  finished_at_utc = Get-SafeProp $receipt 'finished_at_utc'
}

$roots = @('C:\ProgramData\PTYSD\MCP','C:\Windows\Temp')
$recent = @()
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  try {
    $recent += @(Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.LastWriteTimeUtc -ge $sinceUtc -and
        ($_.Name -match '(?i)(p5|mtls|factory-mcp-http|trusted-callers|health|client|server|ca)')
      })
  } catch {}
}
$keyFiles = @($recent | Where-Object { -not $_.PSIsContainer -and $_.Extension -eq '.key' })
$certFiles = @($recent | Where-Object { -not $_.PSIsContainer -and $_.Extension -in @('.crt','.cer','.pem') })
$stageDirs = @($recent | Where-Object { $_.PSIsContainer -and $_.Name -match '(?i)(p5|mtls)' } | Select-Object -First 20)
$configFiles = @($recent | Where-Object { -not $_.PSIsContainer -and $_.Name -match '(?i)factory-mcp-http.*\.json$' } | Select-Object -First 10)
$healthFiles = @($recent | Where-Object { -not $_.PSIsContainer -and $_.Name -match '(?i)health.*\.json$' } | Select-Object -First 10)

$configSafe = @()
foreach ($f in $configFiles) {
  try {
    $c = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
    $configSafe += [ordered]@{
      schema = Get-SafeProp $c 'schema'
      project_id = Get-SafeProp $c 'project_id'
      listen_host = Get-SafeProp $c 'listen_host'
      listen_port = Get-SafeProp $c 'listen_port'
      file_last_write_utc = $f.LastWriteTimeUtc.ToString('o')
    }
  } catch {}
}
$healthSafe = @()
foreach ($f in $healthFiles) {
  try {
    $h = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
    if ((Get-SafeProp $h 'schema') -eq 'v49.factory-mcp.http-health.v1') {
      $healthSafe += [ordered]@{
        schema = Get-SafeProp $h 'schema'
        status = Get-SafeProp $h 'status'
        project_id = Get-SafeProp $h 'project_id'
        listen_host = Get-SafeProp $h 'listen_host'
        listen_port = Get-SafeProp $h 'listen_port'
        trusted_identity_generation = Get-SafeProp $h 'trusted_identity_generation'
        pid = Get-SafeProp $h 'pid'
        observed_at = Get-SafeProp $h 'observed_at'
        file_last_write_utc = $f.LastWriteTimeUtc.ToString('o')
      }
    }
  } catch {}
}

$nodeProcesses = @()
try {
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
    $cmd = [string]$p.CommandLine
    if ($cmd -match '(?i)(http-main\.mjs|factory-mcp|p5.*mtls)') {
      $nodeProcesses += [ordered]@{
        pid = [int]$p.ProcessId
        http_main_match = [bool]($cmd -match '(?i)http-main\.mjs')
        command_line_sha256 = if ($cmd) { 'sha256:' + (Get-Sha256Text $cmd) } else { $null }
        creation_date = if ($p.CreationDate) { ([DateTime]$p.CreationDate).ToUniversalTime().ToString('o') } else { $null }
      }
    }
  }
} catch {}
$nodePids = @($nodeProcesses | ForEach-Object { [int]$_.pid })
$listeners = @()
if ($nodePids.Count -gt 0) {
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -in @('127.0.0.1','::1') -and $nodePids -contains [int]$_.OwningProcess } |
      ForEach-Object { [ordered]@{ local_address=$_.LocalAddress; local_port=[int]$_.LocalPort; owning_pid=[int]$_.OwningProcess } })
  } catch {}
}

$result = [ordered]@{
  schema = 'v49.p5.windows-mtls-timeout-readback.v1'
  request_id = $requestId
  readback_only = $true
  receipt = $receiptSafe
  outbox_response_present = [bool](Test-Path -LiteralPath $outboxPath)
  recent_scan_since_utc = $sinceUtc.ToString('o')
  mtls_stage_dir_present = [bool]($stageDirs.Count -gt 0)
  mtls_stage_dir_count = [int]$stageDirs.Count
  private_key_present = [bool]($keyFiles.Count -gt 0)
  private_key_count = [int]$keyFiles.Count
  certificate_file_count = [int]$certFiles.Count
  http_config = $configSafe
  http_health = $healthSafe
  matching_node_processes = $nodeProcesses
  loopback_listeners = $listeners
  no_private_key_content_output = $true
  no_raw_log_output = $true
  no_process_kill = $true
  no_file_delete = $true
  observed_at_utc = [DateTime]::UtcNow.ToString('o')
}
$result | ConvertTo-Json -Depth 8 -Compress
