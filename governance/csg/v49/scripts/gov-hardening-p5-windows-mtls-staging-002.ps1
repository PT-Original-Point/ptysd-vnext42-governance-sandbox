Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$sourceHead='1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$candidateHead='b03e2c43c2c600cb11aeed17d59fa93f7c0510ae'
$root=Join-Path 'C:\ProgramData\PTYSD\MCP\P5Staging' $sourceHead
$factory=Join-Path $root 'tools\csg\factory-mcp'
$tests=Join-Path $factory 'tests'
$harness=Join-Path $tests 'windows-mtls-staging.mjs'
$tmp=$harness+'.tmp'
$fixture=Join-Path $root 'mtls-fixture-a42'
$git='C:\Program Files\Git\cmd\git.exe'
$expectedHarnessBlob='ee1c554c509f13d76f9b233bd424dce55c517492'
$expectedPackageSha='7b94fb9fc45bc6f4da6ab9edf79231ec69880313f24af1aea483d16bea611db2'
$expectedLockSha='89cea9a71f4f91d7e15f58495e43c16fa5726c18367176588551867dc5e32c46'
$url='https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox/'+$candidateHead+'/tools/csg/factory-mcp/tests/windows-mtls-staging.mjs'
if(!(Test-Path -LiteralPath $factory -PathType Container)){throw 'P5_STAGE_SOURCE_MISSING'}
if(!(Test-Path -LiteralPath $git -PathType Leaf)){throw 'P5_STAGE_GIT_MISSING'}
$package=Join-Path $factory 'package.json'
$lock=Join-Path $factory 'package-lock.json'
if(!(Test-Path -LiteralPath $package -PathType Leaf)){throw 'P5_STAGE_PACKAGE_MISSING'}
if(!(Test-Path -LiteralPath $lock -PathType Leaf)){throw 'P5_STAGE_LOCK_MISSING'}
if((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedPackageSha){throw 'P5_STAGE_PACKAGE_HASH_MISMATCH'}
if((Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedLockSha){throw 'P5_STAGE_LOCK_HASH_MISMATCH'}
if(!(Test-Path -LiteralPath (Join-Path $factory 'node_modules') -PathType Container)){throw 'P5_STAGE_NODE_MODULES_MISSING'}
if(Test-Path -LiteralPath $fixture){throw 'P5_STAGE_FIXTURE_PREEXISTS'}
$node=@('C:\Program Files\nodejs\node.exe','C:\ProgramData\PTYSD\Runtime\node\node.exe')|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}|Select-Object -First 1
if(!$node){throw 'P5_STAGE_NODE_MISSING'}
if(Test-Path -LiteralPath $harness -PathType Leaf){
  $blob=(& $git hash-object -- $harness 2>$null).Trim()
  if($LASTEXITCODE -ne 0 -or $blob -ne $expectedHarnessBlob){throw 'P5_STAGE_EXISTING_HARNESS_MISMATCH'}
}else{
  if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force}
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 20
  $blob=(& $git hash-object -- $tmp 2>$null).Trim()
  if($LASTEXITCODE -ne 0 -or $blob -ne $expectedHarnessBlob){Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue;throw 'P5_STAGE_HARNESS_BLOB_MISMATCH'}
  Move-Item -LiteralPath $tmp -Destination $harness -Force
}
$env:P5_MTLS_FIXTURE_DIR=$fixture
Push-Location $factory
try{
  $raw=@(& $node $harness 2>&1)
  $exit=$LASTEXITCODE
}finally{Pop-Location}
if($exit -ne 0){throw ('P5_STAGE_HARNESS_EXIT_'+$exit)}
$line=@($raw|ForEach-Object{[string]$_}|Where-Object{$_ -match '^\{.*\}$'}|Select-Object -Last 1)
if($line.Count -ne 1){throw 'P5_STAGE_HARNESS_JSON_MISSING'}
$j=$line[0]|ConvertFrom-Json -ErrorAction Stop
if($j.result -ne 'PASS' -or $j.private_keys_removed -ne $true -or [int]$j.private_key_count_after -ne 0){throw 'P5_STAGE_HARNESS_RESULT_INVALID'}
if(!(Test-Path -LiteralPath $fixture -PathType Container)){throw 'P5_STAGE_FIXTURE_RESULT_MISSING'}
$keyCount=@(Get-ChildItem -LiteralPath $fixture -Force -File -Filter *.key -ErrorAction SilentlyContinue).Count
if($keyCount -ne 0){throw 'P5_STAGE_PRIVATE_KEY_RESIDUE'}
[ordered]@{
 schema='v49.p5.windows-mtls-host-staging.v2'
 result='PASS'
 source_head=$sourceHead
 candidate_head=$candidateHead
 runtime_source_equivalent=$true
 candidate_delta='HARNESS_AND_WORKFLOW_ONLY'
 harness_git_blob=$expectedHarnessBlob
 stage_root=$root
 fixture_dir=$fixture
 package_sha256=$expectedPackageSha
 lock_sha256=$expectedLockSha
 node_path=$node
 openssl_path=$j.openssl_path
 cert_chain_verify_pass=[bool]$j.cert_chain_verify_pass
 modern_mtls_integration_pass=[bool]$j.modern_mtls_integration_pass
 private_keys_removed=[bool]$j.private_keys_removed
 private_key_count_after=[int]$j.private_key_count_after
 remaining_nonsecret_files=$j.remaining_nonsecret_files
 p4_files_mutated=$false
 observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 6 -Compress
