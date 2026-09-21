Set-StrictMode -Version Latest

$script:PTYSDTrustedCallerConfigPath = 'C:\ProgramData\PTYSD\MCP\config\trusted-callers.json'
$script:PTYSDCallerAttestationKeyPath = 'C:\ProgramData\PTYSD\MCP\secrets\broker-caller-attestation.key'

function Get-PTYSDTrustedCallerConfig {
  if (-not (Test-Path -LiteralPath $script:PTYSDTrustedCallerConfigPath)) { throw 'TRUSTED_CALLER_CONFIG_MISSING' }
  try { $cfg = Get-Content -LiteralPath $script:PTYSDTrustedCallerConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'TRUSTED_CALLER_CONFIG_INVALID' }
  if ([string]$cfg.schema -ne 'v49.factory-mcp.trusted-callers.v1') { throw 'TRUSTED_CALLER_CONFIG_SCHEMA_INVALID' }
  if ([int64]$cfg.identity_generation -lt 1) { throw 'TRUSTED_CALLER_IDENTITY_GENERATION_INVALID' }
  if (@($cfg.callers).Count -lt 1) { throw 'TRUSTED_CALLER_CONFIG_EMPTY' }
  return $cfg
}

function Get-PTYSDCallerAttestationKey {
  if (-not (Test-Path -LiteralPath $script:PTYSDCallerAttestationKeyPath)) { throw 'TRUSTED_CALLER_ATTESTATION_KEY_MISSING' }
  $hex = (Get-Content -LiteralPath $script:PTYSDCallerAttestationKeyPath -Raw).Trim().ToLowerInvariant()
  if ($hex -notmatch '^[0-9a-f]{64}$') { throw 'TRUSTED_CALLER_ATTESTATION_KEY_INVALID' }
  $bytes = New-Object byte[] 32
  for ($i=0; $i -lt 32; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i*2,2),16) }
  return $bytes
}

function Test-PTSDFixedTimeBytes {
  param([Parameter(Mandatory)][byte[]]$Left,[Parameter(Mandatory)][byte[]]$Right)
  if ($Left.Length -ne $Right.Length) { return $false }
  [int]$diff = 0
  for ($i=0; $i -lt $Left.Length; $i++) { $diff = $diff -bor ($Left[$i] -bxor $Right[$i]) }
  return ($diff -eq 0)
}

function Assert-PTYSDTrustedCallerAttestation {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)]$FenceContext
  )
  if ([string]$Request.caller_attestation_b64 -notmatch '^[A-Za-z0-9+/=]+$') { throw 'TRUSTED_CALLER_ATTESTATION_PAYLOAD_INVALID' }
  if ([string]$Request.caller_attestation_mac -notmatch '^[0-9a-f]{64}$') { throw 'TRUSTED_CALLER_ATTESTATION_MAC_INVALID' }
  try { [byte[]]$payloadBytes = [Convert]::FromBase64String([string]$Request.caller_attestation_b64) }
  catch { throw 'TRUSTED_CALLER_ATTESTATION_PAYLOAD_INVALID' }
  if ($payloadBytes.Length -lt 16 -or $payloadBytes.Length -gt 16384) { throw 'TRUSTED_CALLER_ATTESTATION_PAYLOAD_SIZE_INVALID' }

  $key = Get-PTYSDCallerAttestationKey
  $hmac = New-Object Security.Cryptography.HMACSHA256(,$key)
  try { [byte[]]$expectedMac = $hmac.ComputeHash($payloadBytes) } finally { $hmac.Dispose() }
  try {
    [byte[]]$claimedMac = New-Object byte[] 32
    for ($i=0; $i -lt 32; $i++) { $claimedMac[$i] = [Convert]::ToByte(([string]$Request.caller_attestation_mac).Substring($i*2,2),16) }
  } catch { throw 'TRUSTED_CALLER_ATTESTATION_MAC_INVALID' }
  if (-not (Test-PTSDFixedTimeBytes -Left $expectedMac -Right $claimedMac)) { throw 'TRUSTED_CALLER_ATTESTATION_MAC_MISMATCH' }

  try { $claims = [Text.Encoding]::UTF8.GetString($payloadBytes) | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'TRUSTED_CALLER_ATTESTATION_JSON_INVALID' }
  if ([string]$claims.schema -ne 'v49.factory-mcp.caller-attestation.v1') { throw 'TRUSTED_CALLER_ATTESTATION_SCHEMA_INVALID' }

  try {
    $issued = [DateTimeOffset]::Parse([string]$claims.issued_at).UtcDateTime
    $expires = [DateTimeOffset]::Parse([string]$claims.expires_at).UtcDateTime
  } catch { throw 'TRUSTED_CALLER_ATTESTATION_TIME_INVALID' }
  $now=[DateTime]::UtcNow
  if ($issued -gt $now.AddSeconds(5) -or $expires -le $now -or ($expires-$issued).TotalSeconds -gt 60) {
    throw 'TRUSTED_CALLER_ATTESTATION_EXPIRED'
  }

  $cfg=Get-PTYSDTrustedCallerConfig
  if ([int64]$claims.identity_generation -ne [int64]$cfg.identity_generation) { throw 'TRUSTED_CALLER_IDENTITY_GENERATION_STALE' }
  $matches=@($cfg.callers | Where-Object {
    $_.enabled -eq $true -and
    [string]$_.project_id -eq [string]$claims.project_id -and
    [string]$_.caller_id -eq [string]$claims.caller_id -and
    [string]$_.certificate_sha256 -eq [string]$claims.certificate_sha256 -and
    [int64]$_.identity_generation -eq [int64]$claims.identity_generation
  })
  if ($matches.Count -ne 1) { throw 'TRUSTED_CALLER_IDENTITY_NOT_ALLOWED' }

  $fence=$FenceContext.execution_fence
  if ([string]$claims.project_id -ne [string]$Request.project_id) { throw 'TRUSTED_CALLER_PROJECT_REQUEST_MISMATCH' }
  if ([string]$claims.project_id -ne [string]$fence.project_id) { throw 'TRUSTED_CALLER_PROJECT_FENCE_MISMATCH' }
  if ([string]$claims.mission_revision -ne [string]$fence.mission_revision) { throw 'TRUSTED_CALLER_MISSION_REVISION_MISMATCH' }
  if ([string]$claims.mission_hash -ne [string]$fence.mission_hash) { throw 'TRUSTED_CALLER_MISSION_HASH_MISMATCH' }
  if ([string]$claims.authorization_envelope_digest -ne [string]$Request.authorization_envelope_digest) { throw 'TRUSTED_CALLER_AUTH_REQUEST_MISMATCH' }
  if ([string]$claims.authorization_envelope_digest -ne [string]$fence.authorization_envelope_digest) { throw 'TRUSTED_CALLER_AUTH_FENCE_MISMATCH' }
  if ([string]$claims.control_oid -ne [string]$Request.control_oid -or [string]$claims.control_oid -ne [string]$FenceContext.control_oid) { throw 'TRUSTED_CALLER_CONTROL_MISMATCH' }
  if ([string]$claims.checkpoint_digest -ne [string]$Request.checkpoint_digest -or [string]$claims.checkpoint_digest -ne [string]$FenceContext.checkpoint_digest) { throw 'TRUSTED_CALLER_CHECKPOINT_MISMATCH' }
  if ([string]$claims.operation_id -ne [string]$Request.operation_id -or [string]$claims.operation_id -ne [string]$fence.operation_id) { throw 'TRUSTED_CALLER_OPERATION_MISMATCH' }
  if ([string]$claims.run_id -ne [string]$Request.run_id -or [string]$claims.run_id -ne [string]$fence.run_id) { throw 'TRUSTED_CALLER_RUN_MISMATCH' }
  if ([string]$claims.task_id -ne [string]$Request.task_id -or [string]$claims.task_id -ne [string]$fence.task_id) { throw 'TRUSTED_CALLER_TASK_MISMATCH' }
  if ([string]$claims.attempt_id -ne [string]$Request.attempt_id -or [string]$claims.attempt_id -ne [string]$fence.attempt_id) { throw 'TRUSTED_CALLER_ATTEMPT_MISMATCH' }
  if ([int64]$claims.attempt_epoch -ne [int64]$Request.attempt_epoch -or [int64]$claims.attempt_epoch -ne [int64]$fence.attempt_epoch) { throw 'TRUSTED_CALLER_EPOCH_MISMATCH' }
  if ([int]$claims.timeout_seconds -ne [int]$Request.timeout_seconds -or [int]$claims.timeout_seconds -ne [int]$fence.timeout_seconds) { throw 'TRUSTED_CALLER_TIMEOUT_MISMATCH' }

  try { [byte[]]$scriptBytes=[Convert]::FromBase64String([string]$Request.script_b64) } catch { throw 'TRUSTED_CALLER_SCRIPT_B64_INVALID' }
  $scriptDigest='sha256:'+(Get-PTYSDHostExecSha256Hex -Bytes $scriptBytes)
  if ([string]$claims.script_sha256 -ne $scriptDigest -or [string]$claims.script_sha256 -ne [string]$fence.script_sha256) { throw 'TRUSTED_CALLER_SCRIPT_MISMATCH' }

  return $claims
}
