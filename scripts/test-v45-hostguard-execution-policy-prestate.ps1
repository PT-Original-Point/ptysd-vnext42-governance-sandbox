$ErrorActionPreference='Stop'
$tmp=Join-Path $env:TEMP ('ptysd-jea-ep-prestate-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp|Out-Null
try {
  $omitted=Join-Path $tmp 'omitted.pssc'
  New-PSSessionConfigurationFile -Path $omitted -SessionType RestrictedRemoteServer -LanguageMode NoLanguage
  if(-not(Test-PSSessionConfigurationFile -Path $omitted)){throw 'OMITTED_PSSC_VALIDATION_FAILED'}
  $data=Import-PowerShellDataFile -Path $omitted
  $explicit=$data.ContainsKey('ExecutionPolicy')
  $raw=''
  if($explicit){$raw=[string]$data.ExecutionPolicy}
  $effective=$raw
  if([string]::IsNullOrWhiteSpace($effective)){$effective='Restricted'}
  if($effective -ne 'Restricted'){throw "OMITTED_PSSC_EFFECTIVE_POLICY_NOT_RESTRICTED explicit=$explicit raw=$raw effective=$effective"}

  $bypass=Join-Path $tmp 'bypass.pssc'
  New-PSSessionConfigurationFile -Path $bypass -SessionType RestrictedRemoteServer -LanguageMode NoLanguage -ExecutionPolicy Bypass
  if(-not(Test-PSSessionConfigurationFile -Path $bypass)){throw 'BYPASS_PSSC_VALIDATION_FAILED'}
  $bypassData=Import-PowerShellDataFile -Path $bypass
  if([string]$bypassData.ExecutionPolicy -ne 'Bypass'){throw "BYPASS_PSSC_POLICY_MISMATCH actual=$($bypassData.ExecutionPolicy)"}

  [pscustomobject]@{
    Result='PASS_V45_HOSTGUARD_EXECUTION_POLICY_PRESTATE_SEMANTICS'
    OmittedKeyExplicit=$explicit
    OmittedKeyRaw=$raw
    OmittedKeyEffective=$effective
    ExplicitBypass=[string]$bypassData.ExecutionPolicy
  }|ConvertTo-Json -Depth 3
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
