import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const REPOSITORY_URL = 'https://github.com/PT-Original-Point/ptysd-vnext42-governance-sandbox.git';
const CONTROL_REF = 'refs/heads/v45/factory-control';
const RAW_ROOT = 'https://raw.githubusercontent.com/PT-Original-Point/ptysd-vnext42-governance-sandbox';
const GIT = process.env.PTYSD_FACTORY_MCP_GIT || 'C:\\Program Files\\Git\\cmd\\git.exe';
const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const OID_RE = /^[0-9a-f]{40}$/;
const CHECKPOINT_PATH_RE = /^governance\/csg\/checkpoints\/[0-9]{6}\.json$/;
const OPERATION_KINDS = new Set(['HOST_POWERSHELL','WORKER_PREPARE','WORKER_START']);

function fail(code) {
  throw new Error(code);
}

function sha256Text(text) {
  return 'sha256:' + createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

async function readControlHead() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(GIT, ['ls-remote', '--refs', REPOSITORY_URL, CONTROL_REF], {
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 64 * 1024,
    }));
  } catch {
    fail('SYSTEM_FENCE_CONTROL_HEAD_READ_FAILED');
  }
  const line = String(stdout ?? '').trim().split(/\r?\n/).find(Boolean);
  const [oid, ref] = line ? line.split(/\s+/) : [];
  if (!OID_RE.test(oid ?? '') || ref !== CONTROL_REF) fail('SYSTEM_FENCE_CONTROL_HEAD_INVALID');
  return oid;
}

async function fetchJsonAt(oid, path) {
  const url = `${RAW_ROOT}/${oid}/${path}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'PTYSD-Factory-MCP/0.2.1', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    fail('SYSTEM_FENCE_PROVIDER_READ_FAILED');
  }
  if (!response.ok) fail('SYSTEM_FENCE_PROVIDER_READ_FAILED');
  try {
    return await response.json();
  } catch {
    fail('SYSTEM_FENCE_PROVIDER_JSON_INVALID');
  }
}

function validateContext(controlOid, pointer, checkpoint, systemCapability, now = Date.now()) {
  if (pointer?.schema_version !== 'csg.pointer.v1') fail('SYSTEM_FENCE_POINTER_SCHEMA_INVALID');
  if (pointer?.project_id !== PROJECT_ID) fail('SYSTEM_FENCE_POINTER_PROJECT_MISMATCH');
  if (!CHECKPOINT_PATH_RE.test(pointer?.checkpoint_path ?? '')) fail('SYSTEM_FENCE_CHECKPOINT_PATH_INVALID');
  if (!SHA256_RE.test(pointer?.checkpoint_digest ?? '')) fail('SYSTEM_FENCE_CHECKPOINT_DIGEST_INVALID');

  if (checkpoint?.schema_version !== 'csg.checkpoint.v1') fail('SYSTEM_FENCE_CHECKPOINT_SCHEMA_INVALID');
  if (checkpoint?.project_id !== PROJECT_ID) fail('SYSTEM_FENCE_CHECKPOINT_PROJECT_MISMATCH');
  if (checkpoint?.checkpoint_seq !== pointer.checkpoint_seq) fail('SYSTEM_FENCE_CHECKPOINT_SEQ_MISMATCH');
  if (checkpoint?.payload_digest !== pointer.checkpoint_digest) fail('SYSTEM_FENCE_CHECKPOINT_DIGEST_MISMATCH');

  const fence = checkpoint?.atomic?.execution_fence;
  if (!fence || fence.schema !== 'v49.factory-mcp.execution-fence.v1') fail('SYSTEM_FENCE_CURRENT_FENCE_MISSING');
  if (fence.project_id !== PROJECT_ID) fail('SYSTEM_FENCE_PROJECT_MISMATCH');
  if (!OPERATION_KINDS.has(fence.operation_kind)) fail('SYSTEM_FENCE_OPERATION_KIND_DENY');
  if (fence.task_id !== checkpoint.task_id) fail('SYSTEM_FENCE_TASK_CHECKPOINT_MISMATCH');
  if (fence.attempt_id !== checkpoint.attempt_id) fail('SYSTEM_FENCE_ATTEMPT_CHECKPOINT_MISMATCH');
  if (fence.attempt_epoch !== checkpoint.attempt_epoch) fail('SYSTEM_FENCE_EPOCH_CHECKPOINT_MISMATCH');
  if (fence.mission_revision !== checkpoint?.mission_anchor?.revision) fail('SYSTEM_FENCE_MISSION_REVISION_MISMATCH');
  if (fence.mission_hash !== checkpoint?.mission_anchor?.declared_hash) fail('SYSTEM_FENCE_MISSION_HASH_MISMATCH');
  if (fence.authorization_envelope_digest !== checkpoint?.authorization_mode?.envelope_ref?.digest) {
    fail('SYSTEM_FENCE_AUTHORIZATION_MISMATCH');
  }
  if (!Number.isInteger(fence.authorization_generation) || fence.authorization_generation < 1) {
    fail('SYSTEM_FENCE_AUTHORIZATION_GENERATION_INVALID');
  }
  if (!SHA256_RE.test(fence.authorization_state_digest ?? '')) {
    fail('SYSTEM_FENCE_AUTHORIZATION_STATE_DIGEST_INVALID');
  }
  if (checkpoint?.authorization_mode?.authorization_generation !== fence.authorization_generation) {
    fail('SYSTEM_FENCE_AUTHORIZATION_GENERATION_MISMATCH');
  }
  if (checkpoint?.authorization_mode?.authorization_state_ref?.digest !== fence.authorization_state_digest) {
    fail('SYSTEM_FENCE_AUTHORIZATION_STATE_MISMATCH');
  }
  if (fence.mission_revision !== systemCapability.mission_revision) fail('SYSTEM_FENCE_CAPABILITY_MISSION_MISMATCH');
  if (fence.mission_hash !== systemCapability.mission_hash) fail('SYSTEM_FENCE_CAPABILITY_MISSION_HASH_MISMATCH');
  if (fence.authorization_envelope_digest !== systemCapability.authorization_envelope_digest) {
    fail('SYSTEM_FENCE_CAPABILITY_AUTHORIZATION_MISMATCH');
  }
  if (!Number.isInteger(fence.capability_generation) || fence.capability_generation < 1) {
    fail('SYSTEM_FENCE_GENERATION_INVALID');
  }
  if (fence.capability_generation !== systemCapability.capability_generation) {
    fail('SYSTEM_FENCE_GENERATION_STALE');
  }
  if (fence.operation_kind === 'HOST_POWERSHELL') {
    if (!SHA256_RE.test(fence.script_sha256 ?? '')) fail('SYSTEM_FENCE_SCRIPT_DIGEST_INVALID');
  } else if (!SHA256_RE.test(fence.payload_sha256 ?? '')) {
    fail('SYSTEM_FENCE_PAYLOAD_DIGEST_INVALID');
  }
  if (!Number.isInteger(fence.timeout_seconds) || fence.timeout_seconds < 1 || fence.timeout_seconds > 300) {
    fail('SYSTEM_FENCE_TIMEOUT_INVALID');
  }
  const expiresAt = Date.parse(fence.expires_at ?? '');
  if (!Number.isFinite(expiresAt)) fail('SYSTEM_FENCE_EXPIRY_INVALID');
  if (now >= expiresAt) fail('SYSTEM_FENCE_EXPIRED');

  return {
    repository: REPOSITORY,
    control_oid: controlOid,
    checkpoint_seq: pointer.checkpoint_seq,
    checkpoint_digest: pointer.checkpoint_digest,
    execution_fence: fence,
  };
}

const TEST_CONTEXT = Object.freeze({
  repository: REPOSITORY,
  control_oid: 'f'.repeat(40),
  checkpoint_seq: 121,
  checkpoint_digest: 'sha256:' + 'e'.repeat(64),
  execution_fence: Object.freeze({
    schema: 'v49.factory-mcp.execution-fence.v1',
    project_id: PROJECT_ID,
    mission_revision: '20260919T010100+0800',
    mission_hash: 'sha256:58f21a0818bd60b61929925b38ea8507d5b80c09d816a7b6f5a75d2a410d542b',
    authorization_envelope_digest: 'sha256:cb614427a0a1755d002cd035f50d33b18208bab7e5a9d8efc42dfbc7c4d99d14',
    authorization_generation: 1,
    authorization_state_digest: 'sha256:' + 'a'.repeat(64),
    run_id: 'CHATGPT_GLOBAL_SKILL_GOVERNANCE-QUAL-P4',
    task_id: 'GOV-HARDENING-P4',
    attempt_id: 'GOV-HARDENING-P4-ATTEMPT-001',
    attempt_epoch: 1,
    operation_id: 'GOV-HARDENING-P4-CANARY-001',
    operation_kind: 'HOST_POWERSHELL',
    script_sha256: 'sha256:c29ed566b415d3f2b992604b1ae71c5b3c82737de781d34b84588690c234abab',
    timeout_seconds: 30,
    capability_generation: 4,
    expires_at: '2099-01-01T00:00:00Z',
  }),
});

export async function loadCurrentSystemExecutionFence(systemCapability, { testMode = false } = {}) {
  if (testMode) {
    return validateContext(
      TEST_CONTEXT.control_oid,
      {
        schema_version: 'csg.pointer.v1',
        project_id: PROJECT_ID,
        checkpoint_seq: TEST_CONTEXT.checkpoint_seq,
        checkpoint_path: 'governance/csg/checkpoints/000121.json',
        checkpoint_digest: TEST_CONTEXT.checkpoint_digest,
      },
      {
        schema_version: 'csg.checkpoint.v1',
        project_id: PROJECT_ID,
        checkpoint_seq: TEST_CONTEXT.checkpoint_seq,
        payload_digest: TEST_CONTEXT.checkpoint_digest,
        task_id: TEST_CONTEXT.execution_fence.task_id,
        attempt_id: TEST_CONTEXT.execution_fence.attempt_id,
        attempt_epoch: TEST_CONTEXT.execution_fence.attempt_epoch,
        mission_anchor: {
          revision: TEST_CONTEXT.execution_fence.mission_revision,
          declared_hash: TEST_CONTEXT.execution_fence.mission_hash,
        },
        authorization_mode: {
          envelope_ref: { digest: TEST_CONTEXT.execution_fence.authorization_envelope_digest },
          authorization_generation: TEST_CONTEXT.execution_fence.authorization_generation,
          authorization_state_ref: { digest: TEST_CONTEXT.execution_fence.authorization_state_digest },
        },
        atomic: { execution_fence: TEST_CONTEXT.execution_fence },
      },
      systemCapability,
      Date.parse('2026-09-21T10:00:00Z'),
    );
  }

  const headBefore = await readControlHead();
  const pointer = await fetchJsonAt(headBefore, 'governance/csg/current.json');
  const checkpoint = await fetchJsonAt(headBefore, pointer?.checkpoint_path ?? '');
  const headAfter = await readControlHead();
  if (headBefore !== headAfter) fail('SYSTEM_FENCE_CONTROL_DRIFT');
  return validateContext(headBefore, pointer, checkpoint, systemCapability);
}

function mutationPayloadSha256(operationKind, args) {
  return sha256Text(`${operationKind}|${args.runId}|${args.taskId}|${args.attemptId}|${args.attemptEpoch}`);
}

export async function authorizeSystemExecution(args, systemCapability, options = {}) {
  const { operationKind = 'HOST_POWERSHELL', ...loadOptions } = options;
  if (!OPERATION_KINDS.has(operationKind)) fail('SYSTEM_FENCE_OPERATION_KIND_DENY');
  const context = await loadCurrentSystemExecutionFence(systemCapability, loadOptions);
  const fence = context.execution_fence;

  if (operationKind !== fence.operation_kind) fail('SYSTEM_FENCE_OPERATION_KIND_MISMATCH');
  if (args.runId !== fence.run_id) fail('SYSTEM_FENCE_RUN_MISMATCH');
  if (args.taskId !== fence.task_id) fail('SYSTEM_FENCE_TASK_MISMATCH');
  if (args.attemptId !== fence.attempt_id) fail('SYSTEM_FENCE_ATTEMPT_MISMATCH');
  if (args.attemptEpoch !== fence.attempt_epoch) fail('SYSTEM_FENCE_EPOCH_MISMATCH');
  if ((args.timeoutSeconds ?? 60) !== fence.timeout_seconds) fail('SYSTEM_FENCE_TIMEOUT_MISMATCH');
  if (operationKind === 'HOST_POWERSHELL') {
    if (typeof args.script !== 'string' || sha256Text(args.script) !== fence.script_sha256) fail('SYSTEM_FENCE_SCRIPT_MISMATCH');
  } else if (mutationPayloadSha256(operationKind, args) !== fence.payload_sha256) {
    fail('SYSTEM_FENCE_PAYLOAD_MISMATCH');
  }

  return context;
}
