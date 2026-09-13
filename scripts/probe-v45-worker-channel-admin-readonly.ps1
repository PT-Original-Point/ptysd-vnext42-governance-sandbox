param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$SourceCommit
)

$ErrorActionPreference='Stop'
$ExpectedHost='DESKTOP-1B6PD2P'
$ExpectedGuestIp='172.31.253.10'
$ExpectedGuestUser='ptysd'
$ExpectedGuestHostname='ptysd-worker-01'
$PrivateKey='C:\Users\x\.ssh\ptysd_worker_ed25519'
$PublicKey='C:\Users\x\.ssh\ptysd_worker_ed25519.pub'
$ExpectedFingerprint='SHA256:dZDmWE3PnF5vYOaoAsF0N2f1DIlw3E6hIWRWf70G6Gg'
$KnownHostsCandidates=@(
  'C:\PTYSD\h03-build\v21\ptysd-worker-known_hosts',
  'C:\Users\x\.ssh\known_hosts',
  'C:\Users\x\.ssh\known_hosts.old'
)

$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_SHELL_REQUIRED'}
if($env:COMPUTERNAME -ne $ExpectedHost){throw "HOST_ID_MISMATCH expected=$ExpectedHost actual=$env:COMPUTERNAME"}

foreach($path in @($PrivateKey,$PublicKey)){
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "REQUIRED_SSH_MATERIAL_UNAVAILABLE path=$path"}
  if((Get-Item -LiteralPath $path -ErrorAction Stop).Length -le 0){throw "REQUIRED_SSH_MATERIAL_EMPTY path=$path"}
}

$OpenSshCandidates=@(
  [pscustomobject]@{Name='WINDOWS_OPENSSH';Ssh='C:\Windows\System32\OpenSSH\ssh.exe';Keygen='C:\Windows\System32\OpenSSH\ssh-keygen.exe'},
  [pscustomobject]@{Name='GIT_FOR_WINDOWS_OPENSSH';Ssh='C:\Program Files\Git\usr\bin\ssh.exe';Keygen='C:\Program Files\Git\usr\bin\ssh-keygen.exe'}
)
$OpenSsh=$null
$fingerprintText=$null
foreach($candidate in $OpenSshCandidates){
  if(-not(Test-Path -LiteralPath $candidate.Ssh -PathType Leaf)){continue}
  if(-not(Test-Path -LiteralPath $candidate.Keygen -PathType Leaf)){continue}
  $candidateFingerprint=(& $candidate.Keygen -lf $PublicKey -E sha256 2>&1 | Out-String).Trim()
  $candidateExit=$LASTEXITCODE
  if($candidateExit -ne 0){continue}
  if($candidateFingerprint -notmatch [regex]::Escape($ExpectedFingerprint)){continue}
  $OpenSsh=$candidate
  $fingerprintText=$candidateFingerprint
  break
}
if($null -eq $OpenSsh){throw 'OPENSSH_TOOLCHAIN_UNAVAILABLE_OR_FINGERPRINT_UNREADABLE'}
$keygen=$OpenSsh.Keygen
$ssh=$OpenSsh.Ssh

$KnownHosts=$null
$HostKeyAlias=$null
foreach($candidate in $KnownHostsCandidates){
  if(-not(Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
  if((Get-Item -LiteralPath $candidate -ErrorAction Stop).Length -le 0){continue}

  $null=& $keygen -F $ExpectedGuestIp -f $candidate 2>$null
  if($LASTEXITCODE -eq 0){
    $KnownHosts=$candidate
    $HostKeyAlias=$null
    break
  }

  $null=& $keygen -F $ExpectedGuestHostname -f $candidate 2>$null
  if($LASTEXITCODE -eq 0){
    $KnownHosts=$candidate
    $HostKeyAlias=$ExpectedGuestHostname
    break
  }
}

if([string]::IsNullOrWhiteSpace($KnownHosts)){
  throw ('SSH_HOST_KEY_PIN_UNAVAILABLE candidates='+($KnownHostsCandidates -join ';'))
}

$knownHostsHash=(Get-FileHash -LiteralPath $KnownHosts -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
$knownHostsBytes=(Get-Item -LiteralPath $KnownHosts -ErrorAction Stop).Length

$remote=@'
printf 'PTYSD_WORKER_CHANNEL_OK\n'
printf 'USER='; id -un
printf 'HOSTNAME='; hostname
printf 'BOOT_ID='; cat /proc/sys/kernel/random/boot_id
. /etc/os-release 2>/dev/null
printf 'OS_ID=%s\n' "${ID:-}"
printf 'OS_VERSION_ID=%s\n' "${VERSION_ID:-}"
printf 'KERNEL='; uname -r
printf 'SYSTEMD='; systemd --version | head -n 1
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then echo 'CGROUP_V2=true'; else echo 'CGROUP_V2=false'; fi
if command -v podman >/dev/null 2>&1; then printf 'PODMAN='; podman --version; else echo 'PODMAN=ABSENT'; fi
if command -v git >/dev/null 2>&1; then printf 'GIT='; git --version; else echo 'GIT=ABSENT'; fi
if command -v node >/dev/null 2>&1; then printf 'NODE='; node --version; else echo 'NODE=ABSENT'; fi
if command -v opencode >/dev/null 2>&1; then printf 'OPENCODE='; opencode --version; else echo 'OPENCODE=ABSENT'; fi
if command -v ptysd-workerctl >/dev/null 2>&1; then printf 'WORKERCTL='; command -v ptysd-workerctl; elif [ -x /usr/local/sbin/ptysd-workerctl ]; then echo 'WORKERCTL=/usr/local/sbin/ptysd-workerctl'; else echo 'WORKERCTL=ABSENT'; fi
if command -v loginctl >/dev/null 2>&1; then printf 'LINGER='; loginctl show-user ptysd -p Linger --value 2>/dev/null || echo UNKNOWN; else echo 'LINGER=UNKNOWN'; fi
'@

$sshArgs=@(
  '-4',
  '-o','BatchMode=yes',
  '-o','PasswordAuthentication=no',
  '-o','KbdInteractiveAuthentication=no',
  '-o','StrictHostKeyChecking=yes',
  '-o',("UserKnownHostsFile=$KnownHosts"),
  '-o',("IdentityFile=$PrivateKey"),
  '-o','IdentitiesOnly=yes',
  '-o','ConnectTimeout=5',
  '-o','ConnectionAttempts=1'
)
if(-not [string]::IsNullOrWhiteSpace($HostKeyAlias)){
  $sshArgs+=@('-o',("HostKeyAlias=$HostKeyAlias"))
}
$sshArgs+=@(
  ("$ExpectedGuestUser@$ExpectedGuestIp"),
  $remote
)

$raw=@(& $ssh @sshArgs 2>&1)
$exitCode=$LASTEXITCODE
if($exitCode -ne 0){
  $safeError=($raw | ForEach-Object {[string]$_}) -join ' | '
  throw "SSH_READONLY_PRESTATE_FAILED exit=$exitCode output=$safeError"
}

$values=@{}
foreach($lineObject in $raw){
  $line=[string]$lineObject
  if($line -eq 'PTYSD_WORKER_CHANNEL_OK'){$values['MARKER']=$line;continue}
  $eq=$line.IndexOf('=')
  if($eq -gt 0){$values[$line.Substring(0,$eq)]=$line.Substring($eq+1)}
}

if($values['MARKER'] -ne 'PTYSD_WORKER_CHANNEL_OK'){throw 'GUEST_MARKER_MISSING'}
if($values['USER'] -ne $ExpectedGuestUser){throw "GUEST_USER_MISMATCH actual=$($values['USER'])"}
if($values['HOSTNAME'] -ne $ExpectedGuestHostname){throw "GUEST_HOSTNAME_MISMATCH actual=$($values['HOSTNAME'])"}
if([string]$values['BOOT_ID'] -notmatch '^[0-9a-fA-F-]{36}$'){throw "GUEST_BOOT_ID_INVALID actual=$($values['BOOT_ID'])"}

[pscustomobject]@{
  Result='PASS_V45_WORKER_CHANNEL_ADMIN_READONLY_PRESTATE'
  SourceCommit=$SourceCommit
  Host=$env:COMPUTERNAME
  GuestIp=$ExpectedGuestIp
  GuestUser=$values['USER']
  GuestHostname=$values['HOSTNAME']
  GuestBootId=$values['BOOT_ID']
  OsId=$values['OS_ID']
  OsVersionId=$values['OS_VERSION_ID']
  Kernel=$values['KERNEL']
  Systemd=$values['SYSTEMD']
  CgroupV2=($values['CGROUP_V2'] -eq 'true')
  Podman=$values['PODMAN']
  Git=$values['GIT']
  Node=$values['NODE']
  OpenCode=$values['OPENCODE']
  Workerctl=$values['WORKERCTL']
  Linger=$values['LINGER']
  SshPublicKeyFingerprint=$ExpectedFingerprint
  OpenSshToolchain=$OpenSsh.Name
  SshBinary=$ssh
  SshKeygenBinary=$keygen
  KnownHostsSource=$KnownHosts
  HostKeyAlias=$HostKeyAlias
  KnownHostsSha256=$knownHostsHash
  KnownHostsBytes=$knownHostsBytes
  GuestMutation=$false
  VmMutation=$false
  ProviderMutation=$false
  BusinessProjectEffect=$false
  ProductionEffect=$false
}|ConvertTo-Json -Depth 4
