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

  try {
    const { stdout } = await execFileAsync(POWERSHELL, psArgs, {
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const text = stdout.trim();
    if (!text) throw new Error('EMPTY_HOSTGUARD_OUTPUT');
    return JSON.parse(text);
  } catch (error) {
    const code = error?.code ? String(error.code) : 'UNKNOWN';
    throw new Error(`HOSTGUARD_CALL_FAILED:${operation}:${code}`);
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
        'Governed PTYSD host control. No shell, filesystem, provider credentials, or arbitrary command execution is exposed. Use factory_status before bounded worker operations.',
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
