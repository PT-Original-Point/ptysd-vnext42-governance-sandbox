import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { authorizeSystemExecution } from './current-execution-fence.mjs';
import { createBrokerCallerAttestation } from './trusted-caller.mjs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const execFileAsync = promisify(execFile);
const PACKAGE_METADATA = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const VERSION = PACKAGE_METADATA.version;
if (typeof VERSION !== 'string' || VERSION.length === 0) {
  throw new Error('INVALID_PACKAGE_VERSION');
}
const WRAPPER = fileURLToPath(new URL('./invoke-hostguard.ps1', import.meta.url));
const SYSTEM_CAPABILITY_PATH = fileURLToPath(new URL('../config/system-capability.json', import.meta.url));
const SYSTEM_CAPABILITY = JSON.parse(readFileSync(SYSTEM_CAPABILITY_PATH, 'utf8'));
const POWERSHELL = process.env.PTYSD_FACTORY_MCP_POWERSHELL || 'powershell.exe';
const TEST_MODE = process.env.PTYSD_FACTORY_MCP_TEST_MODE === '1';

if (TEST_MODE && process.env.NODE_ENV !== 'test') {
  throw new Error('TEST_MODE_REQUIRES_NODE_ENV_TEST');
}

const idPattern = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
if (
  SYSTEM_CAPABILITY.schema !== 'v49.factory-mcp.system-capability.v1' ||
  SYSTEM_CAPABILITY.project_id !== 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' ||
  SYSTEM_CAPABILITY.capability_id !== 'CAP-GOV-SYSTEM-V1' ||
  SYSTEM_CAPABILITY.mission_revision !== '20260919T010100+0800' ||
  SYSTEM_CAPABILITY.mission_hash !== 'sha256:58f21a0818bd60b61929925b38ea8507d5b80c09d816a7b6f5a75d2a410d542b' ||
  SYSTEM_CAPABILITY.authorization_envelope_digest !== 'sha256:cb614427a0a1755d002cd035f50d33b18208bab7e5a9d8efc42dfbc7c4d99d14' ||
  SYSTEM_CAPABILITY.capability_generation !== 4 ||
  SYSTEM_CAPABILITY.production_allowed !== false ||
  SYSTEM_CAPABILITY.business_project_allowed !== false ||
  SYSTEM_CAPABILITY.public_tool_count !== 4
) {
  throw new Error('SYSTEM_CAPABILITY_CONFIG_INVALID');
}
const runPatterns = (SYSTEM_CAPABILITY.allowed_run_id_patterns ?? []).map((p) => new RegExp(p));
const taskPatterns = (SYSTEM_CAPABILITY.allowed_task_id_patterns ?? []).map((p) => new RegExp(p));
if (runPatterns.length === 0 || taskPatterns.length === 0) throw new Error('SYSTEM_CAPABILITY_PATTERNS_REQUIRED');
function assertSystemCapabilityArgs(args) {
  if (!runPatterns.some((p) => p.test(args.runId))) throw new Error('SYSTEM_CAPABILITY_RUN_DENY');
  if (!taskPatterns.some((p) => p.test(args.taskId))) throw new Error('SYSTEM_CAPABILITY_TASK_DENY');
  if ((args.timeoutSeconds ?? 60) > SYSTEM_CAPABILITY.max_timeout_seconds) throw new Error('SYSTEM_CAPABILITY_TIMEOUT_DENY');
}
const operationInput = z.object({
  runId: z.string().regex(idPattern),
  taskId: z.string().regex(idPattern),
  attemptId: z.string().regex(idPattern),
  attemptEpoch: z.number().int().min(1).max(2147483647),
});

const factoryStatusInput = z.object({
  probe: z.string().regex(/^[a-z0-9_-]{1,64}$/).default('factory'),
});

const hostPowerShellInput = operationInput.extend({
  script: z.string().min(1).max(8192),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
});

function mockHostGuard(operation, args = {}) {
  if (operation === 'status') {
    return {
      schema: 'v45.hostguard.status.v1',
      host: 'TEST-HOST',
      vm_name: 'PTYSD-WORKER-01',
      vm_id: '881f7819-baa9-4a4e-8cca-8f6f18fb89a9',
      vm_state: 'Off',
      guest_ip: '172.31.253.10',
      ssh22_reachable: false,
      run_as: 'TEST\\PTYSDFactoryMCP',
      probe: args.probe ?? 'factory',
      tunnel_lane: {
        task_state: 'Running',
        live: true,
        ready: true,
        control_plane_status: 'ok',
      },
    };
  }

  if (operation === 'powershell') {
    return {
      schema: 'v48.factory-mcp.host-exec.result.v1',
      operation: 'powershell',
      result: 'COMPLETED',
      project_id: SYSTEM_CAPABILITY.project_id,
      capability_id: SYSTEM_CAPABILITY.capability_id,
      operation_id: args.executionFence?.execution_fence?.operation_id ?? null,
      control_oid: args.executionFence?.control_oid ?? null,
      checkpoint_digest: args.executionFence?.checkpoint_digest ?? null,
      authorization_envelope_digest: args.executionFence?.execution_fence?.authorization_envelope_digest ?? null,
      capability_generation: args.executionFence?.execution_fence?.capability_generation ?? null,
      run_id: args.runId,
      task_id: args.taskId,
      attempt_id: args.attemptId,
      attempt_epoch: args.attemptEpoch,
      run_as: 'NT AUTHORITY\\SYSTEM',
      exit_code: 0,
      timed_out: false,
      stdout: 'PTYSD_HOST_POWERSHELL_TEST_OK\n',
      stderr: '',
      stdout_bytes: 31,
      stderr_bytes: 0,
      stdout_truncated: false,
      stderr_truncated: false,
      script_sha256: 'TEST_ONLY',
    };
  }

  return {
    schema: 'v45.hostguard.receipt.v1',
    operation,
    result: operation === 'start' ? 'STARTED' : 'VERIFIED',
    run_id: args.runId,
    task_id: args.taskId,
    attempt_id: args.attemptId,
    attempt_epoch: args.attemptEpoch,
    vm_name: 'PTYSD-WORKER-01',
    vm_id: '881f7819-baa9-4a4e-8cca-8f6f18fb89a9',
  };
}

async function runHostGuard(operation, args = {}) {
  if (TEST_MODE) return mockHostGuard(operation, args);

  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    WRAPPER,
    '-Operation',
    operation,
  ];

  if (operation === 'status') {
    psArgs.push('-Probe', args.probe ?? 'factory');
  }

  if (operation !== 'status') {
    psArgs.push(
      '-RunId', args.runId,
      '-TaskId', args.taskId,
      '-AttemptId', args.attemptId,
      '-AttemptEpoch', String(args.attemptEpoch),
    );
  }

  if (operation !== 'status') {
    const fence = args.executionFence?.execution_fence;
    psArgs.push(
      '-ProjectId', SYSTEM_CAPABILITY.project_id,
      '-CapabilityId', SYSTEM_CAPABILITY.capability_id,
      '-OperationId', fence.operation_id,
      '-ControlOid', args.executionFence.control_oid,
      '-CheckpointDigest', args.executionFence.checkpoint_digest,
      '-AuthorizationEnvelopeDigest', fence.authorization_envelope_digest,
      '-AuthorizationGeneration', String(fence.authorization_generation),
      '-AuthorizationStateDigest', fence.authorization_state_digest,
      '-CapabilityGeneration', String(fence.capability_generation),
      '-RequestId', args.requestId,
      '-CallerAttestationBase64', args.callerAttestation?.payload_b64 ?? '',
      '-CallerAttestationMac', args.callerAttestation?.mac_sha256 ?? '',
      '-TimeoutSeconds', String(args.timeoutSeconds ?? 60),
    );
    if (operation === 'powershell') {
      psArgs.push('-ScriptBase64', Buffer.from(args.script, 'utf8').toString('base64'));
    }
  }

  try {
    const { stdout } = await execFileAsync(POWERSHELL, psArgs, {
      windowsHide: true,
      timeout: operation === 'powershell'
        ? Math.max(60000, ((args.timeoutSeconds ?? 60) + 30) * 1000)
        : 45000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const text = stdout.trim();
    if (!text) throw new Error('EMPTY_HOSTGUARD_OUTPUT');
    return JSON.parse(text);
  } catch (error) {
    const code = error?.code ? String(error.code) : 'UNKNOWN';
    const rawStderr =
      typeof error?.stderr === 'string'
        ? error.stderr
        : Buffer.isBuffer(error?.stderr)
          ? error.stderr.toString('utf8')
          : '';
    const stderrTail = rawStderr.replace(/\\s+/g, ' ').trim().slice(-512);
    throw new Error(
      `HOSTGUARD_CALL_FAILED:${operation}:${code}${stderrTail ? `:STDERR:${stderrTail}` : ''}`,
    );
  }
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function assertTrustedMutationCaller(callerIdentity, transportKind) {
  if (TEST_MODE) return;
  if (!callerIdentity || callerIdentity.schema !== 'v49.factory-mcp.trusted-caller-identity.v1') {
    throw new Error('TRUSTED_CALLER_REQUIRED');
  }
  if (callerIdentity.project_id !== SYSTEM_CAPABILITY.project_id) {
    throw new Error('TRUSTED_CALLER_PROJECT_DENY');
  }
  if (transportKind !== 'https-mtls') {
    throw new Error('TRUSTED_CALLER_TRANSPORT_REQUIRED');
  }
}

async function runAuthorizedMutation(operation, args, callerIdentity, transportKind) {
  const operationKind = operation === 'powershell' ? 'HOST_POWERSHELL' : operation === 'prepare' ? 'WORKER_PREPARE' : 'WORKER_START';
  assertSystemCapabilityArgs({ ...args, timeoutSeconds: args.timeoutSeconds ?? 60 });
  assertTrustedMutationCaller(callerIdentity, transportKind);
  const normalizedArgs = { ...args, timeoutSeconds: args.timeoutSeconds ?? 60 };
  const executionFence = await authorizeSystemExecution(normalizedArgs, SYSTEM_CAPABILITY, { testMode: TEST_MODE, operationKind });
  const requestId = randomBytes(16).toString('hex');
  const callerAttestation = TEST_MODE ? null : createBrokerCallerAttestation({ callerIdentity, executionFence, args: normalizedArgs, requestId });
  return runHostGuard(operation, { ...normalizedArgs, executionFence, callerAttestation, requestId });
}

export function createServer({ callerIdentity = null, transportKind = 'stdio' } = {}) {
  const server = new McpServer(
    { name: 'ptysd-factory-mcp', version: VERSION },
    {
      instructions:
        'Governed PTYSD host control. Use factory_status first for bounded read-only diagnostics (including factory health and supported provider-identity probes). worker_prepare/worker_start retain their prior bounded semantics. host_powershell executes caller-supplied PowerShell through the existing SYSTEM broker and therefore has full local host authority; reserve it for work that cannot be completed by bounded read-only tools or provider-native connectors. Avoid printing credentials or access tokens.',
    },
  );

  server.registerTool(
    'factory_status',
    {
      description: 'Run a bounded read-only diagnostic probe through the constrained broker. Supported probes: factory (HostGuard, host-exec lane, tunnel liveness/readiness/control-plane health) and cloudflare_identity (fixed GET-only provider identity readback; never returns tokens).',
      inputSchema: factoryStatusInput,
      annotations: {
        title: 'Factory Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => textResult(await runHostGuard('status', args)),
  );

  server.registerTool(
    'worker_prepare',
    {
      description: 'Create a bounded HostGuard preparation receipt for the exact worker VM identity.',
      inputSchema: operationInput,
      annotations: {
        title: 'Prepare Worker',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => textResult(await runAuthorizedMutation('prepare', args, callerIdentity, transportKind)),
  );

  server.registerTool(
    'worker_start',
    {
      description: 'Start only the exact governed PTYSD worker VM through HostGuard and return its receipt.',
      inputSchema: operationInput,
      annotations: {
        title: 'Start Worker',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => textResult(await runAuthorizedMutation('start', args, callerIdentity, transportKind)),
  );

  server.registerTool(
    'host_powershell',
    {
      description:
        'Execute caller-supplied Windows PowerShell on DESKTOP-1B6PD2P through the existing SYSTEM broker. Returns bounded stdout/stderr, exit code, timeout state, execution identity and script digest. This tool has full local host authority and may access local files, processes, network/provider CLIs and credentials available to SYSTEM. Do not print secret values or bearer tokens.',
      inputSchema: hostPowerShellInput,
      annotations: {
        title: 'Host PowerShell',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => textResult(await runAuthorizedMutation('powershell', args, callerIdentity, transportKind)),
  );

  return server;
}

process.on('uncaughtException', (error) => {
  console.error(`FACTORY_MCP_FATAL:${error?.message || 'UNKNOWN'}`);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(`FACTORY_MCP_FATAL:${error instanceof Error ? error.message : 'UNKNOWN'}`);
  process.exit(1);
});

const isDirectEntrypoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectEntrypoint) {
  void serveStdio(() => createServer({ callerIdentity: null, transportKind: 'stdio' }));
  console.error(`PTYSD Factory MCP ${VERSION} waiting on stdio (SYSTEM dispatch disabled without trusted mTLS caller)`);
}
