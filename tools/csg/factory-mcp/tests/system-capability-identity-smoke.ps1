$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\broker\system-capability-identity.ps1')

$key = Get-PTYSDSystemOperationKey -ProjectId 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' -CapabilityId 'CAP-GOV-SYSTEM-V1' -OperationId 'OP025'
if ($key -notmatch '^[0-9a-f]{64}$') { throw 'SYSTEM_OPERATION_KEY_INVALID' }
if ($key -cne 'da82087da41e5b7ffa98a36b9ae172253ccaebd644f547baca3c656f246d616f') { throw 'SYSTEM_OPERATION_KEY_CROSS_RUNTIME_VECTOR_MISMATCH' }
if ($key -cne (Get-PTYSDSystemOperationKey -ProjectId 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' -CapabilityId 'CAP-GOV-SYSTEM-V1' -OperationId 'OP025')) { throw 'SYSTEM_OPERATION_KEY_NOT_STABLE' }
if ($key -cne (Get-PTYSDSystemOperationKey -ProjectId 'chatgpt_global_skill_governance' -CapabilityId 'cap-gov-system-v1' -OperationId 'op025')) { throw 'SYSTEM_OPERATION_KEY_CASE_CANONICALIZATION_MISMATCH' }

$temp = Join-Path ([IO.Path]::GetTempPath()) ('ptysd-system-owner-' + [Guid]::NewGuid().ToString('N') + '.tmp')
try {
  [IO.File]::WriteAllText($temp, 'read-only-identity-smoke')
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $actualSid = Assert-PTYSDTrustedRequestOwner -Path $temp -ExpectedSid $currentSid
  if ($actualSid -cne $currentSid) { throw 'SYSTEM_CALLER_OWNER_MISMATCH' }
  try {
    $wrongSid = if ($currentSid -ceq 'S-1-5-20') { 'S-1-5-18' } else { 'S-1-5-20' }
    Assert-PTYSDTrustedRequestOwner -Path $temp -ExpectedSid $wrongSid | Out-Null
    throw 'SYSTEM_CALLER_MISMATCH_WAS_ACCEPTED'
  } catch {
    if ($_.Exception.Message -cne 'SYSTEM_CAPABILITY_CALLER_DENY') { throw }
  }
} finally {
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}

'SYSTEM_CAPABILITY_IDENTITY_SMOKE=PASS'
