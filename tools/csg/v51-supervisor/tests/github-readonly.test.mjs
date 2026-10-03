import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGitHubReadOnlyReader} from '../lib/github-readonly.mjs';
import {canonicalJson} from '../lib/fingerprint.mjs';
import {validateCanonicalSnapshot} from '../lib/reconcile.mjs';

const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const DIRECTORY_HEAD = 'a'.repeat(40);
const CONTROL_HEAD = 'd'.repeat(40);
const MISSION_COMMIT = 'c'.repeat(40);
const POLICY_COMMIT = 'b'.repeat(40);
const RUN_COMMIT = '9'.repeat(40);
const sha = (char) => `sha256:${char.repeat(64)}`;

function bytesFor(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function gitOid(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function contentEntry(value) {
  const bytes = bytesFor(value);
  return {type: 'file', encoding: 'base64', content: bytes.toString('base64'), size: bytes.length, sha: gitOid(bytes)};
}

function response(status, body, headers = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {status, headers: {get: (key) => map.get(key.toLowerCase()) || null}, text: async () => JSON.stringify(body)};
}

function createFixture(fetchOverride) {
  const mission = {project_id: PROJECT_ID, mission_revision_id: 'M1', mission_hash: sha('1')};
  const policy = {project_id: PROJECT_ID, mission_revision_id: 'M1', policy_revision_id: 'P1',
    policy_hash: sha('2')};
  const runBytes = bytesFor({run_id: 'RUN1', revision: 7, active_task_id: 'TASK1',
    attempt_id: 'ATTEMPT1', attempt_epoch: 2, unresolved_operation_ids: [], execution_owner: null});
  const runDigest = `sha256:${createHash('sha256').update(runBytes).digest('hex')}`;
  const run = JSON.parse(runBytes.toString('utf8'));
  const checkpoint = {
    schema_version: 'csg.checkpoint.v1', project_id: PROJECT_ID, checkpoint_seq: 200,
    payload_digest: '',
    mission_anchor: {ref: `github://1352411536/governance/csg/v51/missions/m.json@${MISSION_COMMIT}`,
      revision: 'M1', declared_hash: mission.mission_hash},
    policy_anchor: {ref: `github://1352411536/governance/csg/v51/policies/p.json@${POLICY_COMMIT}`,
      revision: 'P1', declared_hash: policy.policy_hash},
    run_ref: {provider: 'GitHub', repository_id_or_resource_id: '1352411536', revision: RUN_COMMIT,
      path: 'governance/csg/v51/runs/run.json', digest: runDigest},
    task_id: 'TASK1', attempt_id: 'ATTEMPT1', attempt_epoch: 2, unresolved_effect_refs: []
  };
  const cpPayload = structuredClone(checkpoint);
  delete cpPayload.payload_digest;
  checkpoint.payload_digest = `sha256:${createHash('sha256').update(canonicalJson(cpPayload), 'utf8').digest('hex')}`;
  const pointer = {schema_version: 'csg.pointer.v1', project_id: PROJECT_ID,
    checkpoint_seq: 200, checkpoint_path: 'governance/csg/checkpoints/000200.json',
    checkpoint_digest: checkpoint.payload_digest};
  const directory = {project_id: PROJECT_ID, registration_state: 'BOUND', directory_revision: 5,
    control_locator: {provider: 'github', ref: 'refs/heads/v45/factory-control',
      current_path: 'governance/csg/current.json'}};
  const byPathRef = new Map([
    [`directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json|${DIRECTORY_HEAD}`, contentEntry(directory)],
    [`governance/csg/current.json|${CONTROL_HEAD}`, contentEntry(pointer)],
    [`governance/csg/checkpoints/000200.json|${CONTROL_HEAD}`, contentEntry(checkpoint)],
    [`governance/csg/v51/missions/m.json|${MISSION_COMMIT}`, contentEntry(mission)],
    [`governance/csg/v51/policies/p.json|${POLICY_COMMIT}`, contentEntry(policy)],
    [`governance/csg/v51/runs/run.json|${RUN_COMMIT}`, contentEntry(run)],
    [`governance/csg/v51/current-execution-policy.json|${CONTROL_HEAD}`, contentEntry(policy)]
  ]);
  const requests = [];
  const etags = new Map();
  const fetchImpl = fetchOverride || (async (url, options) => {
    requests.push({url: String(url), options});
    if (options?.method !== 'GET') return response(405, {});
    if (options.headers?.Authorization || options.headers?.authorization) return response(400, {});
    const ifNoneMatch = options.headers?.['If-None-Match'];
    if (ifNoneMatch && etags.has(ifNoneMatch)) return response(304, {});
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/git/ref/heads/governance%2Fproject-directory')) {
      const etag = 'dir-ref';
      etags.set(etag, true);
      return response(200, {object: {sha: DIRECTORY_HEAD}}, {etag});
    }
    if (parsed.pathname.endsWith('/git/ref/heads/v45%2Ffactory-control')) {
      const etag = 'control-ref';
      etags.set(etag, true);
      return response(200, {object: {sha: CONTROL_HEAD}}, {etag});
    }
    const marker = '/contents/';
    const path = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length));
    const ref = parsed.searchParams.get('ref');
    const item = byPathRef.get(`${path}|${ref}`);
    if (!item) return response(404, {message: 'fixture missing'});
    const etag = `${path}:${ref}`;
    etags.set(etag, true);
    return response(200, item, {etag});
  });
  return {reader: createGitHubReadOnlyReader({fetchImpl}), requests, directory, pointer, checkpoint, mission, policy, run};
}

test('read-only adapter reads Directory to pointer to immutable canonical objects and validates bindings', async () => {
  const fixture = createFixture();
  const directory = await fixture.reader.readProjectDirectory({project_id: PROJECT_ID, locator: 'locator/v1'});
  const pointer = await fixture.reader.readCurrentPointer(directory.control_locator);
  const snapshot = await fixture.reader.readCanonicalSnapshot(directory, pointer);
  const authority = validateCanonicalSnapshot({...snapshot, project_directory: directory, pointer});

  assert.equal(authority.project_id, PROJECT_ID);
  assert.equal(authority.checkpoint_seq, 200);
  assert.equal(authority.run_id, 'RUN1');
  assert.equal(authority.attempt_epoch, 2);
  assert.equal(snapshot.evidence.run_blob_oid, gitOid(bytesFor(fixture.run)));
  assert.ok(fixture.requests.length >= 9);
  assert.ok(fixture.requests.every((request) => request.options.method === 'GET'));
  assert.ok(fixture.requests.every((request) => !request.options.headers.Authorization));
});

test('Project Directory identity mismatch fails before any provider request', async () => {
  let called = false;
  const reader = createGitHubReadOnlyReader({fetchImpl: async () => {called = true; return response(500, {});}});
  await assert.rejects(() => reader.readProjectDirectory({project_id: 'OTHER', locator: 'x'}),
    {code: 'PROJECT_DIRECTORY_ID_MISMATCH'});
  assert.equal(called, false);
});

test('provider rate limit is a lane-local external wait with retry metadata', async () => {
  const reader = createGitHubReadOnlyReader({fetchImpl: async () => response(403, {},
    {'x-ratelimit-reset': '1790940000', 'retry-after': '120'})});
  await assert.rejects(() => reader.readProjectDirectory({project_id: PROJECT_ID}), (error) =>
    error.code === 'GITHUB_PROVIDER_WAITING_EXTERNAL' && error.retry_after === '120');
});

test('a 304 response reuses the exact cached provider reads', async () => {
  const fixture = createFixture();
  const wake = {project_id: PROJECT_ID, locator: 'locator/v1'};
  const first = await fixture.reader.readProjectDirectory(wake);
  const firstCount = fixture.requests.length;
  const second = await fixture.reader.readProjectDirectory(wake);
  assert.equal(second.project_directory_head, first.project_directory_head);
  assert.equal(fixture.requests.length, firstCount * 2);
  assert.ok(fixture.requests.slice(firstCount).every((request) => request.options.headers['If-None-Match']));
});
