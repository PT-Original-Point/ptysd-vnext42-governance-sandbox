[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $packageRoot 'windows\repair-factory-mcp.ps1')

$manifestPath = Join-Path $packageRoot 'windows\repair-manifest.json'
$manifestText = [IO.File]::ReadAllText($manifestPath)
$manifest = Assert-FactoryMcpRepairManifest -JsonText $manifestText -ExpectedSha256 (Get-FactoryMcpRepairManifestSha256)
if (Test-FactoryMcpRepairWriteRights -Sid 'S-1-5-20' -Rights ([Security.AccessControl.FileSystemRights]::ReadAndExecute)) {
  throw 'REPAIR_READ_ONLY_NETWORK_SERVICE_RIGHTS_REJECTED'
}
if (-not (Test-FactoryMcpRepairWriteRights -Sid 'S-1-5-20' -Rights ([Security.AccessControl.FileSystemRights]::ChangePermissions))) {
  throw 'REPAIR_NETWORK_SERVICE_ACL_MUTATION_ACCEPTED'
}
foreach ($entry in @($manifest.files)) {
  $payloadPath = Join-Path $packageRoot ([string]$entry.relative_path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $payloadPath -PathType Leaf)) { throw ('REPAIR_SMOKE_PAYLOAD_MISSING:' + [string]$entry.relative_path) }
  if ((Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256) {
    throw ('REPAIR_SMOKE_PAYLOAD_DIGEST_MISMATCH:' + [string]$entry.relative_path)
  }
}

function Assert-RepairRejected {
  param([Parameter(Mandatory)][scriptblock]$Action,[Parameter(Mandatory)][string]$Expected)
  try { & $Action }
  catch {
    if ([string]$_.Exception.Message -ceq $Expected) { return }
    throw ('UNEXPECTED_REPAIR_REJECTION:' + [string]$_.Exception.Message)
  }
  throw ('EXPECTED_REPAIR_REJECTION_MISSING:' + $Expected)
}

$targets = @(Get-FactoryMcpRepairAllowedTargets)
$files = @($targets | ForEach-Object { [ordered]@{relative_path=$_;sha256=('a' * 64)} })
$valid = [ordered]@{
  schema='v51.factory-mcp.repair-manifest.v1'
  project_scope_mode='PROTECTED_INSTALL_CONFIGURATION'
  release_version='0.2.3'
  files=$files
  restart_tasks=@('PTYSD-FactoryMCP-HostGuard-Broker-V47','PTYSD-FactoryMCP-Tunnel-V47')
  canary=[ordered]@{id='READ_ONLY_FACTORY_STATUS';relative_path='tests/live-status-smoke.mjs';sha256=('b' * 64)}
}
$validJson = ConvertTo-Json -InputObject $valid -Depth 8 -Compress
$validSha = Get-FactoryMcpRepairSha256 -Bytes ((New-Object Text.UTF8Encoding($false)).GetBytes($validJson))
$parsed = Assert-FactoryMcpRepairManifest -JsonText $validJson -ExpectedSha256 $validSha
if (@($parsed.files).Count -ne 15) { throw 'REPAIR_MANIFEST_VALID_FIXTURE_COUNT_MISMATCH' }

$invalidCanaryHash = $validJson | ConvertFrom-Json
$invalidCanaryHash.canary.sha256=('g' * 64)
$invalidCanaryHashJson = ConvertTo-Json -InputObject $invalidCanaryHash -Depth 8 -Compress
$invalidCanaryHashSha = Get-FactoryMcpRepairSha256 -Bytes ((New-Object Text.UTF8Encoding($false)).GetBytes($invalidCanaryHashJson))
Assert-RepairRejected { Assert-FactoryMcpRepairManifest -JsonText $invalidCanaryHashJson -ExpectedSha256 $invalidCanaryHashSha } 'REPAIR_MANIFEST_CANARY_INVALID'

Assert-RepairRejected { Assert-FactoryMcpRepairManifest -JsonText $validJson -ExpectedSha256 ('0' * 64) } 'REPAIR_MANIFEST_DIGEST_MISMATCH'

$escaped = $validJson | ConvertFrom-Json
$escaped.files[0].relative_path='../outside.ps1'
$escapedJson = ConvertTo-Json -InputObject $escaped -Depth 8 -Compress
$escapedSha = Get-FactoryMcpRepairSha256 -Bytes ((New-Object Text.UTF8Encoding($false)).GetBytes($escapedJson))
Assert-RepairRejected { Assert-FactoryMcpRepairManifest -JsonText $escapedJson -ExpectedSha256 $escapedSha } 'REPAIR_MANIFEST_TARGET_NOT_ALLOWLISTED'

$duplicate = $validJson | ConvertFrom-Json
$duplicate.files[1].relative_path=$duplicate.files[0].relative_path
$duplicateJson = ConvertTo-Json -InputObject $duplicate -Depth 8 -Compress
$duplicateSha = Get-FactoryMcpRepairSha256 -Bytes ((New-Object Text.UTF8Encoding($false)).GetBytes($duplicateJson))
Assert-RepairRejected { Assert-FactoryMcpRepairManifest -JsonText $duplicateJson -ExpectedSha256 $duplicateSha } 'REPAIR_MANIFEST_DUPLICATE_TARGET'

$extraField = $validJson | ConvertFrom-Json
$extraField | Add-Member -NotePropertyName arbitrary_command -NotePropertyValue 'Invoke-Expression'
$extraFieldJson = ConvertTo-Json -InputObject $extraField -Depth 8 -Compress
$extraFieldSha = Get-FactoryMcpRepairSha256 -Bytes ((New-Object Text.UTF8Encoding($false)).GetBytes($extraFieldJson))
Assert-RepairRejected { Assert-FactoryMcpRepairManifest -JsonText $extraFieldJson -ExpectedSha256 $extraFieldSha } 'REPAIR_MANIFEST_FIELDS_INVALID'

$same = [pscustomobject]@{exists=$true;sha256=('b' * 64);owner_sid='S-1-5-18';access_sddl='D:P(A;;FA;;;SY)'}
$copy = [pscustomobject]@{exists=$true;sha256=('b' * 64);owner_sid='S-1-5-18';access_sddl='D:P(A;;FA;;;SY)'}
$changed = [pscustomobject]@{exists=$true;sha256=('c' * 64);owner_sid='S-1-5-18';access_sddl='D:P(A;;FA;;;SY)'}
if (-not (Test-FactoryMcpRepairStateEquals -Left $same -Right $copy)) { throw 'REPAIR_PRESTATE_EQUALITY_POSITIVE_FAILED' }
if (Test-FactoryMcpRepairStateEquals -Left $same -Right $changed) { throw 'REPAIR_PRESTATE_EQUALITY_NEGATIVE_FAILED' }

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('factory-mcp-repair-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
  $canaryPath = Join-Path $tempRoot 'live-status-smoke.mjs'
  [IO.File]::WriteAllText($canaryPath,'qualified canary',(New-Object Text.UTF8Encoding($false)))
  $canaryDigest = (Get-FileHash -LiteralPath $canaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-FactoryMcpRepairCanaryFile -Path $canaryPath -ExpectedSha256 $canaryDigest
  Assert-RepairRejected { Assert-FactoryMcpRepairCanaryFile -Path $canaryPath -ExpectedSha256 ('0' * 64) } 'REPAIR_CANARY_DIGEST_MISMATCH'
  Assert-RepairRejected { Assert-FactoryMcpRepairCanaryFile -Path $canaryPath -ExpectedSha256 ('g' * 64) } 'REPAIR_CANARY_DIGEST_INVALID'
  $resolved = Get-FactoryMcpRepairPath -Root $tempRoot -RelativePath 'src/index.mjs'
  if (-not $resolved.StartsWith(($tempRoot + [IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)) {
    throw 'REPAIR_ALLOWLIST_PATH_RESOLUTION_FAILED'
  }
  Assert-RepairRejected { Get-FactoryMcpRepairPath -Root $tempRoot -RelativePath '..\outside.ps1' } 'REPAIR_MANIFEST_TARGET_NOT_ALLOWLISTED'
  $directoryDenied = $false
  try { [void](Assert-FactoryMcpRepairTargetDirectoryAcl -Path $tempRoot) }
  catch {
    if ([string]$_.Exception.Message -notin @('REPAIR_TARGET_DIRECTORY_OWNER_INVALID','REPAIR_TARGET_DIRECTORY_PRINCIPAL_UNEXPECTED')) {
      throw ('UNEXPECTED_TARGET_DIRECTORY_ACL_RESULT:' + [string]$_.Exception.Message)
    }
    $directoryDenied = $true
  }
  if (-not $directoryDenied) { throw 'REPAIR_UNPROTECTED_DIRECTORY_ACCEPTED' }
  $ancestorDenied = $false
  try { Assert-FactoryMcpRepairSafePathAncestors -Path $tempRoot }
  catch {
    if ([string]$_.Exception.Message -notin @('REPAIR_ANCESTOR_OWNER_INVALID','REPAIR_ANCESTOR_UNTRUSTED_WRITE_ACCESS')) {
      throw ('UNEXPECTED_ANCESTOR_ACL_RESULT:' + [string]$_.Exception.Message)
    }
    $ancestorDenied = $true
  }
  if (-not $ancestorDenied) { throw 'REPAIR_UNTRUSTED_ANCESTOR_ACCEPTED' }
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Output 'REPAIR_LANE_SMOKE=PASS'
