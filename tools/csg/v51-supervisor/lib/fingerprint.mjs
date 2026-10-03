import {createHash} from 'node:crypto';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`INVALID_FINGERPRINT_RECORD:${field}`);
  }
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail(`INVALID_FINGERPRINT_TEXT:${field}`);
  }
  return value;
}

function digest(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(`INVALID_FINGERPRINT_SHA256:${field}`);
  }
  return value;
}

function oid(value, field) {
  if (typeof value !== 'string' || !GIT_OID.test(value)) {
    fail(`INVALID_FINGERPRINT_GIT_OID:${field}`);
  }
  return value;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_FINITE_FINGERPRINT_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('UNSUPPORTED_FINGERPRINT_VALUE');
  }
  const keys = Object.keys(value).sort();
  if (keys.some((key) => value[key] === undefined)) fail('UNDEFINED_FINGERPRINT_VALUE');
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function normalizeUpstreamInputs(value) {
  if (!Array.isArray(value)) fail('INVALID_FINGERPRINT_UPSTREAM_INPUTS');
  const inputs = value.map((item, index) => {
    record(item, `upstream_inputs[${index}]`);
    return {
      id: text(item.id, `upstream_inputs[${index}].id`),
      provider: text(item.provider, `upstream_inputs[${index}].provider`),
      resource: text(item.resource, `upstream_inputs[${index}].resource`),
      revision: text(item.revision, `upstream_inputs[${index}].revision`),
      digest: digest(item.digest, `upstream_inputs[${index}].digest`)
    };
  });
  const ids = inputs.map((item) => item.id);
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_FINGERPRINT_UPSTREAM_INPUT');
  return inputs.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

export function logicalWorkPayload(input) {
  record(input, 'input');
  const spec = record(input.current_spec, 'current_spec');
  const mission = record(input.mission, 'mission');
  const contract = record(input.acceptance_contract, 'acceptance_contract');
  const prestate = record(input.canonical_prestate, 'canonical_prestate');

  const checkpointSeq = Number(prestate.checkpoint_seq);
  if (!Number.isSafeInteger(checkpointSeq) || checkpointSeq < 0) {
    fail('INVALID_FINGERPRINT_CHECKPOINT_SEQ');
  }

  return {
    schema: 'VNEXT5_1_R2_LOGICAL_WORK_FINGERPRINT_V1',
    project_id: text(input.project_id, 'project_id'),
    current_spec: {
      revision: text(spec.revision, 'current_spec.revision'),
      digest: digest(spec.digest, 'current_spec.digest')
    },
    mission: {
      revision: text(mission.revision, 'mission.revision'),
      digest: digest(mission.digest, 'mission.digest')
    },
    logical_unit_id: text(input.logical_unit_id, 'logical_unit_id'),
    acceptance_contract: {
      id: text(contract.id, 'acceptance_contract.id'),
      digest: digest(contract.digest, 'acceptance_contract.digest')
    },
    canonical_prestate: {
      control_ref: text(prestate.control_ref, 'canonical_prestate.control_ref'),
      control_head: oid(prestate.control_head, 'canonical_prestate.control_head'),
      pointer_blob_oid: oid(prestate.pointer_blob_oid, 'canonical_prestate.pointer_blob_oid'),
      checkpoint_seq: checkpointSeq,
      checkpoint_digest: digest(prestate.checkpoint_digest, 'canonical_prestate.checkpoint_digest')
    },
    upstream_inputs: normalizeUpstreamInputs(input.upstream_inputs)
  };
}

export function durableFingerprint(input) {
  const canonical = canonicalJson(logicalWorkPayload(input));
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return {
    schema: 'VNEXT5_1_R2_LOGICAL_WORK_FINGERPRINT_V1',
    canonical,
    digest: `sha256:${hex}`
  };
}
