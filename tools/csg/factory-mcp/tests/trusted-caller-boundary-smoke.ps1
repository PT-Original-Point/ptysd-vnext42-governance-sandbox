[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $packageRoot 'broker\trusted-caller-boundary.ps1')

function Assert-Rejected {
  param([Parameter(Mandatory)][scriptblock]$Action,[Parameter(Mandatory)][string]$Expected)
  try {
    & $Action
  } catch {
    if ([string]$_.Exception.Message -ceq $Expected) { return }
    throw ('UNEXPECTED_REJECTION:' + [string]$_.Exception.Message)
  }
  throw ('EXPECTED_REJECTION_MISSING:' + $Expected)
}

$canonicalJson = [ordered]@{
  schema='v51.factory-mcp.hostguard.request.v3'
  request_id='0123456789abcdef0123456789abcdef'
  project_id='PROJECT_A'
  host_id=$env:COMPUTERNAME
  execution_scope='PREPRODUCTION_REVERSIBLE'
  production_allowed=$false
  operation='prepare'
  run_id='V51-TEST-001'
  task_id='V51-TEST-TASK'
  attempt_id='V51-TEST-ATTEMPT-001'
  attempt_epoch=1
  script_b64=$null
  timeout_seconds=$null
  requested_at_utc=[DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 4 -Compress
$parsedCanonicalJson = ConvertFrom-FactoryCanonicalJson -JsonText $canonicalJson -Depth 4
if ([string]$parsedCanonicalJson.project_id -cne 'PROJECT_A' -or [string]$parsedCanonicalJson.host_id -cne $env:COMPUTERNAME) {
  throw 'CANONICAL_JSON_POSITIVE_FAILED'
}
$duplicateJson = $canonicalJson.Replace('"project_id":"PROJECT_A"','"project_id":"PROJECT_A","project_id":"PROJECT_B"')
$duplicateRejected = $false
try { [void](ConvertFrom-FactoryCanonicalJson -JsonText $duplicateJson -Depth 4) }
catch {
  if ([string]$_.Exception.Message -in @('REQUEST_JSON_INVALID','REQUEST_JSON_NONCANONICAL')) { $duplicateRejected = $true }
  else { throw }
}
if (-not $duplicateRejected) { throw 'DUPLICATE_JSON_PROPERTY_ACCEPTED' }

$valid = [pscustomobject]@{
  project_id='PROJECT_A'
  host_id=$env:COMPUTERNAME
  execution_scope='PREPRODUCTION_REVERSIBLE'
  production_allowed=$false
}
Assert-FactoryRequestScope -Request $valid -ExpectedProjectId 'PROJECT_A' -ExpectedHostId $env:COMPUTERNAME | Out-Null

$otherProject = $valid | Select-Object *
$otherProject.project_id='PROJECT_B'
Assert-FactoryRequestScope -Request $otherProject -ExpectedProjectId 'PROJECT_B' -ExpectedHostId $env:COMPUTERNAME | Out-Null

$wrongProject = $valid | Select-Object *
$wrongProject.project_id='PROJECT_B'
Assert-Rejected { Assert-FactoryRequestScope -Request $wrongProject -ExpectedProjectId 'PROJECT_A' -ExpectedHostId $env:COMPUTERNAME } 'REQUEST_PROJECT_MISMATCH'

$wrongHost = $valid | Select-Object *
$wrongHost.host_id='OTHER_HOST'
Assert-Rejected { Assert-FactoryRequestScope -Request $wrongHost -ExpectedProjectId 'PROJECT_A' -ExpectedHostId $env:COMPUTERNAME } 'REQUEST_HOST_MISMATCH'

$production = $valid | Select-Object *
$production.execution_scope='PRODUCTION'
Assert-Rejected { Assert-FactoryRequestScope -Request $production -ExpectedProjectId 'PROJECT_A' -ExpectedHostId $env:COMPUTERNAME } 'PRODUCTION_SCOPE_DENIED'

$productionAllowed = $valid | Select-Object *
$productionAllowed.production_allowed=$true
Assert-Rejected { Assert-FactoryRequestScope -Request $productionAllowed -ExpectedProjectId 'PROJECT_A' -ExpectedHostId $env:COMPUTERNAME } 'PRODUCTION_SCOPE_DENIED'

$root = Join-Path ([IO.Path]::GetTempPath()) ('trusted-caller-' + [Guid]::NewGuid().ToString('N'))
$inbox = Join-Path $root 'inbox'
$queueProbe = Join-Path $root 'queue-probe'
$outside = Join-Path $root 'outside'
New-Item -ItemType Directory -Path $inbox,$queueProbe,$outside -Force | Out-Null
$testTaskSid = 'S-1-5-87-123456789-123456789-123456789-123456789'
$originalQueueAcl = Get-Acl -LiteralPath $queueProbe
try {
  Set-FactoryDirectoryAcl -Path $queueProbe -Mode SYSTEM_ONLY | Out-Null

  $queueAcl = New-Object Security.AccessControl.DirectorySecurity
  $queueAcl.SetAccessRuleProtection($true,$false)
  foreach ($rule in @($queueAcl.Access)) { [void]$queueAcl.RemoveAccessRuleSpecific($rule) }
  foreach ($entry in @(
    @{sid='S-1-5-18';rights=[Security.AccessControl.FileSystemRights]::FullControl},
    @{sid='S-1-5-32-544';rights=[Security.AccessControl.FileSystemRights]::FullControl},
    @{sid=$testTaskSid;rights=[Security.AccessControl.FileSystemRights]::Modify}
  )) {
    $sid = New-Object Security.Principal.SecurityIdentifier($entry.sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,$entry.rights,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    [void]$queueAcl.AddAccessRule($rule)
  }
  [IO.Directory]::SetAccessControl($queueProbe,$queueAcl)
  Assert-FactoryQueueDirectoryAcl -Path $queueProbe -TaskSid @($testTaskSid) -Mode CALLER_MODIFY | Out-Null
  $queueSids = @((Get-Acl -LiteralPath $queueProbe).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
  if ($script:factoryTrustedCallerNetworkServiceSid -in $queueSids) { throw 'SHARED_NETWORK_SERVICE_QUEUE_ACCESS_PRESENT' }

  & (Join-Path $env:SystemRoot 'System32\icacls.exe') $queueProbe '/grant' '*S-1-5-20:(OI)(CI)M' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GENERIC_NETWORK_SERVICE_ACL_INJECTION_FIXTURE_FAILED' }
  Assert-Rejected { Assert-FactoryQueueDirectoryAcl -Path $queueProbe -TaskSid @($testTaskSid) -Mode CALLER_MODIFY } 'TRUSTED_QUEUE_ACL_PRINCIPAL_UNEXPECTED:S-1-5-20'

  $wrongOwnerPath = Join-Path $inbox 'wrong-owner.json'
  [IO.File]::WriteAllText($wrongOwnerPath,'{}',(New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { Assert-TrustedBrokerRequestFile -Path $wrongOwnerPath -InboxPath $inbox -TaskSid $testTaskSid } 'REQUEST_OWNER_INVALID'

  $reparsePath = Join-Path $inbox 'reparse.json'
  try {
    New-Item -ItemType Junction -Path $reparsePath -Target $outside -ErrorAction Stop | Out-Null
  } catch {
    throw ('REPARSE_TEST_FIXTURE_CREATE_FAILED:' + [string]$_.Exception.Message)
  }
  Assert-Rejected { Assert-TrustedBrokerRequestFile -Path $reparsePath -InboxPath $inbox -TaskSid $testTaskSid } 'REQUEST_REPARSE_POINT_DENIED'
} finally {
  & (Join-Path $env:SystemRoot 'System32\icacls.exe') $queueProbe '/reset' | Out-Null
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Output 'TRUSTED_CALLER_BOUNDARY_SMOKE=PASS'
