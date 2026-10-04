import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, projectSharedContextReadback, readSharedContext } from '../src/shared-context.mjs';

// Cold-session consumer E2E (synthetic only, lawful local TEST_MODE file path).
// Never: installed service / Host / HTTP / Git provider / network / system route / PowerShell.
// Denied lanes (broker/windows/publisher/protectedHost/legacy baseline) are never imported.
// The actual SDK stdio lane is required for this local suite and uses the existing locked dependency.
// If it is absent, fail with the precise local dependency reason; never install or fabricate it here.
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), e = 'e'.repeat(40);
const gov = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const ids = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'HANYAO_ADS_LINE_PROD'];
const branch = 'codex/vnext5.2-shared-construction-20261003-r2';
const sdkAvailable = existsSync(join(packageRoot, 'node_modules', '@modelcontextprotocol', 'server'));

function buildFixtureData(overrides = {}) {
  const data = new Map();
  const put = (route, value) => data.set(route, value);
  const file = (repo, path, sha, value) => put(repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha, {
    encoding: 'base64', sha: c,
    content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64'),
  });
  put(gov + '/git/ref/heads/' + encodeURIComponent(branch), { object: { sha: a } });
  put(gov + '/git/ref/heads/' + encodeURIComponent('governance/project-directory'), { object: { sha: b } });
  put(gov + '/git/ref/heads/' + encodeURIComponent('codex/vnext5.2-construction-latest'), { object: { sha: e } });
  const progressCurrent = overrides.progressCurrent ?? JSON.stringify({
    schema: 'vnext5.2.construction-progress.v2',
    observed_at: '2026-10-03T10:27:12.000Z',
    valid_until: '2999-10-03T10:42:12.000Z',
    columns: {
      construction: { spec: 'VNEXT5.2', contract: 'V52-UNION59-20261003', operations: 59, mission_complete: false },
      canonical: { spec: 'VNEXT5.1-R2', head: c, checkpoint: 200, lifecycle: 'ACTIVE' },
      installed: { version: 'UNKNOWN', live_mcp: 'NOT_ACCEPTED', live_ads: 'NOT_ACCEPTED', survival: 'NOT_ACCEPTED' },
    },
    ready_ids: ['S-MCP'], running_ids: [], goal: 'VNEXT5.2',
    reviews: { pr385: { semantic: 'FINDINGS' } }, dispatch_path: 'refs/heads/codex/vnext5.2-construction-latest',
  });
  const progressCurrentSha = 'sha256:' + createHash('sha256').update(progressCurrent, 'utf8').digest('hex');
  const progressManifest = overrides.progressManifest ?? JSON.stringify({
    schema: 'vnext5.2.progress-manifest.v1',
    files: [{ path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json', sha256: progressCurrentSha }],
  });
  const locator = overrides.locator ?? {
    schema: 'vnext5.2.progress-locator.v1', noncanonical: true, dispatch_authority: false,
    canonical_selection: false, execution_owner_allocated: false,
    progress: { repository: gov, exact_head: e,
      current_path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json',
      current_sha256: progressCurrentSha, manifest_path: 'governance/csg/vnext5.2/progress/MANIFEST.json' },
  };
  put(gov + '/contents/' + 'governance/csg/vnext5.2/progress/CURRENT.json'.split('/').map(encodeURIComponent).join('/') + '?ref=' + e, {
    encoding: 'base64', sha: c, content: Buffer.from(JSON.stringify(locator)).toString('base64'),
  });
  put(gov + '/contents/' + 'governance/csg/vnext5.2/progress/CURRENT-20261003.json'.split('/').map(encodeURIComponent).join('/') + '?ref=' + (overrides.currentRef ?? e), {
    encoding: 'base64', sha: c, content: Buffer.from(overrides.currentBytes ?? progressCurrent).toString('base64'),
  });
  put(gov + '/contents/' + 'governance/csg/vnext5.2/progress/MANIFEST.json'.split('/').map(encodeURIComponent).join('/') + '?ref=' + e, {
    encoding: 'base64', sha: c, content: Buffer.from(progressManifest).toString('base64'),
  });
  file(gov, 'governance/csg/vnext5.2/construction/CURRENT.json', a, {
    schema: 'vnext5.2.shared-construction-context.v1', project_id: ids[0], canonical_selection_changed: false,
    architecture_path: '01.md', construction_work_index: 'work.json', human_requested_spec: 'VNEXT5.2', architecture_revision: 'V52-R1',
  });
  file(gov, 'governance/csg/vnext5.2/construction/01.md', a, 'architecture');
  file(gov, 'governance/csg/vnext5.2/construction/work.json', a, {
    schema: 'vnext5.2.construction-work-index.v1', observed_at: '2026-10-03T09:09:25.438Z',
    entries: [{ slice_id: 'S-MCP', project_id: ids[0], head: a, staged_tree: b, state: 'SOURCE_PROVIDER_CANDIDATE',
      live: 'NOT_ACCEPTED_BY_THIS_CAPTURE', inputs: [{ source_path: 'tools/csg/factory-mcp/src/index.mjs',
        artifact_path: 'inputs/S-MCP/tools/csg/factory-mcp/src/index.mjs', sha256: 'd'.repeat(64) }] }],
  });
  file(gov, 'directory/descriptor.json', b, { write_policy: 'SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE' });
  ids.forEach((projectId, index) => {
    const repo = index ? 't14210184/hanyao' : gov;
    const repositoryId = index ? '1272482826' : '1352411536';
    const controlBranch = index ? 'governance/hanyao-control' : 'v45/factory-control';
    put(repo + '/git/ref/heads/' + encodeURIComponent(controlBranch), { object: { sha: overrides.controlSha ?? c } });
    const dirGen = overrides.bindingGeneration ?? 1;
    const ptrGen = overrides.pointerGeneration ?? dirGen;
    file(gov, 'directory/projects/' + projectId + '.json', b, {
      project_id: projectId, binding_id: projectId, binding_generation: dirGen,
      control_locator: { repository_id: repositoryId, ref: 'refs/heads/' + controlBranch, current_path: 'current.json' },
    });
    const checkpoint = {
      project_id: projectId, checkpoint_seq: index ? 2 : 200, lifecycle: 'ACTIVE', stop_requested: false,
      owner: overrides.owner ?? null,
      unresolved_effect_refs: [], mission_anchor: { ref: 'github://' + repositoryId + '/mission.json@' + a },
      policy_anchor: { ref: 'github://' + repositoryId + '/policy.json@' + a },
    };
    if (overrides.runRef && index === 0) checkpoint.run_ref = overrides.runRef;
    if (index) {
      const receipt = { schema: 'hanyao.hg10-readback-evidence.v1', project_id: projectId, target_date: '2026-09-17',
        recorded_at_utc: '2026-09-19T07:34:17.381383Z', closure_state: 'REPORTING_DELTA_CONFIRMED',
        d1: { read_only_guard: true }, google_ads: { target_date_row_returned: true },
        secrets_printed: false, credentials_persisted: false, provider_mutations: 0, conversion_reingest: 0 };
      const receiptText = JSON.stringify(receipt);
      const receiptDigest = 'sha256:' + createHash('sha256').update(receiptText, 'utf8').digest('hex');
      const receiptPath = 'governance/hanyao/evidence/HG10_E17_20260917_20260919.json';
      checkpoint.evidence_refs = [{ kind: 'BUNDLE_OBJECT', path: receiptPath, digest: receiptDigest }];
      file(repo, receiptPath, overrides.controlSha ?? c, receiptText);
    } else checkpoint.evidence_refs = [];
    checkpoint.payload_digest = 'sha256:' + createHash('sha256').update(canonicalJson(checkpoint)).digest('hex');
    file(repo, 'current.json', overrides.controlSha ?? c, { project_id: projectId, binding_id: projectId, binding_generation: ptrGen,
      checkpoint_path: 'checkpoint.json', checkpoint_seq: index ? 2 : 200, checkpoint_digest: checkpoint.payload_digest });
    file(repo, 'checkpoint.json', overrides.controlSha ?? c, checkpoint);
    file(repo, 'mission.json', a, { project_id: projectId, payload: { current_construction_spec: { id: index ? 'HANYAO' : 'VNEXT5.1-R2' } } });
    file(repo, 'policy.json', a, { project_id: projectId });
    if (overrides.runRef && index === 0) file(repo, overrides.runRef.path, c, overrides.runPayload);
  });
  return { data, expectedCurrentSha: progressCurrentSha, expectedCurrentText: progressCurrent };
}

function fixtureGet(fx) {
  return async (route) => {
    assert(fx.data.has(route), 'unrecognized synthetic GET (no network): ' + route);
    return fx.data.get(route);
  };
}

// Replicates src/index.mjs TEST_MODE file path exactly (64KB bound, JSON parse, projection).
async function testModeFileRoundTrip(raw) {
  const root = await mkdtemp(join(tmpdir(), 'factory-mcp-cold-consumer-'));
  const p = join(root, 'context.json');
  await writeFile(p, JSON.stringify(raw), { flag: 'wx' });
  try {
    const bytes = readFileSync(p);
    assert(bytes.length <= 65536, 'TEST_SHARED_CONTEXT_TOO_LARGE');
    return projectSharedContextReadback(JSON.parse(bytes.toString('utf8')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('source-qualified surface: exactly 4 tools, fixed-purpose factory_status', () => {
  const src = readFileSync(join(packageRoot, 'src', 'index.mjs'), 'utf8');
  const names = [...src.matchAll(/registerTool\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ['factory_status', 'host_powershell', 'worker_prepare', 'worker_start']);
  assert.equal(names.length, 4);
  assert.match(src, /registerTool\(\s*'factory_status'[\s\S]{0,800}?inputSchema:\s*noArguments/);
  assert.match(src, /const noArguments = z\.object\(\{\}\)\.strict\(\)/);
  assert.match(src, /description:\s*'Return one bounded fixed-purpose read-only snapshot/);
  assert.match(src, /accepts no probe string/);
});

test('cold consumer sessions obtain exact latest locator/content/manifest; V5.2/CP200-V5.1R2/UNKNOWN separate; sideeffects false', async () => {
  const fx = buildFixtureData();
  // Two independent cold sessions: fresh transport each, no shared state.
  const rawA = await readSharedContext(fixtureGet(fx));
  const rawB = await readSharedContext(fixtureGet(buildFixtureData()));
  for (const k of ['schema', 'shared_head', 'directory_head', 'human_requested_spec', 'architecture_revision']) assert.equal(rawB[k], rawA[k]);
  assert.equal(rawB.progress.locator_head ?? rawB.progress_head, rawA.progress.locator_head ?? rawA.progress_head);
  const sc = await testModeFileRoundTrip(rawA);
  assert.equal(sc.read_status, 'AVAILABLE', JSON.stringify(sc));
  assert.equal(sc.progress.read_status, 'READBACK_OK');
  assert.equal(sc.progress.locator_head, e);
  assert.equal(sc.progress.progress_head, e);
  assert.equal(sc.progress.current_digest, fx.expectedCurrentSha);
  assert.equal(sc.progress.manifest_paths_validated, 1);
  const sc2 = await testModeFileRoundTrip(rawB);
  assert.deepEqual(sc2.progress, sc.progress, 'new session obtains exact same latest manifest');
  assert.equal(sc.human_requested_spec, 'VNEXT5.2');
  assert.equal(sc.projects[0].checkpoint, 200);
  assert.equal(sc.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
  assert.equal(sc.progress.columns.construction.spec, 'VNEXT5.2');
  assert.equal(sc.progress.columns.canonical.spec, 'VNEXT5.1-R2');
  assert.equal(sc.progress.columns.canonical.checkpoint, 200);
  assert.equal(sc.progress.columns.installed.version, 'UNKNOWN');
  assert.notEqual(sc.progress.columns.construction.spec, sc.progress.columns.canonical.spec);
  for (const k of ['dispatch', 'host_mutation', 'canonical_write', 'provider_write']) assert.equal(sc[k], false);
  assert.equal(sc.progress.dispatch_authority, false);
  assert.equal(sc.authority, 'READ_ONLY_NO_AUTHORITY');
  assert.equal(sc.installed_runtime, 'NOT_OBSERVED');
  assert.equal(sc.live_mcp, 'NOT_OBSERVED');
});

test('expired mutable progress reread-required; immutable source qualification not TTL', async () => {
  const expiredCurrent = JSON.stringify({
    schema: 'vnext5.2.construction-progress.v2', observed_at: '2026-10-03T10:27:12.000Z',
    valid_until: '2020-01-01T00:00:00.000Z',
    columns: { construction: { spec: 'VNEXT5.2' }, canonical: { spec: 'VNEXT5.1-R2', head: c, checkpoint: 200, lifecycle: 'ACTIVE' },
      installed: { version: 'UNKNOWN', live_mcp: 'NOT_ACCEPTED' } },
    ready_ids: [], running_ids: [], goal: 'VNEXT5.2',
  });
  const fx = buildFixtureData({ progressCurrent: expiredCurrent });
  const view = projectSharedContextReadback(await readSharedContext(fixtureGet(fx)));
  assert.equal(view.progress.read_status, 'READBACK_OK');
  assert.equal(view.progress.queue_fresh, false, 'expired mutable facts require reread');
  assert.equal(view.human_requested_spec, 'VNEXT5.2');
  assert.equal(view.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
  assert.equal(view.projects[0].checkpoint, 200);
  assert.equal(view.progress.columns.canonical.checkpoint, 200);
  assert.equal(view.dispatch, false);
  assert.equal(view.authority, 'READ_ONLY_NO_AUTHORITY');
  const viaFile = await testModeFileRoundTrip(await readSharedContext(fixtureGet(fx)));
  assert.equal(viaFile.progress.queue_fresh, false);
  assert.equal(viaFile.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
});

test('corrupt digest/path/head fail closed (progress unavailable, no authority, no side effects)', async () => {
  const fxD = buildFixtureData({ currentBytes: '{"schema":"vnext5.2.construction-progress.v2","tampered":true}' });
  const viewD = projectSharedContextReadback(await readSharedContext(fixtureGet(fxD)));
  assert.equal(viewD.progress.read_status, 'SCOPED_SOURCE_INDEX_UNAVAILABLE');
  assert.equal(viewD.progress.reason_code, 'PROGRESS_CURRENT_DIGEST_MISMATCH');
  const evilManifest = JSON.stringify({ schema: 'vnext5.2.progress-manifest.v1',
    files: [{ path: 'governance/csg/vnext5.2/construction/EVIL.json', sha256: 'sha256:' + 'd'.repeat(64) }] });
  const viewP = projectSharedContextReadback(await readSharedContext(fixtureGet(buildFixtureData({ progressManifest: evilManifest }))));
  assert.equal(viewP.progress.read_status, 'SCOPED_SOURCE_INDEX_UNAVAILABLE');
  const fxH = buildFixtureData({ locator: { schema: 'vnext5.2.progress-locator.v1', noncanonical: true, dispatch_authority: false,
    canonical_selection: false, execution_owner_allocated: false,
    progress: { repository: gov, exact_head: 'f'.repeat(40),
      current_path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json',
      current_sha256: 'sha256:' + 'd'.repeat(64), manifest_path: 'governance/csg/vnext5.2/progress/MANIFEST.json' } } });
  const viewH = projectSharedContextReadback(await readSharedContext(fixtureGet(fxH)));
  assert.equal(viewH.progress.read_status, 'SCOPED_SOURCE_INDEX_UNAVAILABLE');
  for (const v of [viewD, viewP, viewH]) {
    assert.notEqual(v.progress.read_status, 'READBACK_OK');
    assert.equal(v.dispatch, false);
    assert.equal(v.host_mutation, false);
    assert.equal(v.canonical_write, false);
    assert.equal(v.provider_write, false);
    assert.equal(v.authority, 'READ_ONLY_NO_AUTHORITY');
    assert.equal(/GITHUB_READ|GIT_TRANSPORT/.test(JSON.stringify(v.progress)), false);
  }
});

test('session/attempt/generation rollover never becomes read-only transport denial', async () => {
  const runA = { project_id: ids[0], run_id: 'RUN-001', task_id: 'TASK-001', attempt_id: 'ATTEMPT-001' };
  const runB = { project_id: ids[0], run_id: 'RUN-002', task_id: 'TASK-002', attempt_id: 'ATTEMPT-002' };
  const mk = (owner, runPayload, gen) => buildFixtureData({
    owner, bindingGeneration: gen,
    runRef: { repository_id_or_resource_id: '1352411536', path: 'run.json', revision: c }, runPayload,
  });
  const vA = projectSharedContextReadback(await readSharedContext(fixtureGet(mk('SESSION-A', runA, 1))));
  const vB = projectSharedContextReadback(await readSharedContext(fixtureGet(mk('SESSION-B', runB, 2))));
  assert.equal(vA.read_status, 'AVAILABLE', JSON.stringify(vA));
  assert.equal(vB.read_status, 'AVAILABLE', JSON.stringify(vB));
  assert.deepEqual(vA.projects[0].run_identity, { run_id: 'RUN-001', task_id: 'TASK-001', attempt_id: 'ATTEMPT-001' });
  assert.deepEqual(vB.projects[0].run_identity, { run_id: 'RUN-002', task_id: 'TASK-002', attempt_id: 'ATTEMPT-002' });
  for (const v of [vA, vB]) {
    assert.equal(v.dispatch, false);
    assert.equal(v.authority, 'READ_ONLY_NO_AUTHORITY');
  }
  const viewBad = projectSharedContextReadback(await readSharedContext(
    fixtureGet(buildFixtureData({ bindingGeneration: 1, pointerGeneration: 99 }))));
  assert.equal(viewBad.projects[0].read_status, 'UNAVAILABLE');
  assert.match(viewBad.projects[0].reason_code ?? '', /^[A-Z0-9_]+$/);
  assert.equal(/GITHUB_READ|GIT_TRANSPORT/.test(viewBad.projects[0].reason_code ?? ''), false);
  assert.equal(/GITHUB_READ|GIT_TRANSPORT/.test(JSON.stringify(viewBad)), false);
});

// ---- Actual bounded fresh-process MCP stdio consumer (locked SDK, lawful TEST_MODE fixture) ----
// Uses existing bounded stdio protocol client pattern (spawn + readline, no new dependency).
// Never calls worker_start/host_powershell; only initialize + tools/list + readonly factory_status.
// TEST_MODE guard locators in src/index.mjs: runHostGuard TEST_MODE mock (line ~169),
// runReadOnlyDiagnostics TEST_MODE mock + shared-context file path (line ~221). If child
// attempted denied Host/publisher read or powershell/network/Git/system route, STOP that route.
function stdioRequest(child, pending, method, params = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const id = pending.nextId++;
    const timeout = setTimeout(() => {
      pending.waiting.delete(id);
      rejectRequest(new Error('MCP_STDIO_TIMEOUT:' + method + ':' + pending.stderr.join('').slice(-2000)));
    }, 10000);
    pending.waiting.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) rejectRequest(new Error(JSON.stringify(message.error) + ':' + pending.stderr.join('').slice(-2000)));
      else resolveRequest(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function actualStdioFactoryStatus(raw) {
  if (!sdkAvailable) {
    throw new Error('LOCAL_TEST_PREREQUISITE_MISSING:@modelcontextprotocol/server is not installed under package-local node_modules');
  }
  // Lawful injected TEST_MODE fixture: tmp context.json, same 64KB bound as src/index.mjs.
  const root = await mkdtemp(join(tmpdir(), 'factory-mcp-sdk-stdio-'));
  const contextPath = join(root, 'context.json');
  await writeFile(contextPath, JSON.stringify(raw), { flag: 'wx' });
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: packageRoot,
    env: { ...process.env, NODE_ENV: 'test', PTYSD_FACTORY_MCP_TEST_MODE: '1',
      PTYSD_FACTORY_MCP_TEST_PROJECT_SCOPE: JSON.stringify({ schema: 'v52.factory-mcp.project-scope.v1', project_id: ids[0], host_id: 'TEST-HOST' }),
      PTYSD_FACTORY_MCP_TEST_SHARED_CONTEXT_PATH: contextPath },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const pending = { nextId: 0, waiting: new Map(), stderr: [] };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => pending.stderr.push(chunk));
  child.on('exit', (code) => {
    for (const r of pending.waiting.values()) r({ error: { code, message: 'MCP_CHILD_EXIT_' + code } });
    pending.waiting.clear();
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) pending.waiting.get(message.id)?.(message);
    } catch {}
  });
  try {
    const init = await stdioRequest(child, pending, 'initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sdk-locked-recovery', version: '1.0.0' },
    });
    assert.equal(init.result.serverInfo.name, 'ptysd-factory-mcp');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    const listed = await stdioRequest(child, pending, 'tools/list');
    const called = await stdioRequest(child, pending, 'tools/call', { name: 'factory_status', arguments: {} });
    let injectionIsError = false;
    try {
      const injected = await stdioRequest(child, pending, 'tools/call', { name: 'factory_status', arguments: { probe: 'Get-Process' } });
      injectionIsError = injected?.result?.isError === true;
    } catch { injectionIsError = true; }
    const deniedHit = /protectedHost|publisher|powershell\.exe|readonly-diagnostics\.ps1|invoke-hostguard\.ps1/i.test(pending.stderr.join(''));
    assert.equal(deniedHit, false, 'STDIO_ROUTE_DENIED_HIT:' + pending.stderr.join('').slice(-500));
    return { tools: listed.result.tools, status: JSON.parse(called.result.content[0].text), injectionIsError, stderr: pending.stderr.join('').slice(-1000) };
  } finally {
    child.kill();
    lines.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('consumer process: actual stdio initialize + tools/list exact4 + fixed-purpose factory_status', async () => {
  const fx = buildFixtureData();
  const raw = await readSharedContext(fixtureGet(fx));
  const r = await actualStdioFactoryStatus(raw);
  assert.equal(r.tools.length, 4);
  assert.deepEqual(r.tools.map((t) => t.name).sort(), ['factory_status', 'host_powershell', 'worker_prepare', 'worker_start']);
  const fsTool = r.tools.find((t) => t.name === 'factory_status');
  assert.deepEqual(fsTool.inputSchema?.properties ?? {}, {});
  assert.equal(fsTool.inputSchema?.additionalProperties, false);
  assert.equal(r.injectionIsError, true, 'factory_status must reject caller probe (fixed-purpose)');
  assert.equal(r.status.schema, 'v51.factory-mcp.readonly-diagnostics.v1');
  assert.equal(r.status.hostguard?.read_status, 'AVAILABLE');
});

test('consumer process: factory_status latest 3 columns/digest/fresh-vs-immutable/session-metadata nonregression/no effects', async () => {
  const fx = buildFixtureData();
  const raw = await readSharedContext(fixtureGet(fx));
  const r = await actualStdioFactoryStatus(raw);
  const sc = r.status.shared_context;
  assert.equal(sc.read_status, 'AVAILABLE', JSON.stringify(sc).slice(0, 500));
  assert.equal(sc.progress.read_status, 'READBACK_OK');
  assert.equal(sc.progress.locator_head, e);
  assert.equal(sc.progress.progress_head, e);
  assert.equal(sc.progress.current_digest, fx.expectedCurrentSha);
  assert.equal(sc.progress.manifest_paths_validated, 1);
  assert.equal(sc.human_requested_spec, 'VNEXT5.2');
  assert.equal(sc.progress.columns.construction.spec, 'VNEXT5.2');
  assert.equal(sc.progress.columns.canonical.spec, 'VNEXT5.1-R2');
  assert.equal(sc.progress.columns.canonical.checkpoint, 200);
  assert.equal(sc.progress.columns.installed.version, 'UNKNOWN');
  assert.equal(sc.progress.queue_fresh, true);
  assert.equal(sc.projects[0].checkpoint, 200);
  assert.equal(sc.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
  // expired mutable facts reread-required via second actual stdio session; immutable qualification stable
  const expiredCurrent = JSON.stringify({ schema: 'vnext5.2.construction-progress.v2', observed_at: '2026-10-03T10:27:12.000Z',
    valid_until: '2020-01-01T00:00:00.000Z',
    columns: { construction: { spec: 'VNEXT5.2' }, canonical: { spec: 'VNEXT5.1-R2', head: c, checkpoint: 200, lifecycle: 'ACTIVE' },
      installed: { version: 'UNKNOWN', live_mcp: 'NOT_ACCEPTED' } },
    ready_ids: [], running_ids: [], goal: 'VNEXT5.2' });
  const rExp = await actualStdioFactoryStatus(await readSharedContext(fixtureGet(buildFixtureData({ progressCurrent: expiredCurrent }))));
  assert.equal(rExp.status.shared_context.progress.queue_fresh, false);
  assert.equal(rExp.status.shared_context.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
  // project session metadata read nonregression: distinct owner/run still reads, never transport denial
  const runPayload = { project_id: ids[0], run_id: 'RUN-SDK-001', task_id: 'TASK-SDK-001', attempt_id: 'ATTEMPT-SDK-001' };
  const rMeta = await actualStdioFactoryStatus(await readSharedContext(fixtureGet(buildFixtureData({ owner: 'SESSION-SDK-1',
    runRef: { repository_id_or_resource_id: '1352411536', path: 'run.json', revision: c }, runPayload }))));
  assert.equal(rMeta.status.shared_context.projects[0].run_identity.run_id, 'RUN-SDK-001');
  assert.equal(/GITHUB_READ|GIT_TRANSPORT/.test(JSON.stringify(rMeta.status.shared_context)), false);
  for (const s of [sc, rExp.status.shared_context, rMeta.status.shared_context]) {
    for (const k of ['dispatch', 'host_mutation', 'canonical_write', 'provider_write']) assert.equal(s[k], false);
    assert.equal(s.progress.dispatch_authority, false);
    assert.equal(s.authority, 'READ_ONLY_NO_AUTHORITY');
  }
});
