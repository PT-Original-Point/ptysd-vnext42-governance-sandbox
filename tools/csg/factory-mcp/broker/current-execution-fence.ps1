Set-StrictMode -Version Latest

$script:PTYSDControlRepositoryUrl = 'https://github.com/PT-Original-Point/ptysd-vnext42-governance-sandbox.git'
$script:PTYSDControlRef = 'refs/heads/v45/factory-control'
$script:PTYSDControlRawRoot = 'https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox'
$script:PTYSDControlGit = 'C:\Program Files\Git\cmd\git.exe'

function Get-PTYSDCanonicalControlHead {
  if (-not (Test-Path -LiteralPath $script:PTYSDControlGit)) { throw 'SYSTEM_FENCE_GIT_MISSING' }
  $oldPrompt = $env:GIT_TERMINAL_PROMPT
  try {
    $env:GIT_TERMINAL_PROMPT = '0'
    $lines = @(& $script:PTYSDControlGit ls-remote --refs $script:PTYSDControlRepositoryUrl $script:PTYSDControlRef 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'SYSTEM_FENCE_CONTROL_HEAD_READ_FAILED' }
  } finally { $env:GIT_TERMINAL_PROMPT = $oldPrompt }
  $line = @($lines | Where-Object { $_ }) | Select-Object -First 1
  if (-not $line) { throw 'SYSTEM_FENCE_CONTROL_HEAD_READ_FAILED' }
  $parts = ([string]$line).Trim() -split '\s+'
  if ($parts.Count -lt 2 -or $parts[0] -notmatch '^[0-9a-f]{40}$' -or $parts[1] -ne $script:PTYSDControlRef) {
    throw 'SYSTEM_FENCE_CONTROL_HEAD_INVALID'
  }
  return [string]$parts[0]
}

function Get-PTYSDJsonAtControlOid {
  param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ControlOid,
    [Parameter(Mandatory)][string]$Path
  )
  if ($Path -notmatch '^[A-Za-z0-9._/-]{1,512}$' -or $Path.Contains('..')) { throw 'SYSTEM_FENCE_PROVIDER_PATH_INVALID' }
  $uri = $script:PTYSDControlRawRoot + '/' + $ControlOid + '/' + $Path
  try {
    return Invoke-RestMethod -UseBasicParsing -Method Get -Uri $uri -Headers @{ 'User-Agent'='PTYSD-Factory-MCP/0.2.1'; 'Cache-Control'='no-cache' } -TimeoutSec 10
  } catch { throw 'SYSTEM_FENCE_PROVIDER_READ_FAILED' }
}

function Get-PTYSDMutationPayloadSha256 {
  param(
    [Parameter(Mandatory)][string]$OperationKind,
    [Parameter(Mandatory)]$Request
  )
  $canonical = '{0}|{1}|{2}|{3}|{4}' -f $OperationKind,[string]$Request.run_id,[string]$Request.task_id,[string]$Request.attempt_id,[int64]$Request.attempt_epoch
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    $hex = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  } finally { $sha.Dispose() }
  return ('sha256:' + $hex)
}

function Get-PTYSDCurrentSystemExecutionFence {
  param([Parameter(Mandatory)]$SystemCapability)

  $headBefore = Get-PTYSDCanonicalControlHead
  $pointer = Get-PTYSDJsonAtControlOid -ControlOid $headBefore -Path 'governance/csg/current.json'
  if ([string]$pointer.schema_version -ne 'csg.pointer.v1') { throw 'SYSTEM_FENCE_POINTER_SCHEMA_INVALID' }
  if ([string]$pointer.project_id -ne 'CHATGPT_GLOBAL_SKILL_GOVERNANCE') { throw 'SYSTEM_FENCE_POINTER_PROJECT_MISMATCH' }
  $checkpointPath = [string]$pointer.checkpoint_path
  if ($checkpointPath -notmatch '^governance/csg/checkpoints/[0-9]{6}\.json$') { throw 'SYSTEM_FENCE_CHECKPOINT_PATH_INVALID' }
  if ([string]$pointer.checkpoint_digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'SYSTEM_FENCE_CHECKPOINT_DIGEST_INVALID' }

  $checkpoint = Get-PTYSDJsonAtControlOid -ControlOid $headBefore -Path $checkpointPath
  $headAfter = Get-PTYSDCanonicalControlHead
  if ($headBefore -ne $headAfter) { throw 'SYSTEM_FENCE_CONTROL_DRIFT' }

  if ([string]$checkpoint.schema_version -ne 'csg.checkpoint.v1') { throw 'SYSTEM_FENCE_CHECKPOINT_SCHEMA_INVALID' }
  if ([string]$checkpoint.project_id -ne 'CHATGPT_GLOBAL_SKILL_GOVERNANCE') { throw 'SYSTEM_FENCE_CHECKPOINT_PROJECT_MISMATCH' }
  if ([int64]$checkpoint.checkpoint_seq -ne [int64]$pointer.checkpoint_seq) { throw 'SYSTEM_FENCE_CHECKPOINT_SEQ_MISMATCH' }
  if ([string]$checkpoint.payload_digest -ne [string]$pointer.checkpoint_digest) { throw 'SYSTEM_FENCE_CHECKPOINT_DIGEST_MISMATCH' }

  $fence = $checkpoint.atomic.execution_fence
  if (-not $fence -or [string]$fence.schema -ne 'v49.factory-mcp.execution-fence.v1') { throw 'SYSTEM_FENCE_CURRENT_FENCE_MISSING' }
  if ([string]$fence.project_id -ne 'CHATGPT_GLOBAL_SKILL_GOVERNANCE') { throw 'SYSTEM_FENCE_PROJECT_MISMATCH' }
  if ([string]$fence.operation_kind -notin @('HOST_POWERSHELL','WORKER_PREPARE','WORKER_START')) { throw 'SYSTEM_FENCE_OPERATION_KIND_DENY' }
  if ([string]$fence.task_id -ne [string]$checkpoint.task_id) { throw 'SYSTEM_FENCE_TASK_CHECKPOINT_MISMATCH' }
  if ([string]$fence.attempt_id -ne [string]$checkpoint.attempt_id) { throw 'SYSTEM_FENCE_ATTEMPT_CHECKPOINT_MISMATCH' }
  if ([int64]$fence.attempt_epoch -ne [int64]$checkpoint.attempt_epoch) { throw 'SYSTEM_FENCE_EPOCH_CHECKPOINT_MISMATCH' }
  if ([string]$fence.mission_revision -ne [string]$checkpoint.mission_anchor.revision) { throw 'SYSTEM_FENCE_MISSION_REVISION_MISMATCH' }
  if ([string]$fence.mission_hash -ne [string]$checkpoint.mission_anchor.declared_hash) { throw 'SYSTEM_FENCE_MISSION_HASH_MISMATCH' }
  if ([string]$fence.authorization_envelope_digest -ne [string]$checkpoint.authorization_mode.envelope_ref.digest) { throw 'SYSTEM_FENCE_AUTHORIZATION_MISMATCH' }
  if ([int64]$fence.authorization_generation -lt 1) { throw 'SYSTEM_FENCE_AUTHORIZATION_GENERATION_INVALID' }
  if ([string]$fence.authorization_state_digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'SYSTEM_FENCE_AUTHORIZATION_STATE_DIGEST_INVALID' }
  if ([int64]$fence.authorization_generation -ne [int64]$checkpoint.authorization_mode.authorization_generation) { throw 'SYSTEM_FENCE_AUTHORIZATION_GENERATION_MISMATCH' }
  if ([string]$fence.authorization_state_digest -ne [string]$checkpoint.authorization_mode.authorization_state_ref.digest) { throw 'SYSTEM_FENCE_AUTHORIZATION_STATE_MISMATCH' }
  if ([string]$fence.mission_revision -ne [string]$SystemCapability.mission_revision) { throw 'SYSTEM_FENCE_CAPABILITY_MISSION_MISMATCH' }
  if ([string]$fence.mission_hash -ne [string]$SystemCapability.mission_hash) { throw 'SYSTEM_FENCE_CAPABILITY_MISSION_HASH_MISMATCH' }
  if ([string]$fence.authorization_envelope_digest -ne [string]$SystemCapability.authorization_envelope_digest) { throw 'SYSTEM_FENCE_CAPABILITY_AUTHORIZATION_MISMATCH' }
  if ([int64]$fence.capability_generation -lt 1 -or [int64]$fence.capability_generation -ne [int64]$SystemCapability.capability_generation) { throw 'SYSTEM_FENCE_GENERATION_STALE' }
  if ([string]$fence.operation_kind -eq 'HOST_POWERSHELL') {
    if ([string]$fence.script_sha256 -notmatch '^sha256:[0-9a-f]{64}$') { throw 'SYSTEM_FENCE_SCRIPT_DIGEST_INVALID' }
  } elseif ([string]$fence.payload_sha256 -notmatch '^sha256:[0-9a-f]{64}$') {
    throw 'SYSTEM_FENCE_PAYLOAD_DIGEST_INVALID'
  }
  if ([int]$fence.timeout_seconds -lt 1 -or [int]$fence.timeout_seconds -gt 300) { throw 'SYSTEM_FENCE_TIMEOUT_INVALID' }
  try { $expires = ([DateTimeOffset]::Parse([string]$fence.expires_at)).UtcDateTime } catch { throw 'SYSTEM_FENCE_EXPIRY_INVALID' }
  if ([DateTime]::UtcNow -ge $expires) { throw 'SYSTEM_FENCE_EXPIRED' }

  return [pscustomobject]@{
    control_oid = $headBefore
    checkpoint_seq = [int64]$pointer.checkpoint_seq
    checkpoint_digest = [string]$pointer.checkpoint_digest
    fence = $fence
    execution_fence = $fence
  }
}

function Assert-PTYSDCurrentSystemExecutionFence {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)]$SystemCapability
  )
  $context = Get-PTYSDCurrentSystemExecutionFence -SystemCapability $SystemCapability
  $fence = $context.fence
  $expectedKind = switch ([string]$Request.operation) {
    'powershell' { 'HOST_POWERSHELL'; break }
    'prepare' { 'WORKER_PREPARE'; break }
    'start' { 'WORKER_START'; break }
    default { throw 'SYSTEM_FENCE_OPERATION_KIND_DENY' }
  }
  if ([string]$fence.operation_kind -ne $expectedKind) { throw 'SYSTEM_FENCE_OPERATION_KIND_MISMATCH' }

  if ([string]$Request.control_oid -ne [string]$context.control_oid) { throw 'SYSTEM_FENCE_CONTROL_OID_MISMATCH' }
  if ([string]$Request.checkpoint_digest -ne [string]$context.checkpoint_digest) { throw 'SYSTEM_FENCE_CHECKPOINT_REQUEST_MISMATCH' }
  if ([string]$Request.operation_id -ne [string]$fence.operation_id) { throw 'SYSTEM_FENCE_OPERATION_ID_MISMATCH' }
  if ([string]$Request.authorization_envelope_digest -ne [string]$fence.authorization_envelope_digest) { throw 'SYSTEM_FENCE_AUTHORIZATION_REQUEST_MISMATCH' }
  if ([int64]$Request.authorization_generation -ne [int64]$fence.authorization_generation) { throw 'SYSTEM_FENCE_AUTHORIZATION_GENERATION_REQUEST_MISMATCH' }
  if ([string]$Request.authorization_state_digest -ne [string]$fence.authorization_state_digest) { throw 'SYSTEM_FENCE_AUTHORIZATION_STATE_REQUEST_MISMATCH' }
  if ([int64]$Request.capability_generation -ne [int64]$fence.capability_generation) { throw 'SYSTEM_FENCE_GENERATION_REQUEST_MISMATCH' }
  if ([string]$Request.run_id -ne [string]$fence.run_id) { throw 'SYSTEM_FENCE_RUN_MISMATCH' }
  if ([string]$Request.task_id -ne [string]$fence.task_id) { throw 'SYSTEM_FENCE_TASK_MISMATCH' }
  if ([string]$Request.attempt_id -ne [string]$fence.attempt_id) { throw 'SYSTEM_FENCE_ATTEMPT_MISMATCH' }
  if ([int64]$Request.attempt_epoch -ne [int64]$fence.attempt_epoch) { throw 'SYSTEM_FENCE_EPOCH_MISMATCH' }
  if ([int]$Request.timeout_seconds -ne [int]$fence.timeout_seconds) { throw 'SYSTEM_FENCE_TIMEOUT_MISMATCH' }

  if ($expectedKind -eq 'HOST_POWERSHELL') {
    try { [byte[]]$scriptBytes = [Convert]::FromBase64String([string]$Request.script_b64) } catch { throw 'SYSTEM_FENCE_SCRIPT_B64_INVALID' }
    $scriptDigest = 'sha256:' + (Get-PTYSDHostExecSha256Hex -Bytes $scriptBytes)
    if ($scriptDigest -ne [string]$fence.script_sha256) { throw 'SYSTEM_FENCE_SCRIPT_MISMATCH' }
  } else {
    $payloadDigest = Get-PTYSDMutationPayloadSha256 -OperationKind $expectedKind -Request $Request
    if ($payloadDigest -ne [string]$fence.payload_sha256) { throw 'SYSTEM_FENCE_PAYLOAD_MISMATCH' }
  }
  return $context
}
