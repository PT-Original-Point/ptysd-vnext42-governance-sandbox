import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync(new URL('../ptysd-autonomy-supervisor.ps1',import.meta.url),'utf8');
const r=fs.readFileSync(new URL('../register-autonomy-supervisor.ps1',import.meta.url),'utf8');
test('uses supported noninteractive codex exec with automatic review',()=>{assert.match(s,/exec --json --approve-for-me/);assert.doesNotMatch(s,/exec --json --full-auto/);assert.match(s,/turn\.completed/);});
test('anti-loop state exists',()=>{assert.match(s,/last_dispatched_fingerprint/);assert.match(s,/MaxSameFingerprintRetries/);assert.match(s,/FileShare\]::None/);});
test('provider authority bootstrap exists',()=>{assert.match(s,/Project Directory/);assert.match(s,/canonical control\/checkpoint\/run/);assert.match(s,/Issue #310/);assert.match(s,/PR #316/);});
test('human and unknown-effect gates remain',()=>{assert.match(s,/never redispatch OP025 while UNKNOWN/);assert.match(s,/Production final/);assert.match(s,/OAuth\/MFA/);});
test('scheduled task restart and singleton settings exist',()=>{assert.match(r,/AtStartup/);assert.match(r,/RestartCount 3/);assert.match(r,/MultipleInstances IgnoreNew/);});

test('continuity projection bootstrap is mandatory',()=>{assert.match(s,/governance\/continuity\/CURRENT\.json/);assert.match(s,/immutable snapshot commit\/path/);assert.match(s,/append a new continuity snapshot/);assert.match(s,/never a second control plane/);assert.match(s,/durable fingerprint is unchanged/);});

test('public GitHub provider fallback uses GET when gh is absent',()=>{assert.match(s,/Get-Command gh\.exe -CommandType Application/);assert.match(s,/https:\/\/api\.github\.com/);assert.match(s,/Invoke-RestMethod -Method Get/);assert.match(s,/X-GitHub-Api-Version/);});
test('read-only preflight exits before persistent state writes or Codex dispatch',()=>{const start=s.indexOf('if($ReadOnlyPreflight)');const end=s.indexOf('New-Item -ItemType Directory -Force -Path $StateRoot');assert.ok(start>=0&&end>start);const block=s.slice(start,end);assert.match(block,/Provider-Fingerprint/);assert.match(block,/state_root_mutated=\$false/);assert.doesNotMatch(block,/Start-Job|Write-AtomicJson|New-Item|codex exec/);});
