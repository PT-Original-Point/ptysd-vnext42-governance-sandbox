Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$stage='C:\ProgramData\PTYSD\MCP\P5Staging\1f44bb9927cbc8b765d223c84d38757b0dd6c7e8'
$factory=Join-Path $stage 'tools\csg\factory-mcp'
$canary=Join-Path $factory 'tests\trusted-caller-live-canary.mjs'
$tmp=$canary+'.download';$out=$canary+'.live.out';$err=$canary+'.live.err'
$root=Join-Path $stage 'trusted-caller-live-a56'
$url='https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox/734b881a0921c67685aaccc1bdbada791cb4032c/tools/csg/factory-mcp/tests/trusted-caller-live-canary.mjs'
$expected='6abf96e35f67ce851ee7acb783ecc35a1aac1e757731f73862790635f9f266d8'
if(!(Test-Path -LiteralPath $factory -PathType Container)){throw 'P5_TRUSTED_FACTORY_MISSING'}
if(!(Test-Path -LiteralPath (Join-Path $factory 'node_modules') -PathType Container)){throw 'P5_TRUSTED_NODE_MODULES_MISSING'}
if(Test-Path -LiteralPath $root){throw 'P5_TRUSTED_CANARY_ROOT_PREEXISTS'}
foreach($p in @($canary,$tmp,$out,$err)){if(Test-Path -LiteralPath $p){throw ('P5_TRUSTED_CANARY_PATH_PREEXISTS:'+([IO.Path]::GetFileName($p)))}}
$node=@('C:\Program Files\nodejs\node.exe','C:\ProgramData\PTYSD\Runtime\node\node.exe')|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}|Select-Object -First 1
if(!$node){throw 'P5_TRUSTED_NODE_MISSING'}
$curl=(Get-Command curl.exe -ErrorAction Stop).Source
try{
 & $curl -fsSL --connect-timeout 10 --max-time 30 --retry 1 -o $tmp $url
 if($LASTEXITCODE-ne 0){throw ('P5_TRUSTED_CANARY_DOWNLOAD_FAILED:'+ $LASTEXITCODE)}
 $got=(Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
 if($got-ne $expected){throw ('P5_TRUSTED_CANARY_HASH_MISMATCH:'+ $got)}
 Move-Item -LiteralPath $tmp -Destination $canary
 $env:P5_TRUSTED_CANARY_DIR=$root
 $p=Start-Process -FilePath $node -ArgumentList @($canary) -WorkingDirectory $factory -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
 $stdout=if(Test-Path $out){Get-Content $out -Raw}else{''}
 $stderr=if(Test-Path $err){Get-Content $err -Raw}else{''}
 if($p.ExitCode-ne 0){$tail=$stderr;if($tail.Length-gt 1800){$tail=$tail.Substring($tail.Length-1800)};throw ('P5_TRUSTED_CANARY_EXIT_'+$p.ExitCode+':'+$tail)}
 $line=@(($stdout -split '\r?\n')|Where-Object{$_ -match '^\{.*\}$'}|Select-Object -Last 1)
 if($line.Count-ne 1){throw 'P5_TRUSTED_CANARY_JSON_MISSING'}
 $q=$line[0]|ConvertFrom-Json -ErrorAction Stop
 if($q.result-ne 'PASS'){throw 'P5_TRUSTED_CANARY_RESULT_INVALID'}
 if($q.cleanup_complete-ne $true -or [int]$q.private_key_count_after-ne 0){throw 'P5_TRUSTED_CANARY_CLEANUP_INVALID'}
 if($null-eq $q.inner_hostguard_dispatch_count -or [int]$q.inner_hostguard_dispatch_count-ne 0){throw 'P5_TRUSTED_CANARY_INNER_DISPATCH_DETECTED'}
 if(Test-Path -LiteralPath $root){throw 'P5_TRUSTED_CANARY_ROOT_REMAINS'}
 [ordered]@{schema='v49.p5.trusted-caller-live-host-canary.v1';result='PASS';candidate_head='734b881a0921c67685aaccc1bdbada791cb4032c';canary_sha256=$expected;canary_result=$q;p4_files_mutated=$false;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 10 -Compress
}finally{
 foreach($p in @($tmp,$canary,$out,$err)){Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue}
}
