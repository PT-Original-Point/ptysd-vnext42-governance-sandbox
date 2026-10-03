import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProjectScope, parseProjectScope, PROJECT_SCOPE_SCHEMA } from '../src/project-scope.mjs';

const encodedScope = (projectId, hostId) => JSON.stringify({
  schema: PROJECT_SCOPE_SCHEMA,
  project_id: projectId,
  host_id: hostId,
});

test('the trusted install scope routes distinct Projects to an exact Host', () => {
  const projectA = parseProjectScope(encodedScope('PROJECT_A', 'HOST-A'));
  const projectB = parseProjectScope(encodedScope('PROJECT_B', 'HOST-B'));
  assert.deepEqual(projectA, { project_id: 'PROJECT_A', host_id: 'HOST-A' });
  assert.deepEqual(projectB, { project_id: 'PROJECT_B', host_id: 'HOST-B' });
  assert.equal(Object.isFrozen(projectA), true);
});

test('Project scope rejects malformed, duplicate, noncanonical, and unbounded configuration', () => {
  for (const value of [
    '{',
    JSON.stringify({ schema: PROJECT_SCOPE_SCHEMA, project_id: 'PROJECT_A', host_id: 'HOST/A' }),
    JSON.stringify({ schema: PROJECT_SCOPE_SCHEMA, project_id: 'PROJECT_A', host_id: 'HOST-A', extra: true }),
    '{"schema":"v52.factory-mcp.project-scope.v1","project_id":"PROJECT_A","project_id":"PROJECT_B","host_id":"HOST-A"}',
    '{ "schema":"v52.factory-mcp.project-scope.v1","project_id":"PROJECT_A","host_id":"HOST-A"}',
    'x'.repeat(1025),
  ]) {
    assert.throws(() => parseProjectScope(value), /PROJECT_SCOPE_/);
  }
});

test('test-only scope injection requires NODE_ENV=test and an explicit fixture', () => {
  assert.throws(() => loadProjectScope({ testMode: true, env: { NODE_ENV: 'production' } }),
    /PROJECT_SCOPE_TEST_MODE_REQUIRES_NODE_ENV_TEST/);
  assert.throws(() => loadProjectScope({ testMode: true, env: { NODE_ENV: 'test' } }),
    /PROJECT_SCOPE_TEST_FIXTURE_REQUIRED/);
  assert.deepEqual(loadProjectScope({
    testMode: true,
    env: {
      NODE_ENV: 'test',
      PTYSD_FACTORY_MCP_TEST_PROJECT_SCOPE: encodedScope('PROJECT_TEST', 'HOST-TEST'),
    },
  }), { project_id: 'PROJECT_TEST', host_id: 'HOST-TEST' });
});
