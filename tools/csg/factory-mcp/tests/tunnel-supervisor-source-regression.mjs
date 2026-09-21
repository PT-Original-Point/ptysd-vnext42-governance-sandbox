import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runTunnel = await readFile(new URL('../windows/run-tunnel.ps1', import.meta.url), 'utf8');
const install = await readFile(new URL('../windows/install-broker.ps1', import.meta.url), 'utf8');
const upgrade = await readFile(new URL('../windows/upgrade-host-powershell.ps1', import.meta.url), 'utf8');
const broker = await readFile(new URL('../broker/hostguard-broker.ps1', import.meta.url), 'utf8');
const index = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8');
const invoke = await readFile(new URL('../src/invoke-hostguard.ps1', import.meta.url), 'utf8');

assert.match(runTunnel, /while \(\$true\)/);
assert.match(runTunnel, /tunnel-supervisor\.json/);
assert.match(runTunnel, /TUNNEL_CLIENT_NONZERO_EXIT/);
assert.match(runTunnel, /Start-Sleep -Seconds \$delaySeconds/);
assert.match(runTunnel, /run --profile-file \$profile/);

assert.match(install, /RestartCount 255/);

assert.match(upgrade, /function Wait-TunnelReady/);
assert.match(upgrade, /\/health\/control-plane/);
assert.match(upgrade, /commands_poll_last_successful_timestamp_seconds/);
assert.match(upgrade, /metrics_compat/);
assert.match(upgrade, /factory-mcp-host-powershell-upgrade-result\.json/);
assert.match(upgrade, /FAILED_ROLLED_BACK_READY/);
assert.match(upgrade, /operationalTunnelRunner/);
assert.match(upgrade, /Wait-TunnelReady -Seconds 120/);

assert.match(broker, /function Get-TunnelLaneStatus/);
assert.match(broker, /commands_poll_last_successful_timestamp_seconds/);
assert.match(broker, /control_plane_probe_mode/);
assert.match(broker, /metrics_compat/);
assert.match(broker, /function Get-CloudflareIdentityReadback/);
assert.match(broker, /https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\?per_page=50/);
assert.match(broker, /provider_verified/);
assert.doesNotMatch(broker, /api_token\s*=/i);

assert.match(index, /factoryStatusInput/);
assert.match(index, /cloudflare_identity/);
assert.match(index, /readOnlyHint: true/);


assert.equal((invoke.match(/\[CmdletBinding\(\)\]/g) ?? []).length, 1);
assert.match(invoke, /\[string\]\$Probe = 'factory'/);
assert.match(invoke, /probe = if \(\$Operation -eq 'status'\)/);
assert.equal((broker.match(/function Get-TunnelControlPlanePollStatus/g) ?? []).length, 1);
assert.equal((broker.match(/function Get-TunnelLaneStatus/g) ?? []).length, 1);
assert.equal((broker.match(/function Get-CloudflareIdentityReadback/g) ?? []).length, 1);
assert.equal((broker.match(/function Process-Request/g) ?? []).length, 1);
assert.equal((upgrade.match(/function Get-TunnelControlPlanePollStatus/g) ?? []).length, 1);
assert.equal((upgrade.match(/function Wait-TunnelReady/g) ?? []).length, 1);
assert.equal((upgrade.match(/function Invoke-SystemHostExecSelfTest/g) ?? []).length, 1);
assert.match(install, /tests\\tunnel-supervisor-source-regression\.mjs/);
assert.match(install, /windows\\upgrade-host-powershell\.ps1/);

console.log('FACTORY_MCP_TUNNEL_SUPERVISOR_SOURCE_REGRESSION=PASS');
