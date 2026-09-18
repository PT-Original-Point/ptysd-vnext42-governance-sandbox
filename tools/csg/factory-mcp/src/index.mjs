import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
const POWERSHELL = process.env.PTYSD_FACTORY_MCP_POWERSHELL || 'powershell.exe';
const TEST_MODE = process.env.PTYSD_FACTORY_MCP_TEST_MODE === '1';

if (TEST_MODE && process.env.NODE_ENV !== 'test') {
  throw new Error('TEST_MODE_REQUIRES_NODE_ENV_TEST');
}

const idPattern = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const operationInput = z.object({
  runId: z.string().regex(idPattern),
  taskId: z.string().regex(idPattern),
  attemptId: z.string().regex(idPattern),
  attemptEpoch: z.number().int().min(1).max(2147483647),
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
    };
  }

  if (operation === 'powershell') {
    return {
      schema: 'v48.factory-mcp.host-exec.result.v1',
      operation: 'powershell',
      result: 'COMPLETED',
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

  if (operation !== 'status') {
    psArgs.push(
      '-RunId', args.runId,
      '-TaskId', args.taskId,
      '-AttemptId', args.attemptId,
      '-AttemptEpoch', String(args.attemptEpoch),
    );
  }

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
    const stderrTail = rawStderr.replace(/\\s+/g, ' ').trim().slice(-512);
    throw new Error(
      `HOSTGUARD_CALL_FAILED:${operation}:${code}${stderrTail ? `:STDERR:${stderrTail}` : ''}`,
    );
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
        'Governed PTYSD host control. factory_status/worker_prepare/worker_start retain their prior bounded semantics. host_powershell executes caller-supplied PowerShell through the existing SYSTEM broker and therefore has full local host authority. Avoid printing credentials or access tokens; prefer commands that return bounded business evidence.',
    },
  );

  server.registerTool(
    'factory_status',
    {
      description: 'Read the exact PTYSD HostGuard/worker VM status through the constrained JEA endpoint.',
      inputSchema: z.object({}),
      annotations: {
        title: 'Factory Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => textResult(await runHostGuard('status')),
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
    async (args) => textResult(await runHostGuard('powershell', args)),
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

void serveStdio(createServer);
console.error(`PTYSD Factory MCP ${VERSION} waiting on stdio`);
