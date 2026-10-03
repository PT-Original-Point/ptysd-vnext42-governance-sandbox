import { lstatSync, readFileSync } from 'node:fs';

export const PROJECT_SCOPE_PATH = 'C:\\ProgramData\\PTYSD\\MCP\\config\\factory-mcp-project-scope.json';
export const PROJECT_SCOPE_SCHEMA = 'v52.factory-mcp.project-scope.v1';
const PROJECT_ID = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PROJECT_SCOPE_BYTES = 1024;

// This protected install record supplies routing and target context; it is not remote-caller authentication or permission evidence.

export function parseProjectScope(jsonText) {
  if (typeof jsonText !== 'string' || Buffer.byteLength(jsonText, 'utf8') < 2 ||
      Buffer.byteLength(jsonText, 'utf8') > MAX_PROJECT_SCOPE_BYTES) {
    throw new Error('PROJECT_SCOPE_SIZE_INVALID');
  }

  let value;
  try {
    value = JSON.parse(jsonText);
  } catch {
    throw new Error('PROJECT_SCOPE_JSON_INVALID');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'host_id,project_id,schema' ||
      value.schema !== PROJECT_SCOPE_SCHEMA ||
      typeof value.project_id !== 'string' || !PROJECT_ID.test(value.project_id) ||
      typeof value.host_id !== 'string' || !HOST_ID.test(value.host_id)) {
    throw new Error('PROJECT_SCOPE_FIELDS_INVALID');
  }

  const scope = { schema: PROJECT_SCOPE_SCHEMA, project_id: value.project_id, host_id: value.host_id };
  if (jsonText !== JSON.stringify(scope)) throw new Error('PROJECT_SCOPE_CANONICAL_JSON_INVALID');
  return Object.freeze({ project_id: scope.project_id, host_id: scope.host_id });
}

export function loadProjectScope({ testMode = false, env = process.env } = {}) {
  if (testMode) {
    if (env.NODE_ENV !== 'test') throw new Error('PROJECT_SCOPE_TEST_MODE_REQUIRES_NODE_ENV_TEST');
    if (typeof env.PTYSD_FACTORY_MCP_TEST_PROJECT_SCOPE !== 'string') {
      throw new Error('PROJECT_SCOPE_TEST_FIXTURE_REQUIRED');
    }
    return parseProjectScope(env.PTYSD_FACTORY_MCP_TEST_PROJECT_SCOPE);
  }

  let stat;
  try {
    stat = lstatSync(PROJECT_SCOPE_PATH);
  } catch {
    throw new Error('PROJECT_SCOPE_FILE_UNAVAILABLE');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_PROJECT_SCOPE_BYTES) {
    throw new Error('PROJECT_SCOPE_FILE_INVALID');
  }
  let bytes;
  try {
    bytes = readFileSync(PROJECT_SCOPE_PATH);
  } catch {
    throw new Error('PROJECT_SCOPE_FILE_UNAVAILABLE');
  }
  if (bytes.length !== stat.size) throw new Error('PROJECT_SCOPE_FILE_CHANGED_DURING_READ');
  const after = lstatSync(PROJECT_SCOPE_PATH);
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino ||
      after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
    throw new Error('PROJECT_SCOPE_FILE_CHANGED_DURING_READ');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('PROJECT_SCOPE_ENCODING_INVALID');
  }
  return parseProjectScope(text);
}
