import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as kernel from '../production-kernel.mjs';

const expectedExports = [
  'ADAPTER_ABI_VERSION','ADVISOR_AUTHORITY','ADVISOR_GUARD_VERSION','EFFECT_CLASSES','FACTORY_SPAN_NAMES','INTERFACE_PRECEDENCE',
  'MAX_ATTEMPTS','MAX_TASKS','OBJECTIVE_TRIGGER_CODES','OPENINFERENCE_REFERENCE','OPENCODE_CANARY_CANDIDATE','OPENCODE_VERIFIED_PIN',
  'OTEL_GENAI_REFERENCE','PACKET_LIMITS','POLICY_MIDDLEWARE_VERSION','REQUIRED_CANARY_CASES','STATUS_VIEWS',
  'TELEMETRY_SCHEMA','TELEMETRY_VERSION','VERIFIER_BINDING_SCHEMA',
  'admitVerifierOutcome','assertCapabilityCurrent','buildAdvisorPacket','classifyTelemetryBatch','compileCellCapability',
  'computeVerifierBundleDigest','createAdapterInvocation','createJobSupervisor','createTelemetrySpan','createVerifierBindingReceipt',
  'evaluateAdvisorPermit','evaluateObjectiveAdvisorTriggers','evaluateOpenCodePinPromotion','evaluatePolicyRequest','exportTelemetrySpan',
  'fetchResearchSourceSafely','normalizeAdapterResult','projectStatus','projectStatusSafe','redactTelemetryAttributes',
  'selectNativeAdapter','supervisorDigest','validateBoundedContract','validateResearchArtifacts','validateResearchEnvelope',
  'validateVerifierBindingReceipt',
];

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function walkMjs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMjs(full));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('production kernel is the complete accepted Lean Cell entrypoint', () => {
  for (const name of expectedExports) assert.ok(Object.hasOwn(kernel, name), `missing production-kernel export: ${name}`);
});

test('normal-route scripts may enter cell-kernel only through production-kernel', () => {
  const violations = [];
  for (const file of walkMjs(path.join(repoRoot, 'scripts'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"]([^'"]*cell-kernel\/[^'"]+)['"]/g)) {
      if (!match[1].endsWith('/production-kernel.mjs')) violations.push(`${path.relative(repoRoot,file)} -> ${match[1]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('retired Z5 synthetic CLI wrapper stays deleted from accepted source', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'scripts/z5-run-opencode-synthetic.sh')), false);
});
