import {createHash} from 'node:crypto';
import {canonicalJson} from './fingerprint.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;
const REQUIRED_CAPABILITIES = Object.freeze([
  'TASK_PREPARE',
  'TASK_START',
  'TASK_CANCEL',
  'TASK_RECEIPT_READ',
  'SANDBOX_PROOF_READ'
]);
const RECEIPT_STATES = new Set(['NOT_FOUND_CONFIRMED', 'QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function record(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function text(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(code);
  return value;
}

function digest(value, code) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code);
  return value;
}

function identityPayload(input) {
  const identity = record(input, 'F01_TASK_IDENTITY_REQUIRED');
  const attemptEpoch = Number(identity.attempt_epoch);
  const checkpointSeq = Number(identity.checkpoint_seq);
  if (identity.project_id !== 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' ||
      !Number.isSafeInteger(attemptEpoch) || attemptEpoch < 1 ||
      !Number.isSafeInteger(checkpointSeq) || checkpointSeq < 0 ||
      !GIT_OID.test(identity.control_head || '')) fail('F01_TASK_IDENTITY_INVALID');
  return {
    project_id: identity.project_id,
    operation_id: text(identity.operation_id, 'F01_OPERATION_ID_REQUIRED'),
    run_id: text(identity.run_id, 'F01_RUN_ID_REQUIRED'),
    task_id: text(identity.task_id, 'F01_TASK_ID_REQUIRED'),
    attempt_id: text(identity.attempt_id, 'F01_ATTEMPT_ID_REQUIRED'),
    attempt_epoch: attemptEpoch,
    control_head: identity.control_head,
    checkpoint_seq: checkpointSeq,
    logical_work_fingerprint: digest(identity.logical_work_fingerprint, 'F01_WORK_FINGERPRINT_INVALID')
  };
}

function identityDigest(identity) {
  return `sha256:${createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex')}`;
}

function proofReference(proof, prefix) {
  record(proof, `${prefix}_PROOF_REQUIRED`);
  text(proof.ref, `${prefix}_PROOF_REF_REQUIRED`);
  digest(proof.sha256, `${prefix}_PROOF_DIGEST_INVALID`);
  return {ref: proof.ref, sha256: proof.sha256};
}

function routePayload(input, freshness) {
  const route = record(input, 'F01_ROUTE_OBSERVATION_REQUIRED');
  const policy = record(freshness, 'F01_ROUTE_FRESHNESS_POLICY_REQUIRED');
  const evaluatedAt = Date.parse(text(policy.evaluated_at, 'F01_ROUTE_EVALUATION_TIME_REQUIRED'));
  const observedAt = Date.parse(text(route.observed_at, 'F01_ROUTE_OBSERVATION_TIME_REQUIRED'));
  if (!Number.isFinite(evaluatedAt) || !Number.isSafeInteger(policy.max_age_seconds) ||
      policy.max_age_seconds <= 0) fail('F01_ROUTE_FRESHNESS_POLICY_INVALID');
  if (!Number.isFinite(observedAt) || observedAt > evaluatedAt ||
      evaluatedAt - observedAt > policy.max_age_seconds * 1000) fail('F01_ROUTE_OBSERVATION_STALE_OR_FUTURE');
  if (route.authenticated !== true || route.health !== 'HEALTHY' || route.quota !== 'AVAILABLE') {
    fail('F01_ROUTE_AUTH_HEALTH_OR_QUOTA_NOT_READY');
  }
  if (!Array.isArray(route.capabilities) || REQUIRED_CAPABILITIES.some((capability) =>
      !route.capabilities.includes(capability))) fail('F01_ROUTE_REQUIRED_CAPABILITY_MISSING');
  const providerId = text(route.provider_id, 'F01_PROVIDER_ID_REQUIRED');
  const routeId = text(route.route_id, 'F01_ROUTE_ID_REQUIRED');
  const protocol = text(route.protocol, 'F01_ROUTE_PROTOCOL_REQUIRED');
  text(route.protocol_version, 'F01_ROUTE_PROTOCOL_VERSION_REQUIRED');
  const routeProof = proofReference(route.route_proof, 'F01_ROUTE');
  const sandbox = record(route.sandbox_proof, 'F01_SANDBOX_PROOF_REQUIRED');
  if (sandbox.execution_cell !== 'HYPERV_UBUNTU_ISOLATED_WORKTREE' || sandbox.isolated !== true ||
      sandbox.provider_id !== providerId || sandbox.route_id !== routeId) fail('F01_SANDBOX_BOUNDARY_NOT_PROVEN');
  const sandboxProof = proofReference(sandbox.proof, 'F01_SANDBOX');
  text(sandbox.cell_id, 'F01_SANDBOX_CELL_ID_REQUIRED');
  digest(sandbox.isolation_profile_digest, 'F01_SANDBOX_PROFILE_DIGEST_INVALID');
  const selection = record(route.fleet_selection, 'F01_FLEET_SELECTION_REQUIRED');
  if (selection.decision !== 'SELECTED' || selection.provider !== providerId || selection.role !== 'BUILDER' ||
      selection.execution_cell !== 'HYPERV_UBUNTU_ISOLATED_WORKTREE' ||
      selection.worker_provider_write_credentials !== 0 || selection.paid_fallback !== false ||
      selection.production !== false) fail('F01_FLEET_SELECTION_NOT_ELIGIBLE');
  return {
    provider_id: providerId,
    route_id: routeId,
    protocol,
    protocol_version: route.protocol_version,
    observed_at: route.observed_at,
    capabilities: [...new Set(route.capabilities)].sort(),
    route_proof: routeProof,
    sandbox_proof: {
      ...sandboxProof,
      cell_id: sandbox.cell_id,
      execution_cell: sandbox.execution_cell,
      isolation_profile_digest: sandbox.isolation_profile_digest
    },
    fleet_selection: selection
  };
}

function receiptIdentity(receipt, identity, route) {
  record(receipt, 'F01_TASK_RECEIPT_REQUIRED');
  const exactIdentity = identityPayload(receipt.identity);
  if (identityDigest(exactIdentity) !== identityDigest(identity) ||
      receipt.provider_id !== route.provider_id || receipt.route_id !== route.route_id ||
      !RECEIPT_STATES.has(receipt.status) || !Number.isFinite(Date.parse(receipt.observed_at))) {
    fail('F01_TASK_RECEIPT_IDENTITY_OR_STATE_INVALID');
  }
  proofReference(receipt.proof, 'F01_TASK_RECEIPT');
  if (receipt.status === 'NOT_FOUND_CONFIRMED') {
    if (receipt.provider_task_id !== undefined && receipt.provider_task_id !== null) {
      fail('F01_NOT_FOUND_RECEIPT_HAS_TASK_ID');
    }
  } else {
    text(receipt.provider_task_id, 'F01_PROVIDER_TASK_ID_REQUIRED');
  }
  if (receipt.status === 'CANCELLED' && typeof receipt.capacity_released !== 'boolean') {
    fail('F01_CANCEL_CAPACITY_STATUS_REQUIRED');
  }
  return receipt;
}

function exactVerification(result, fields, code) {
  record(result, code);
  if (result.status !== 'VERIFIED' || Object.entries(fields).some(([key, value]) => result[key] !== value)) {
    fail(code);
  }
  return result;
}

export async function validateOuterReviewReceipt(input) {
  const value = record(input, 'F01_OUTER_REVIEW_RECEIPT_REQUIRED');
  const identity = identityPayload(value.identity);
  const reviewer = record(value.reviewer, 'F01_REVIEWER_IDENTITY_REQUIRED');
  const producer = record(value.producer, 'F01_PRODUCER_IDENTITY_REQUIRED');
  const producerInvocationId = text(producer.invocation_id, 'F01_PRODUCER_INVOCATION_REQUIRED');
  if (reviewer.role !== 'REVIEWER' || !text(reviewer.invocation_id, 'F01_REVIEWER_INVOCATION_REQUIRED') ||
      reviewer.invocation_id === producerInvocationId || value.identity_digest !== identityDigest(identity) ||
      value.read_only !== true || value.worker_provider_write_credentials !== 0 ||
      !['PASS', 'FINDINGS'].includes(value.verdict) ||
      !Number.isFinite(Date.parse(value.observed_at))) fail('F01_OUTER_REVIEW_RECEIPT_INVALID');
  const proof = proofReference(value.proof, 'F01_OUTER_REVIEW');
  return Object.freeze({
    status: 'STRUCTURE_VALID_REQUIRES_TRUSTED_REVIEWER_READBACK',
    identity_digest: value.identity_digest,
    reviewer_invocation_id: reviewer.invocation_id,
    verdict: value.verdict,
    proof
  });
}

export function createF01ExecutionAdapter(ports) {
  record(ports, 'F01_EXECUTION_PORTS_REQUIRED');
  for (const name of ['verifyDispatchAuthorization', 'verifyRouteObservation', 'readTaskReceipt',
    'verifyTaskReceipt', 'startTask', 'cancelTask']) {
    if (typeof ports[name] !== 'function') fail(`F01_EXECUTION_PORT_REQUIRED:${name}`);
  }

  async function context(rawIdentity, rawRoute, freshness, action) {
    const identity = identityPayload(rawIdentity);
    const idDigest = identityDigest(identity);
    const permit = await ports.verifyDispatchAuthorization({identity, identity_digest: idDigest, action});
    exactVerification(permit, {identity_digest: idDigest, action,
      worker_provider_write_credentials: 0, paid_fallback: false, production: false},
    'F01_OPERATION_AUTHORIZATION_NOT_VERIFIED');
    const route = routePayload(rawRoute, freshness);
    const routeDigest = `sha256:${createHash('sha256').update(canonicalJson(route), 'utf8').digest('hex')}`;
    const verification = await ports.verifyRouteObservation({route, route_digest: routeDigest});
    exactVerification(verification, {
      provider_id: route.provider_id,
      route_id: route.route_id,
      route_digest: routeDigest,
      route_proof_sha256: route.route_proof.sha256,
      sandbox_proof_sha256: route.sandbox_proof.sha256
    }, 'F01_ROUTE_OR_SANDBOX_PROOF_NOT_VERIFIED');
    return {identity, identity_digest: idDigest, route};
  }

  async function readVerified(identity, route) {
    const receipt = receiptIdentity(await ports.readTaskReceipt({identity, route}), identity, route);
    const verification = await ports.verifyTaskReceipt({receipt, identity, route});
    exactVerification(verification, {
      identity_digest: identityDigest(identity),
      provider_id: route.provider_id,
      route_id: route.route_id,
      receipt_sha256: receipt.proof.sha256
    }, 'F01_TASK_RECEIPT_NOT_VERIFIED');
    return receipt;
  }

  return Object.freeze({
    async startTask(input) {
      let ctx;
      try {
        ctx = await context(input?.identity, input?.route, input?.freshness, 'START');
      } catch (error) {
        return {status: 'PARKED', reason: error.code || 'F01_START_PREFLIGHT_FAILED', task_started: false};
      }
      let before;
      try {
        before = await readVerified(ctx.identity, ctx.route);
      } catch (error) {
        return {status: 'UNKNOWN_EFFECT_READBACK_REQUIRED', reason: error.code || 'F01_PRESTART_READBACK_FAILED',
          task_started: false, identity_digest: ctx.identity_digest};
      }
      if (before.status !== 'NOT_FOUND_CONFIRMED') {
        return {status: 'PARKED_EXISTING_OR_UNKNOWN_TASK', reason: before.status,
          task_started: false, identity_digest: ctx.identity_digest, receipt: before};
      }
      let dispatchError = null;
      try {
        await ports.startTask({identity: ctx.identity, route: ctx.route});
      } catch (error) {
        dispatchError = error.code || 'F01_START_OUTCOME_UNKNOWN';
      }
      try {
        const after = await readVerified(ctx.identity, ctx.route);
        if (['QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED'].includes(after.status)) {
          return {status: 'PROVIDER_READBACK_CONFIRMED', dispatch_outcome: dispatchError ? 'UNKNOWN_RECONCILED' : 'RETURNED',
            task_started: ['QUEUED', 'RUNNING'].includes(after.status), identity_digest: ctx.identity_digest,
            receipt: after};
        }
        return {status: dispatchError ? 'UNKNOWN_EFFECT_READBACK_REQUIRED' : 'NOT_APPLIED_CONFIRMED',
          reason: dispatchError || 'START_NOT_OBSERVED', task_started: false,
          identity_digest: ctx.identity_digest, receipt: after};
      } catch (error) {
        return {status: 'UNKNOWN_EFFECT_READBACK_REQUIRED', reason: error.code || 'F01_POSTSTART_READBACK_FAILED',
          task_started: false, identity_digest: ctx.identity_digest};
      }
    },

    async cancelTask(input) {
      let ctx;
      try {
        ctx = await context(input?.identity, input?.route, input?.freshness, 'CANCEL');
      } catch (error) {
        return {status: 'PARKED', reason: error.code || 'F01_CANCEL_PREFLIGHT_FAILED', capacity_released: false};
      }
      let before;
      try {
        before = await readVerified(ctx.identity, ctx.route);
      } catch (error) {
        return {status: 'UNKNOWN_EFFECT_READBACK_REQUIRED', reason: error.code || 'F01_PRE_CANCEL_READBACK_FAILED',
          capacity_released: false, identity_digest: ctx.identity_digest};
      }
      if (!['QUEUED', 'RUNNING'].includes(before.status)) {
        return {status: 'PARKED_TASK_NOT_CANCELLABLE', reason: before.status, capacity_released: false,
          identity_digest: ctx.identity_digest, receipt: before};
      }
      let cancelError = null;
      try {
        await ports.cancelTask({identity: ctx.identity, route: ctx.route, provider_task_id: before.provider_task_id});
      } catch (error) {
        cancelError = error.code || 'F01_CANCEL_OUTCOME_UNKNOWN';
      }
      try {
        const after = await readVerified(ctx.identity, ctx.route);
        if (after.status === 'CANCELLED' && after.capacity_released === true) {
          return {status: 'CANCELLED_AND_CAPACITY_RELEASED_CONFIRMED', dispatch_outcome: cancelError ? 'UNKNOWN_RECONCILED' : 'RETURNED',
            capacity_released: true, identity_digest: ctx.identity_digest, receipt: after};
        }
        return {status: 'CANCEL_OR_CAPACITY_RELEASE_UNCONFIRMED', reason: cancelError || after.status,
          capacity_released: false, identity_digest: ctx.identity_digest, receipt: after};
      } catch (error) {
        return {status: 'UNKNOWN_EFFECT_READBACK_REQUIRED', reason: error.code || 'F01_POSTCANCEL_READBACK_FAILED',
          capacity_released: false, identity_digest: ctx.identity_digest};
      }
    }
  });
}

export const F01_REQUIRED_TASK_CAPABILITIES = REQUIRED_CAPABILITIES;
