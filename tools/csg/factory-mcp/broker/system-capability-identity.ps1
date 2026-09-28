Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PTYSDSystemOperationKey {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$CapabilityId,
    [Parameter(Mandatory)][string]$OperationId
  )

  $pattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  foreach ($value in @($ProjectId,$CapabilityId,$OperationId)) {
    if ($value -notmatch $pattern) { throw 'SYSTEM_OPERATION_IDENTITY_INVALID' }
  }
  $version = 'PTYSD-SYSTEM-OPERATION-V1'
  $project = $ProjectId.ToUpperInvariant()
  $capability = $CapabilityId.ToUpperInvariant()
  $operation = $OperationId.ToUpperInvariant()
  $canonical = '{0}:{1}|{2}:{3}|{4}:{5}|{6}:{7}' -f `
    $version.Length, $version, $project.Length, $project, $capability.Length, $capability, $operation.Length, $operation
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-','').ToLowerInvariant())
  } finally {
    $algorithm.Dispose()
  }
}

function Get-PTYSDTrustedRequestOwnerSid {
  param([Parameter(Mandatory)][string]$Path)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'SYSTEM_CAPABILITY_CALLER_PATH_DENY' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
  if ($null -eq $owner) { throw 'SYSTEM_CAPABILITY_CALLER_IDENTITY_UNKNOWN' }
  return [string]$owner.Value
}

function Assert-PTYSDTrustedRequestOwner {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ExpectedSid
  )
  if ($ExpectedSid -notmatch '^S-1-5-\d+(?:-\d+)*$') { throw 'SYSTEM_CAPABILITY_CONFIG_INVALID' }
  $actualSid = Get-PTYSDTrustedRequestOwnerSid -Path $Path
  if ($actualSid -cne $ExpectedSid) { throw 'SYSTEM_CAPABILITY_CALLER_DENY' }
  return $actualSid
}
