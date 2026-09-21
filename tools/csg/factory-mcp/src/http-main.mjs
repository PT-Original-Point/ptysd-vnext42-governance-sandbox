import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createServer as createFactoryServer } from './index.mjs';
import { loadTrustedCallers, resolveTrustedMtlsCaller } from './trusted-caller.mjs';

const DEFAULT_CONFIG_PATH = 'C:\\ProgramData\\PTYSD\\MCP\\config\\factory-mcp-http.json';
const CONFIG_PATH = process.env.PTYSD_FACTORY_MCP_HTTP_CONFIG || DEFAULT_CONFIG_PATH;

function fail(code) {
  throw new Error(code);
}

function loadConfig() {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    fail('FACTORY_HTTP_CONFIG_READ_FAILED');
  }
  if (cfg?.schema !== 'v49.factory-mcp.http-mtls.v1') fail('FACTORY_HTTP_CONFIG_SCHEMA_INVALID');
  if (cfg.listen_host !== '127.0.0.1') fail('FACTORY_HTTP_LISTEN_HOST_INVALID');
  if (!Number.isSafeInteger(cfg.listen_port) || cfg.listen_port < 1024 || cfg.listen_port > 65535) {
    fail('FACTORY_HTTP_LISTEN_PORT_INVALID');
  }
  for (const key of ['server_cert_path','server_key_path','client_ca_path','trusted_callers_path','health_path']) {
    if (typeof cfg[key] !== 'string' || cfg[key].length < 3) fail('FACTORY_HTTP_CONFIG_PATH_INVALID');
  }
  return cfg;
}

const cfg = loadConfig();
const trustedCallers = loadTrustedCallers(cfg.trusted_callers_path);
const tls = {
  cert: readFileSync(cfg.server_cert_path),
  key: readFileSync(cfg.server_key_path),
  ca: readFileSync(cfg.client_ca_path),
  requestCert: true,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
};

const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

function identityFromAuthInfo(authInfo) {
  const identity = authInfo?.extra;
  if (!identity || identity.schema !== 'v49.factory-mcp.trusted-caller-identity.v1') {
    fail('TRUSTED_CALLER_AUTHINFO_REQUIRED');
  }
  return identity;
}

const mcpHandler = createMcpHandler((ctx) =>
  createFactoryServer({
    callerIdentity: identityFromAuthInfo(ctx.authInfo),
    transportKind: 'https-mtls',
  }),
);
const nodeHandler = toNodeHandler(mcpHandler, {
  maxRequestBodySize: 1024 * 1024,
  onerror(error) {
    console.error(`FACTORY_HTTP_MCP_ERROR:${error?.message || 'UNKNOWN'}`);
  },
});

function writeHealth(state, extra = {}) {
  const body = {
    schema: 'v49.factory-mcp.http-health.v1',
    status: state,
    listen_host: cfg.listen_host,
    listen_port: cfg.listen_port,
    transport: 'HTTPS_MTLS_STREAMABLE_HTTP',
    trusted_identity_generation: trustedCallers.identity_generation,
    pid: process.pid,
    observed_at: new Date().toISOString(),
    ...extra,
  };
  mkdirSync(dirname(cfg.health_path), { recursive: true });
  const tmp = `${cfg.health_path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, cfg.health_path);
}

const httpsServer = createHttpsServer(tls, async (req, res) => {
  try {
    if (req.url?.split('?')[0] !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.socket.authorized !== true) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'MTLS_REQUIRED' }));
      return;
    }
    const peer = req.socket.getPeerCertificate(true);
    const callerIdentity = resolveTrustedMtlsCaller(peer?.raw, trustedCallers);
    req.auth = {
      token: `mtls:${callerIdentity.certificate_sha256}`,
      clientId: callerIdentity.caller_id,
      scopes: ['mcp'],
      extra: callerIdentity,
    };
    await nodeHandler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(403, { 'content-type': 'application/json' });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: error instanceof Error ? error.message : 'TRUSTED_CALLER_REJECTED' },
        id: null,
      }));
    }
  }
});

httpsServer.on('tlsClientError', (error) => {
  console.error(`FACTORY_HTTP_TLS_CLIENT_REJECTED:${error?.message || 'UNKNOWN'}`);
});

httpsServer.on('error', (error) => {
  writeHealth('FAILED', { error: error?.message || 'UNKNOWN' });
  console.error(`FACTORY_HTTP_FATAL:${error?.message || 'UNKNOWN'}`);
  process.exitCode = 1;
});

httpsServer.listen(cfg.listen_port, cfg.listen_host, () => {
  writeHealth('READY');
  console.error(`PTYSD Factory MCP HTTPS mTLS ready on ${cfg.listen_host}:${cfg.listen_port}`);
});

async function shutdown(signal) {
  writeHealth('STOPPING', { signal });
  try { await mcpHandler.close(); } catch {}
  httpsServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  writeHealth('FAILED', { error: error?.message || 'UNKNOWN' });
  console.error(`FACTORY_HTTP_FATAL:${error?.message || 'UNKNOWN'}`);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  writeHealth('FAILED', { error: error instanceof Error ? error.message : 'UNKNOWN' });
  console.error(`FACTORY_HTTP_FATAL:${error instanceof Error ? error.message : 'UNKNOWN'}`);
  process.exit(1);
});
