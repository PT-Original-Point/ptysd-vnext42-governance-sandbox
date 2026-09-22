Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$sourceHead='1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$candidateHead='b03e2c43c2c600cb11aeed17d59fa93f7c0510ae'
$root=Join-Path 'C:\ProgramData\PTYSD\MCP\P5Staging' $sourceHead
$factory=Join-Path $root 'tools\csg\factory-mcp'
$harness=Join-Path $factory 'tests\windows-mtls-staging.mjs'
$tmp=$harness+'.offline.tmp'
$fixture=Join-Path $root 'mtls-fixture-a45'
$expectedHarnessSha='c732d8bc4c4788a1d0f4ca30efbe0ba4ed6ac457f2e0d2d6617ebd3ced3fb583'
$expectedPackageSha='7b94fb9fc45bc6f4da6ab9edf79231ec69880313f24af1aea483d16bea611db2'
$expectedLockSha='89cea9a71f4f91d7e15f58495e43c16fa5726c18367176588551867dc5e32c46'
$harnessGzipB64='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'
if(!(Test-Path -LiteralPath $factory -PathType Container)){throw 'P5_OFFLINE_STAGE_SOURCE_MISSING'}
$package=Join-Path $factory 'package.json';$lock=Join-Path $factory 'package-lock.json'
if(!(Test-Path -LiteralPath $package -PathType Leaf)){throw 'P5_OFFLINE_STAGE_PACKAGE_MISSING'}
if(!(Test-Path -LiteralPath $lock -PathType Leaf)){throw 'P5_OFFLINE_STAGE_LOCK_MISSING'}
if((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedPackageSha){throw 'P5_OFFLINE_STAGE_PACKAGE_HASH_MISMATCH'}
if((Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedLockSha){throw 'P5_OFFLINE_STAGE_LOCK_HASH_MISMATCH'}
if(!(Test-Path -LiteralPath (Join-Path $factory 'node_modules') -PathType Container)){throw 'P5_OFFLINE_STAGE_NODE_MODULES_MISSING'}
if(Test-Path -LiteralPath $fixture){throw 'P5_OFFLINE_STAGE_FIXTURE_PREEXISTS'}
$node=@('C:\Program Files\nodejs\node.exe','C:\ProgramData\PTYSD\Runtime\node\node.exe')|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}|Select-Object -First 1
if(!$node){throw 'P5_OFFLINE_STAGE_NODE_MISSING'}
if(!(Test-Path -LiteralPath $harness -PathType Leaf)){
  if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force}
  $ms=New-Object IO.MemoryStream(,[Convert]::FromBase64String($harnessGzipB64));$gz=New-Object IO.Compression.GzipStream($ms,[IO.Compression.CompressionMode]::Decompress);$out=[IO.File]::Create($tmp)
  try{$gz.CopyTo($out)}finally{$out.Dispose();$gz.Dispose();$ms.Dispose()}
  if((Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHarnessSha){Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue;throw 'P5_OFFLINE_STAGE_EMBEDDED_HARNESS_HASH_MISMATCH'}
  Move-Item -LiteralPath $tmp -Destination $harness -Force
}elseif((Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHarnessSha){throw 'P5_OFFLINE_STAGE_EXISTING_HARNESS_HASH_MISMATCH'}
$env:P5_MTLS_FIXTURE_DIR=$fixture
Push-Location $factory
try{$raw=@(& $node $harness 2>&1);$exit=$LASTEXITCODE}finally{Pop-Location}
if($exit -ne 0){throw ('P5_OFFLINE_STAGE_HARNESS_EXIT_'+$exit)}
$line=@($raw|ForEach-Object{[string]$_}|Where-Object{$_ -match '^\{.*\}$'}|Select-Object -Last 1)
if($line.Count -ne 1){throw 'P5_OFFLINE_STAGE_HARNESS_JSON_MISSING'}
$j=$line[0]|ConvertFrom-Json -ErrorAction Stop
if($j.result -ne 'PASS' -or $j.private_keys_removed -ne $true -or [int]$j.private_key_count_after -ne 0){throw 'P5_OFFLINE_STAGE_HARNESS_RESULT_INVALID'}
if(!(Test-Path -LiteralPath $fixture -PathType Container)){throw 'P5_OFFLINE_STAGE_FIXTURE_RESULT_MISSING'}
$keyCount=@(Get-ChildItem -LiteralPath $fixture -Force -File -Filter *.key -ErrorAction SilentlyContinue).Count
if($keyCount -ne 0){throw 'P5_OFFLINE_STAGE_PRIVATE_KEY_RESIDUE'}
[ordered]@{schema='v49.p5.windows-mtls-host-staging.v3';result='PASS';source_head=$sourceHead;candidate_head=$candidateHead;transport='OFFLINE_EMBEDDED_GZIP_HARNESS';harness_sha256=$expectedHarnessSha;fixture_dir=$fixture;package_sha256=$expectedPackageSha;lock_sha256=$expectedLockSha;node_path=$node;openssl_path=$j.openssl_path;cert_chain_verify_pass=[bool]$j.cert_chain_verify_pass;modern_mtls_integration_pass=[bool]$j.modern_mtls_integration_pass;private_keys_removed=[bool]$j.private_keys_removed;private_key_count_after=[int]$j.private_key_count_after;remaining_nonsecret_files=$j.remaining_nonsecret_files;p4_files_mutated=$false;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 6 -Compress
