Set-StrictMode -Version Latest

$script:PTYSDOperationClaimIdPattern = '^[A-Z0-9][A-Z0-9._-]{0,127}$'

function Assert-PTYSDOperationClaimId {
  param(
    [Parameter(Mandatory)][object]$Value,
    [Parameter(Mandatory)][string]$Code
  )
  if ($null -eq $Value -or [string]$Value -notmatch $script:PTYSDOperationClaimIdPattern) {
    throw $Code
  }
}

function Get-PTYSDOperationDispatchClaimKey {
  param([Parameter(Mandatory)]$Request)

  Assert-PTYSDOperationClaimId -Value $Request.project_id -Code 'OPERATION_CLAIM_PROJECT_INVALID'
  Assert-PTYSDOperationClaimId -Value $Request.run_id -Code 'OPERATION_CLAIM_RUN_INVALID'
  Assert-PTYSDOperationClaimId -Value $Request.operation_id -Code 'OPERATION_CLAIM_OPERATION_INVALID'

  $epoch = [int64]$Request.attempt_epoch
  if ($epoch -lt 1 -or $epoch -gt 2147483647) { throw 'OPERATION_CLAIM_EPOCH_INVALID' }

  $authGeneration = [int64]$Request.authorization_generation
  if ($authGeneration -lt 1 -or $authGeneration -gt 2147483647) {
    throw 'OPERATION_CLAIM_AUTH_GENERATION_INVALID'
  }

  $canonical = '{0}|{1}|{2}|{3}|{4}' -f [string]$Request.project_id,[string]$Request.run_id,$epoch,$authGeneration,[string]$Request.operation_id
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    $hex = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }

  return [pscustomobject]@{
    key = $hex
    authorization_generation = $authGeneration
    canonical = $canonical
  }
}

function Acquire-PTYSDOperationDispatchClaim {
  param(
    [Parameter(Mandatory)]$Request,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{32}$')][string]$RequestId,
    [Parameter(Mandatory)][string]$ClaimsRoot
  )

  if (-not (Test-Path -LiteralPath $ClaimsRoot -PathType Container)) {
    throw 'OPERATION_CLAIM_ROOT_MISSING'
  }

  $key = Get-PTYSDOperationDispatchClaimKey -Request $Request
  $claimPath = Join-Path $ClaimsRoot ($key.key + '.json')
  $claim = [ordered]@{
    schema = 'v49.factory-mcp.operation-dispatch-claim.v1'
    claim_key = [string]$key.key
    project_id = [string]$Request.project_id
    run_id = [string]$Request.run_id
    attempt_id = [string]$Request.attempt_id
    attempt_epoch = [int64]$Request.attempt_epoch
    authorization_generation = [int64]$key.authorization_generation
    operation_id = [string]$Request.operation_id
    request_id = $RequestId
    state = 'DISPATCH_CLAIMED'
    claimed_at_utc = [DateTime]::UtcNow.ToString('o')
  }

  $json = $claim | ConvertTo-Json -Depth 6 -Compress
  [byte[]]$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
  try {
    $stream = [IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
      $stream.Write($bytes,0,$bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
  } catch [IO.IOException] {
    if (Test-Path -LiteralPath $claimPath) { throw 'OPERATION_ALREADY_DISPATCHED' }
    throw
  }

  return [pscustomobject]@{
    path = $claimPath
    key = [string]$key.key
    request_id = $RequestId
  }
}
