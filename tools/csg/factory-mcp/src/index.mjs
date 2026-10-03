import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { collectInstalledRuntimeEvidence, projectReadOnlyDiagnostics } from './readonly-diagnostics.mjs';
import { loadProjectScope } from './project-scope.mjs';

const execFileAsync = promisify(execFile);
const PACKAGE_METADATA = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const VERSION = PACKAGE_METADATA.version;
if (typeof VERSION !== 'string' || VERSION.length === 0) {
  throw new Error('INVALID_PACKAGE_VERSION');
}
const WRAPPER = fileURLToPath(new URL('./invoke-hostguard.ps1', import.meta.url));
const READONLY_PROBE = fileURLToPath(new URL('./readonly-diagnostics.ps1', import.meta.url));
const FACTORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const POWERSHELL = process.env.PTYSD_FACTORY_MCP_POWERSHELL || 'powershell.exe';
const TEST_MODE = process.env.PTYSD_FACTORY_MCP_TEST_MODE === '1';

if (TEST_MODE && process.env.NODE_ENV !== 'test') {
  throw new Error('TEST_MODE_REQUIRES_NODE_ENV_TEST');
}
const PROJECT_SCOPE = loadProjectScope({ testMode: TEST_MODE });

const idPattern = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const operationInput = z.object({
  runId: z.string().regex(idPattern),
  taskId: z.string().regex(idPattern),
  attemptId: z.string().regex(idPattern),
  attemptEpoch: z.number().int().min(1).max(2147483647),
}).strict();

const hostPowerShellInput = operationInput.extend({
  script: z.string().min(1).max(8192),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

const noArguments = z.object({}).strict();

function mockHostGuard(operation, args = {}) {
  if (operation === 'powershell') {
    const stdout = 'PTYSD_HOST_POWERSHELL_TEST_OK\n';
    const stderr = '';
    return {
      schema: 'v48.factory-mcp.host-exec.result.v2',
      operation: 'powershell',
      result: 'COMPLETED',
      run_id: args.runId,
      task_id: args.taskId,
      attempt_id: args.attemptId,
      attempt_epoch: args.attemptEpoch,
      run_as: 'NT AUTHORITY\\SYSTEM',
      executable: 'TEST_ONLY',
      exit_code: 0,
      timed_out: false,
      stdout,
      stderr,
      stdout_bytes: Buffer.byteLength(stdout, 'utf8'),
      stderr_bytes: Buffer.byteLength(stderr, 'utf8'),
      stdout_sha256: createHash('sha256').update(stdout, 'utf8').digest('hex'),
      stderr_sha256: createHash('sha256').update(stderr, 'utf8').digest('hex'),
      stdout_truncated: false,
      stderr_truncated: false,
      script_sha256: createHash('sha256').update(args.script, 'utf8').digest('hex'),
      receipt_status: 'TEST_MODE_NOT_PERSISTED',
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

function mockReadOnlyDiagnostics() {
  const diagnostics = {
    schema: 'v51.factory-mcp.readonly-diagnostics.v1',
    observed_at_utc: '2026-09-29T00:00:00.000Z',
    hostguard: {
      read_status: 'AVAILABLE',
      payload: {
        schema: 'v45.hostguard.status.v1',
        host: 'TEST-HOST',
        boot_identity: 'TEST-HOST|2026-09-29T00:00:00.000Z',
        vm_name: 'PTYSD-WORKER-01',
        vm_id: '881f7819-baa9-4a4e-8cca-8f6f18fb89a9',
        vm_state: 'Off',
        guest_ip: '172.31.253.10',
        ssh22_reachable: false,
        run_as: 'TEST\\PTYSDFactoryMCP',
      },
    },
    capability: { read_status: 'MISSING' },
    broker: { read_status: 'MISSING' },
    orphans: {
      read_status: 'UNAVAILABLE',
      total_count: null,
      records: [],
      truncated: true,
      consistency: 'BEST_EFFORT_NON_ATOMIC_DIRECTORY_READ',
    },
    scheduled_tasks: { read_status: 'COMPLETE', records: [] },
    services: { read_status: 'COMPLETE', records: [] },
    processes: { read_status: 'COMPLETE', records: [] },
    trusted_caller: {
      identity: 'TEST\\PTYSDFactoryMCP',
      sid: null,
      unique_os_enforced: null,
      boundary_status: 'NOT_ESTABLISHED',
    },
    owner_liveness: { read_status: 'MISSING' },
  };
  const publicationPath = process.env.PTYSD_FACTORY_MCP_TEST_OWNER_LIVENESS_PATH;
  if (TEST_MODE && publicationPath) {
    const publicationBytes = readFileSync(publicationPath);
    if (publicationBytes.length > 65536) throw new Error('TEST_OWNER_LIVENESS_PUBLICATION_TOO_LARGE');
    const publication = JSON.parse(publicationBytes.toString('utf8'));
    if (publication.schema !== 'v51.factory.owner-liveness.publication.v1') {
      throw new Error('TEST_OWNER_LIVENESS_PUBLICATION_SCHEMA_INVALID');
    }
    diagnostics.owner_liveness = {
      read_status: publication.read_status,
      publisher_status: publication.publisher_status,
      reason: publication.reason,
      publisher_observed_at_utc: publication.published_at_utc,
      source_observed_at_utc: publication.snapshot_observed_at_utc,
      source_digest: publication.source_digest,
      recovery_evidence: publication.recovery_evidence,
      evidence_ref: 'factory-mcp://state/owner-liveness.json',
      evidence_digest: 'sha256:' + createHash('sha256').update(publicationBytes).digest('hex'),
      acl_status: 'VERIFIED_READ_ONLY',
      snapshot: publication.snapshot,
    };
  }
  return diagnostics;
}

async function runHostGuard(operation, args = {}) {
  if (!['prepare', 'start', 'powershell'].includes(operation)) throw new Error('HOSTGUARD_OPERATION_NOT_ALLOWED');
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
    '-RunId', args.runId,
    '-TaskId', args.taskId,
    '-AttemptId', args.attemptId,
    '-AttemptEpoch', String(args.attemptEpoch),
  ];

  if (operation === 'powershell') {
    psArgs.push(
      '-ScriptBase64', Buffer.from(args.script, 'utf8').toString('base64'),
      '-TimeoutSeconds', String(args.timeoutSeconds ?? 60),
    );
  }

  try {
    const { stdout } = await execFileAsync(POWERSHELL, psArgs, {
      windowsHide: true,
      timeout: operation === 'powershell'
        ? Math.max(45000, ((args.timeoutSeconds ?? 60) + 15) * 1000)
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
    const stderrTail = rawStderr.replace(/\s+/g, ' ').trim().slice(-512);
    throw new Error(
      'HOSTGUARD_CALL_FAILED:' + operation + ':' + code + (stderrTail ? ':STDERR:' + stderrTail : ''),
    );
  }
}

async function runReadOnlyDiagnostics() {
  if (TEST_MODE) return projectReadOnlyDiagnostics(mockReadOnlyDiagnostics(), Date.now(), PROJECT_SCOPE);
  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    READONLY_PROBE,
  ];
  try {
    const { stdout } = await execFileAsync(POWERSHELL, psArgs, {
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const text = stdout.trim();
    if (!text || Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
      throw new Error('READONLY_DIAGNOSTIC_OUTPUT_INVALID');
    }
    const provider = projectReadOnlyDiagnostics(JSON.parse(text), Date.now(), PROJECT_SCOPE);
    const installedRuntime = await collectInstalledRuntimeEvidence(
      FACTORY_ROOT,
      process.execPath,
      process.version,
      PROJECT_SCOPE.project_id,
    );
    return { ...provider, installed_runtime: installedRuntime };
  } catch (error) {
    const code = error?.code ? String(error.code) : 'INVALID_OR_UNAVAILABLE';
    throw new Error('READONLY_DIAGNOSTICS_FAILED:' + code);
  }
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function createServer() {
  const server = new McpServer(
    { name: 'ptysd-factory-mcp', version: VERSION },
    {
      instructions:
        'Governed PTYSD Host control. factory_status is fixed-purpose read-only and accepts no arguments. worker_prepare and worker_start remain bounded HostGuard operations. host_powershell preserves the existing six-argument SYSTEM-brokered route with a 1..300 second timeout, bounded output, and durable execution evidence. Use only for Human-authorized reversible pre-Production work on this project Host; STOP and the Production Human Gate remain in force. Never return credentials or access tokens.',
    },
  );

  server.registerTool(
    'factory_status',
    {
      description: 'Return one bounded fixed-purpose read-only snapshot of HostGuard status, capability configuration, orphan receipt identities, installed runtime hashes, broker health, and Factory process/task identity. When a SYSTEM-owned ACL-qualified owner snapshot exists, also return exact project/task/attempt/epoch/generation/principal/scope, provider session/job, OS process, Supervisor heartbeat, freshness, source, and digest identities. Missing or invalid evidence stays explicit; this tool makes no stale-owner verdict and accepts no probe string or caller-supplied command.',
      inputSchema: noArguments,
      annotations: {
        title: 'Factory Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => textResult(await runReadOnlyDiagnostics()),
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
    async (args) => textResult(await runHostGuard('prepare', args)),
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
    async (args) => textResult(await runHostGuard('start', args)),
  );

  server.registerTool(
    'host_powershell',
    {
      description:
        'Execute a bounded PowerShell script through the existing SYSTEM broker on this exact Factory Host. Requires runId, taskId, attemptId and attemptEpoch; script is limited to 8192 characters and timeoutSeconds to 1..300 (default 60). Returns bounded stdout/stderr and durable execution evidence. This route has SYSTEM authority: use only for Human-authorized reversible pre-Production construction, honor STOP and the Production Human Gate, and never print credentials or access tokens.',
      inputSchema: hostPowerShellInput,
      annotations: {
        title: 'Host PowerShell',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => textResult(await runHostGuard('powershell', args)),
  );

  return server;
}

process.on('uncaughtException', (error) => {
  console.error('FACTORY_MCP_FATAL:' + (error?.message || 'UNKNOWN'));
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error('FACTORY_MCP_FATAL:' + (error instanceof Error ? error.message : 'UNKNOWN'));
  process.exit(1);
});

void serveStdio(createServer);
console.error('PTYSD Factory MCP ' + VERSION + ' waiting on stdio');
