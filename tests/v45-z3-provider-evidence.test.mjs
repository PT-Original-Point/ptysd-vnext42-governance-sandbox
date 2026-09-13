import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const command = JSON.parse(fs.readFileSync('runs/V45-Z3-CONTROL-001/commands/V45-Z3-COMMAND-001.json', 'utf8'));
const durable = JSON.parse(fs.readFileSync('runs/V45-Z3-CONTROL-001/receipts/001-command-durable-readback.json', 'utf8'));
const cas = JSON.parse(fs.readFileSync('runs/V45-Z3-CONTROL-001/receipts/002-cas-stale-writer-rejected.json', 'utf8'));
const evidence = JSON.parse(fs.readFileSync('runs/V45-Z3-CONTROL-001/evidence/001-provider-durability-cas.json', 'utf8'));
const z3run = JSON.parse(fs.readFileSync('runs/V45-Z3-CONTROL-001/run.json', 'utf8'));
const z3contract = JSON.parse(fs.readFileSync('runs/V45-Z3-CONTROL-001/contract.json', 'utf8'));
const z4run = JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/run.json', 'utf8'));
const z4contract = JSON.parse(fs.readFileSync('runs/V45-Z4-WIP-001/contract.json', 'utf8'));
const control = JSON.parse(fs.readFileSync('governance/v45/control.json', 'utf8'));

const canonical = v => Array.isArray(v) ? v.map(canonical) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hashValue = v => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const contractHash = c => { const x = structuredClone(c); delete x.contract_hash; return hashValue(x); };

test('Z3 durable command is provider-addressable and digest-stable', () => {
  assert.equal(command.command_id, 'V45-Z3-COMMAND-001');
  assert.equal(command.provider_issue_number, 7);
  assert.equal(command.provider_readback_match, true);
  assert.equal(hashValue(command.request), command.request_sha256);
  assert.equal(durable.same_source_readback, 'CONFIRMED');
  assert.equal(durable.readback_matches_request_sha256, true);
  assert.equal(evidence.command_provider_readback, 'CONFIRMED');
});

test('Z3 stale sibling cannot overwrite the provider winner', () => {
  assert.notEqual(cas.writer_a_commit, cas.writer_b_commit);
  assert.equal(cas.writer_a_update, 'SUCCESS');
  assert.equal(cas.writer_b_update, 'REJECTED_422_NON_FAST_FORWARD');
  assert.equal(cas.final_ref_sha, cas.writer_a_commit);
  assert.equal(cas.final_writer, 'WRITER_A');
  assert.equal(cas.final_value, 'A_WINS');
  assert.equal(evidence.cas_final_ref_readback, cas.writer_a_commit);
});

test('Z3 closes only after evidence and Z4 is admitted fail-closed', () => {
  assert.equal(contractHash(z3contract), z3contract.contract_hash);
  assert.equal(z3run.state, 'SUCCEEDED');
  assert.equal(z3run.revision, 2);
  assert.equal(control.z3_acceptance, 'PASS');
  assert.equal(control.active_run_id, 'V45-Z4-WIP-001');
  assert.equal(control.state, 'WAITING_RESOURCE');
  assert.equal(control.wait_reason, 'WORKER_VM_EXECUTION_CHANNEL_UNVERIFIED');
  assert.equal(z4run.state, 'WAITING_RESOURCE');
  assert.equal(z4run.wait_reason, 'WORKER_VM_EXECUTION_CHANNEL_UNVERIFIED');
  assert.equal(contractHash(z4contract), z4contract.contract_hash);
  assert.equal(z4contract.model_profile_ref, 'SYNTHETIC_NOOP');
});
