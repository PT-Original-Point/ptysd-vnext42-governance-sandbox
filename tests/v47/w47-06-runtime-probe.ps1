$ErrorActionPreference='Stop'
if($env:RUNNER_NAME -ne 'PTYSD-V45-CONTROL-01'){throw "RUNNER_ID_MISMATCH actual=$env:RUNNER_NAME"}
$ssh='C:\Windows\System32\OpenSSH\ssh.exe'
$key='C:\Users\x\.ssh\ptysd_worker_ed25519'
$knownCandidates=@('C:\PTYSD\h03-build\v21\ptysd-worker-known_hosts','C:\Users\x\.ssh\known_hosts','C:\Users\x\.ssh\known_hosts.old')
$known=$knownCandidates | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
if(-not(Test-Path -LiteralPath $ssh)){throw 'SSH_MISSING'}
if(-not(Test-Path -LiteralPath $key)){throw 'SSH_KEY_MISSING'}
if([string]::IsNullOrWhiteSpace($known)){throw 'KNOWN_HOSTS_MISSING'}
$remote=@'
set -eu
printf 'W47_06_RUNTIME_PROBE=PASS\n'
printf 'BOOT_ID='; cat /proc/sys/kernel/random/boot_id
printf 'PODMAN='; podman --version
printf 'CGROUP='; test -f /sys/fs/cgroup/cgroup.controllers && echo v2 || echo other
printf 'ROOTLESS='; podman info --format '{{.Host.Security.Rootless}}'
printf 'CGROUP_MANAGER='; podman info --format '{{.Host.CgroupManager}}'
printf 'IMAGES_BEGIN\n'
podman images --digests --no-trunc --format '{{.Repository}}|{{.Tag}}|{{.Digest}}|{{.ID}}'
printf 'IMAGES_END\n'
'@
$args=@('-4','-o','BatchMode=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$known",'-o',"IdentityFile=$key",'-o','IdentitiesOnly=yes','-o','ConnectTimeout=5','-o','ConnectionAttempts=1','ptysd@172.31.253.10',$remote)
& $ssh @args
if($LASTEXITCODE -ne 0){throw "SSH_PROBE_FAILED exit=$LASTEXITCODE"}
