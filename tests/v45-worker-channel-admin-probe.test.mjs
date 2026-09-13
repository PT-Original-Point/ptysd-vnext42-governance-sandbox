import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script=fs.readFileSync('scripts/probe-v45-worker-channel-admin-readonly.ps1','utf8');

test('admin readonly worker probe is pinned to the exact approved host and historical SSH identity',()=>{
  assert.match(script,/DESKTOP-1B6PD2P/);
  assert.match(script,/172\.31\.253\.10/);
  assert.match(script,/ExpectedGuestUser='ptysd'/);
  assert.match(script,/ExpectedGuestHostname='ptysd-worker-01'/);
  assert.match(script,/C:\\Users\\x\\\.ssh\\ptysd_worker_ed25519/);
  assert.match(script,/C:\\PTYSD\\h03-build\\v21\\ptysd-worker-known_hosts/);
  assert.match(script,/C:\\Users\\x\\\.ssh\\known_hosts/);
  assert.match(script,/C:\\Users\\x\\\.ssh\\known_hosts\.old/);
  assert.match(script,/SHA256:dZDmWE3PnF5vYOaoAsF0N2f1DIlw3E6hIWRWf70G6Gg/);
});

test('known-host selection uses only pre-existing pins and fails closed if none match',()=>{
  assert.match(script,/KnownHostsCandidates/);
  assert.match(script,/ssh-keygen\.exe/);
  assert.match(script,/-F \$ExpectedGuestIp -f \$candidate/);
  assert.match(script,/-F \$ExpectedGuestHostname -f \$candidate/);
  assert.match(script,/SSH_HOST_KEY_PIN_UNAVAILABLE/);
  assert.match(script,/HostKeyAlias=/);
  for(const forbidden of ['ssh-keyscan','StrictHostKeyChecking=no','StrictHostKeyChecking=accept-new','UserKnownHostsFile=NUL','UserKnownHostsFile=/dev/null']){
    assert.equal(script.includes(forbidden),false,`forbidden ${forbidden}`);
  }
});

test('SSH transport is fail-closed and password or host-key bypass is disabled',()=>{
  for(const required of [
    "'BatchMode=yes'",
    "'PasswordAuthentication=no'",
    "'KbdInteractiveAuthentication=no'",
    "'StrictHostKeyChecking=yes'",
    "'IdentitiesOnly=yes'",
    "'ConnectTimeout=5'",
    "'ConnectionAttempts=1'"
  ]) assert.ok(script.includes(required),`missing ${required}`);
});

test('guest payload is inventory-only and contains no mutation or secret-read path',()=>{
  const forbiddenWords=['sudo','apt','apt-get','dnf','yum','tee','mkdir','chmod','chown','rm','mv','cp'];
  for(const word of forbiddenWords){
    const re=new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}([^A-Za-z0-9_-]|$)`,'i');
    assert.equal(re.test(script),false,`forbidden guest mutator ${word}`);
  }
  for(const forbidden of ['authorized_keys','ssh-keygen -R','Start-VM','Stop-VM','Restart-VM','Set-VM','New-VM','Set-NetFirewallRule','New-NetFirewallRule','Remove-NetFirewallRule']){
    assert.equal(script.includes(forbidden),false,`forbidden ${forbidden}`);
  }
  assert.match(script,/cat \/proc\/sys\/kernel\/random\/boot_id/);
  assert.match(script,/systemd --version/);
  assert.match(script,/cgroup\.controllers/);
  assert.match(script,/podman --version/);
  assert.match(script,/opencode --version/);
  assert.match(script,/WORKERCTL=/);
});

test('probe reports exact trust source and explicit zero-effect boundaries',()=>{
  for(const marker of ['KnownHostsSource=$KnownHosts','HostKeyAlias=$HostKeyAlias','GuestMutation=$false','VmMutation=$false','ProviderMutation=$false','BusinessProjectEffect=$false','ProductionEffect=$false']){
    assert.ok(script.includes(marker),`missing ${marker}`);
  }
  assert.match(script,/PASS_V45_WORKER_CHANNEL_ADMIN_READONLY_PRESTATE/);
});

test('RDC SYSTEM context can fall back to the fixed Git for Windows OpenSSH toolchain',()=>{
  assert.match(script,/OpenSshCandidates/);
  assert.match(script,/WINDOWS_OPENSSH/);
  assert.match(script,/GIT_FOR_WINDOWS_OPENSSH/);
  assert.match(script,/C:\\Program Files\\Git\\usr\\bin\\ssh\.exe/);
  assert.match(script,/C:\\Program Files\\Git\\usr\\bin\\ssh-keygen\.exe/);
  assert.match(script,/OPENSSH_TOOLCHAIN_UNAVAILABLE_OR_FINGERPRINT_UNREADABLE/);
  assert.match(script,/OpenSshToolchain=\$OpenSsh\.Name/);
});
