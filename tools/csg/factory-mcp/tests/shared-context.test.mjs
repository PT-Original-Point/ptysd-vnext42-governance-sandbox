import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, projectSharedContextReadFailure, projectSharedContextReadback, readSharedContext } from '../src/shared-context.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const gov = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const ids = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'HANYAO_ADS_LINE_PROD'];
const branch = 'codex/vnext5.2-shared-construction-20261003-r2';

function fixture() {
  const data = new Map();
  const put = (route, value) => data.set(route, value);
  const file = (repo, path, sha, value) => put(repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha, {
    encoding: 'base64', sha: c,
    content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64'),
  });
  put(gov + '/git/ref/heads/' + encodeURIComponent(branch), {object:{sha:a}});
  put(gov + '/git/ref/heads/' + encodeURIComponent('governance/project-directory'), {object:{sha:b}});
  file(gov, 'governance/csg/vnext5.2/construction/CURRENT.json', a, {
    schema:'vnext5.2.shared-construction-context.v1', project_id:ids[0], canonical_selection_changed:false,
    architecture_path:'01.md', construction_work_index:'work.json', human_requested_spec:'VNEXT5.2', architecture_revision:'V52-R1',
  });
  file(gov, 'governance/csg/vnext5.2/construction/01.md', a, 'architecture');
  file(gov, 'governance/csg/vnext5.2/construction/work.json', a, {
    schema:'vnext5.2.construction-work-index.v1', observed_at:'2026-10-03T09:09:25.438Z',
    entries:[{slice_id:'S-MCP', project_id:ids[0], head:a, staged_tree:b, state:'SOURCE_PROVIDER_CANDIDATE',
      live:'NOT_ACCEPTED_BY_THIS_CAPTURE', inputs:[{source_path:'tools/csg/factory-mcp/src/index.mjs',
        artifact_path:'inputs/S-MCP/tools/csg/factory-mcp/src/index.mjs', sha256:'d'.repeat(64)}]}],
  });
  file(gov, 'directory/descriptor.json', b, {write_policy:'SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE'});
  ids.forEach((projectId, index) => {
    const repo = index ? 't14210184/hanyao' : gov;
    const repositoryId = index ? '1272482826' : '1352411536';
    const controlBranch = index ? 'governance/hanyao-control' : 'v45/factory-control';
    put(repo + '/git/ref/heads/' + encodeURIComponent(controlBranch), {object:{sha:c}});
    file(gov, 'directory/projects/' + projectId + '.json', b, {
      project_id:projectId, binding_id:projectId, binding_generation:1,
      control_locator:{repository_id:repositoryId, ref:'refs/heads/' + controlBranch, current_path:'current.json'},
    });
    const checkpoint = {
      project_id:projectId, checkpoint_seq:index ? 2 : 200, lifecycle:'ACTIVE', stop_requested:false, owner:null,
      unresolved_effect_refs:[], mission_anchor:{ref:'github://' + repositoryId + '/mission.json@' + a},
      policy_anchor:{ref:'github://' + repositoryId + '/policy.json@' + a},
    };
    checkpoint.payload_digest = 'sha256:' + createHash('sha256').update(canonicalJson(checkpoint)).digest('hex');
    file(repo, 'current.json', c, {project_id:projectId, binding_id:projectId, binding_generation:1,
      checkpoint_path:'checkpoint.json', checkpoint_seq:index ? 2 : 200, checkpoint_digest:checkpoint.payload_digest});
    file(repo, 'checkpoint.json', c, checkpoint);
    file(repo, 'mission.json', a, {project_id:projectId, payload:{current_construction_spec:{id:index ? 'HANYAO' : 'VNEXT5.1-R2'}}});
    file(repo, 'policy.json', a, {project_id:projectId});
  });
  return async route => {
    assert(data.has(route), 'unrecognized fixed GET: ' + route);
    return data.get(route);
  };
}

function mcpRequest(child, pending, method, params = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const id = pending.nextId++;
    const timeout = setTimeout(() => {
      pending.waiting.delete(id);
      rejectRequest(new Error('MCP_TEST_TIMEOUT:' + method + ':' + pending.stderr.join('').slice(-2000)));
    }, 10000);
    pending.waiting.set(id, message => {
      clearTimeout(timeout);
      if (message.error) rejectRequest(new Error(JSON.stringify(message.error) + ':' + pending.stderr.join('').slice(-2000)));
      else resolveRequest(message);
    });
    child.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params}) + '\n');
  });
}

test('fixed shared reader binds exact refs and projects independent canonical readbacks without dispatch', async () => {
  const raw = await readSharedContext(fixture());
  const view = projectSharedContextReadback(raw);
  assert.equal(view.read_status, 'AVAILABLE', JSON.stringify(view));
  assert.equal(view.human_requested_spec, 'VNEXT5.2');
  assert.equal(view.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
  assert.equal(view.projects[1].project_id, 'HANYAO_ADS_LINE_PROD');
  assert.equal(view.construction_work.entries[0].slice_id, 'S-MCP');
  assert.equal(view.construction_work.entries[0].input_count, 1);
  for (const key of ['dispatch','host_mutation','canonical_write','provider_write']) assert.equal(view[key], false);
  assert.equal(view.installed_runtime, 'NOT_OBSERVED');
  assert.equal(view.live_mcp, 'NOT_OBSERVED');
  assert.equal(view.authority, 'READ_ONLY_NO_AUTHORITY');
  assert.equal(JSON.stringify(view).includes('requires'), false);
});

test('shared reader rejects moving refs and isolates a scoped Project read failure', async () => {
  const get = fixture();
  let observations = 0;
  await assert.rejects(readSharedContext(async route => route.endsWith('/' + encodeURIComponent(branch)) && ++observations > 1
    ? {object:{sha:b}} : get(route)), /SHARED_OR_DIRECTORY_CHANGED_DURING_READ/);
  const scoped = projectSharedContextReadback(await readSharedContext(route => route.startsWith('t14210184/hanyao/')
    ? Promise.reject(new Error('GITHUB_READ_403')) : get(route)));
  assert.equal(scoped.read_status, 'PARTIAL', JSON.stringify(scoped));
  assert.equal(scoped.projects[0].read_status, 'READBACK_OK');
  assert.equal(scoped.projects[1].read_status, 'UNAVAILABLE');
  assert.equal(scoped.dispatch, false);
});

test('fixed factory_status MCP projection exposes read-only context and keeps exactly four public tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-mcp-shared-context-'));
  const contextPath = join(root, 'context.json');
  const context = await readSharedContext(fixture());
  await writeFile(contextPath, JSON.stringify(context), {flag:'wx'});
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd:packageRoot,
    env:{...process.env, NODE_ENV:'test', PTYSD_FACTORY_MCP_TEST_MODE:'1',
      PTYSD_FACTORY_MCP_TEST_PROJECT_SCOPE:JSON.stringify({schema:'v52.factory-mcp.project-scope.v1', project_id:ids[0], host_id:'TEST-HOST'}),
      PTYSD_FACTORY_MCP_TEST_SHARED_CONTEXT_PATH:contextPath},
    stdio:['pipe','pipe','pipe'], windowsHide:true,
  });
  const pending = {nextId:0, waiting:new Map()};
  pending.stderr = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => pending.stderr.push(chunk));
  child.on('exit', code => {
    for (const resolveRequest of pending.waiting.values()) resolveRequest({error:{code,message:'MCP_CHILD_EXIT_' + code}});
    pending.waiting.clear();
  });
  const lines = createInterface({input:child.stdout, crlfDelay:Infinity});
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.id !== undefined) pending.waiting.get(message.id)?.(message);
  });
  try {
    const initialized = await mcpRequest(child, pending, 'initialize', {
      protocolVersion:'2025-11-25', capabilities:{}, clientInfo:{name:'shared-context-test', version:'1.0.0'},
    });
    assert.equal(initialized.result.serverInfo.name, 'ptysd-factory-mcp');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0', method:'notifications/initialized', params:{}}) + '\n');
    const listed = await mcpRequest(child, pending, 'tools/list');
    assert.deepEqual(listed.result.tools.map(tool => tool.name).sort(), [
      'factory_status','host_powershell','worker_prepare','worker_start',
    ]);
    const called = await mcpRequest(child, pending, 'tools/call', {name:'factory_status', arguments:{}});
    const status = JSON.parse(called.result.content[0].text);
    assert.equal(status.shared_context.read_status, 'AVAILABLE');
    assert.equal(status.shared_context.projects[1].project_id, 'HANYAO_ADS_LINE_PROD');
    assert.equal(listed.result.tools.length, 4);
  } finally {
    child.kill();
    lines.close();
    await rm(root, {recursive:true, force:true});
  }
});

test('shared context failure stays explicitly unavailable and never grants authority', () => {
  const result = projectSharedContextReadFailure(new Error('GITHUB_READ_403'));
  assert.equal(result.read_status, 'UNAVAILABLE');
  assert.equal(result.reason_code, 'GITHUB_READ_403');
  assert.equal(result.dispatch, false);
  assert.equal(result.authority, 'READ_ONLY_NO_AUTHORITY');
});
