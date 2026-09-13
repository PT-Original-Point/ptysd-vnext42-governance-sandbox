$ErrorActionPreference='Stop'
$root=Join-Path $PWD 'host\v45\PTYSD.HostGuard'
$manifest=Join-Path $root 'PTYSD.HostGuard.psd1'
$rolePath=Join-Path $root 'RoleCapabilities\PTYSDHostGuard.psrc'
$install=Join-Path $PWD 'scripts\install-v45-hostguard-jea.ps1'
foreach($path in @($manifest,$rolePath,$install)){if(-not(Test-Path -LiteralPath $path)){throw "MISSING=$path"}}
Test-ModuleManifest -Path $manifest -ErrorAction Stop|Out-Null
$role=Import-PowerShellDataFile -Path $rolePath
$expected=@('Get-PTYSDHostGuardStatus','Invoke-PTYSDHostPrepare','Start-PTYSDWorkerVm')
if(@($role.VisibleFunctions).Count -ne 3){throw 'VISIBLE_FUNCTION_COUNT_INVALID'}
foreach($f in $expected){if($f -notin $role.VisibleFunctions){throw "VISIBLE_FUNCTION_MISSING=$f"}}
$errors=$null;$tokens=$null
[Management.Automation.Language.Parser]::ParseFile($install,[ref]$tokens,[ref]$errors)|Out-Null
if($errors.Count -ne 0){throw ('INSTALL_SCRIPT_PARSE_ERRORS='+($errors.Message -join ';'))}
$tmp=Join-Path $env:TEMP ('ptysd-jea-config-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp|Out-Null
try{
  $pssc=Join-Path $tmp 'test.pssc'
  $roles=@{'NT AUTHORITY\NETWORK SERVICE'=@{RoleCapabilities='PTYSDHostGuard'}}
  New-PSSessionConfigurationFile -Path $pssc -SessionType RestrictedRemoteServer -LanguageMode NoLanguage -RunAsVirtualAccount -RunAsVirtualAccountGroups @('BUILTIN\Hyper-V Administrators') -TranscriptDirectory $tmp -RoleDefinitions $roles
  if(-not(Test-PSSessionConfigurationFile -Path $pssc)){throw 'PSSC_TEST_FAILED'}
  Write-Host 'PASS_V45_HOSTGUARD_POWERSHELL51_PACKAGE'
}finally{Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
