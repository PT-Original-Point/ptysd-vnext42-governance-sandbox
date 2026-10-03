import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const GOV = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const REPOS = new Map([['1352411536', GOV], ['1272482826', 't14210184/hanyao']]);
const IDS = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'HANYAO_ADS_LINE_PROD'];
const BRANCH = 'codex/vnext5.2-shared-construction-20261003-r2';
const PREFIX = 'governance/csg/vnext5.2/construction/';
const MAX_READ_BYTES = 1048576;
const MAX_READ_MS = 20000;
const digest = value => 'sha256:' + createHash('sha256').update(value, 'utf8').digest('hex');
const smallToken = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
const revision = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(value) ? value : null;
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}
export function checkpointDigest(checkpoint, raw, project_id, path) {
  if (Object.hasOwn(checkpoint, 'payload_digest')) {
    const {payload_digest, ...payload} = checkpoint;
    const computed = digest(canonicalJson(payload));
    if (computed !== payload_digest) throw Error('CHECKPOINT_PAYLOAD_DIGEST_INVALID');
    return {digest:computed, profile:'CANONICAL_JSON_WITHOUT_PAYLOAD_DIGEST'};
  }
  if (project_id === 'HANYAO_ADS_LINE_PROD' && checkpoint.schema_version === 'csg.checkpoint.v1' &&
      checkpoint.checkpoint_seq === 2 && path === 'governance/hanyao/checkpoints/000002.json')
    return {digest:digest(raw), profile:'OBSERVED_HANYAO_CP2_EXACT_UTF8_BYTES_NO_TRIMMING'};
  throw Error('UNSUPPORTED_CHECKPOINT_DIGEST_PROFILE');
}
export function oid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) throw Error('MALFORMED_OID');
  return value;
}
export function safePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') ||
      value.split('/').some(x => !x || x === '.' || x === '..')) throw Error('INVALID_PATH');
  return value;
}
export async function publicGet(route, outerSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('GITHUB_READ_TIMEOUT')), 8000);
  const abort = () => controller.abort(outerSignal?.reason ?? new Error('SHARED_READ_DEADLINE_EXCEEDED'));
  outerSignal?.addEventListener('abort', abort, {once:true});
  if (outerSignal?.aborted) abort();
  try {
  const response = await fetch('https://api.github.com/repos/' + route, {
    method: 'GET', headers: {'Accept':'application/vnd.github+json'},
    redirect: 'error', signal: controller.signal
  });
  if (!response.ok) throw Error('GITHUB_READ_' + response.status);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  for (;;) { const {done, value} = await reader.read(); if (done) break;
    size += value.length; if (size > MAX_READ_BYTES) { await reader.cancel(); throw Error('READ_BOUND_EXCEEDED'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abort);
  }
}
export async function readSharedContext(get = publicGet) {
  const controller = new AbortController();
  const deadline = Date.now() + MAX_READ_MS;
  const timer = setTimeout(() => controller.abort(new Error('SHARED_READ_DEADLINE_EXCEEDED')), MAX_READ_MS);
  timer.unref?.();
  const boundedGet = route => {
    if (Date.now() >= deadline) {
      controller.abort(new Error('SHARED_READ_DEADLINE_EXCEEDED'));
      throw Error('SHARED_READ_DEADLINE_EXCEEDED');
    }
    return get(route, controller.signal);
  };
  try {
  const observations = []; const ref = async (repo, branch) =>
    oid((await boundedGet(repo + '/git/ref/heads/' + encodeURIComponent(branch))).object.sha);
  const file = async (repo, path, sha) => {
    safePath(path); oid(sha);
    const result = await boundedGet(repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha);
    if (result.encoding !== 'base64' || typeof result.content !== 'string') throw Error('INVALID_FILE_RESPONSE');
    const bytes = Buffer.from(result.content, 'base64');
    if (bytes.length > 1048576) throw Error('READ_BOUND_EXCEEDED');
    observations.push({repo, path, revision:sha, blob_oid:oid(result.sha)});
    return bytes.toString('utf8');
  };
  const anchor = async (value, expectedRepo) => {
    const a = typeof value === 'string' ? value : value?.ref;
    const match = /^github:\/\/(\d+)\/(.+)@([0-9a-f]{40})$/.exec(a || '');
    if (!match || REPOS.get(match[1]) !== expectedRepo) throw Error('INVALID_ANCHOR');
    return JSON.parse(await file(expectedRepo, match[2], match[3]));
  };
  const sharedSha = await ref(GOV, BRANCH);
  const current = JSON.parse(await file(GOV, PREFIX + 'CURRENT.json', sharedSha));
  if (current.project_id !== IDS[0] || current.schema !== 'vnext5.2.shared-construction-context.v1' ||
      current.canonical_selection_changed !== false) throw Error('INVALID_SHARED_ROLE');
  await file(GOV, PREFIX + safePath(current.architecture_path), sharedSha);
  let construction_work = {status:'NOT_INDEXED'};
  if (current.construction_work_index) {
    try {
      const index = JSON.parse(await file(GOV, PREFIX + safePath(current.construction_work_index), sharedSha));
      if (index.schema !== 'vnext5.2.construction-work-index.v1' || !Array.isArray(index.entries)) throw Error('INVALID_WORK_INDEX');
      construction_work = {status:'READBACK_OK', snapshot_observed_at:index.observed_at,
        entries:index.entries.map(e => {
          if (!IDS.includes(e.project_id)) throw Error('WORK_PROJECT_MISMATCH');
          return {slice_id:e.slice_id, project_id:e.project_id, source_head:oid(e.head), staged_tree:oid(e.staged_tree),
            state:e.state, live:e.live, inputs:e.inputs.map(f => {
              if (!/^inputs\//.test(safePath(f.artifact_path)) || !/^[0-9a-f]{64}$/.test(f.sha256)) throw Error('INVALID_SOURCE_INPUT');
              return {source_path:safePath(f.source_path), artifact_path:f.artifact_path, sha256:f.sha256};
            })};
        }), role:'SOURCE_SNAPSHOT_NOT_EXECUTION_AUTHORITY'};
    } catch (error) { construction_work={status:'SCOPED_SOURCE_INDEX_UNAVAILABLE',reason:error.message}; }
  }
  const directorySha = await ref(GOV, 'governance/project-directory');
  const descriptor = JSON.parse(await file(GOV, 'directory/descriptor.json', directorySha));
  if (descriptor.write_policy !== 'SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE' &&
      descriptor.write_policy?.mode !== 'SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE') {
    // Descriptor variations are reported, never used to grant writes.
    observations.push({directory_write_policy:descriptor.write_policy, role:'READ_ONLY'});
  }
  const results = await Promise.allSettled(IDS.map(async project_id => {
    const directory = JSON.parse(await file(GOV, 'directory/projects/' + project_id + '.json', directorySha));
    const locator = directory.control_locator;
    const repo = REPOS.get(String(locator?.repository_id));
    if (!repo || directory.project_id !== project_id || !locator.ref.startsWith('refs/heads/')) throw Error('INVALID_LOCATOR');
    const branch = locator.ref.slice(11), controlSha = await ref(repo, branch);
    const pointer = JSON.parse(await file(repo, locator.current_path, controlSha));
    const rawCheckpoint = await file(repo, pointer.checkpoint_path, controlSha);
    const checkpoint = JSON.parse(rawCheckpoint);
    const cpDigest = checkpointDigest(checkpoint, rawCheckpoint, project_id, pointer.checkpoint_path);
    if (pointer.project_id !== project_id || checkpoint.project_id !== project_id ||
        pointer.binding_id !== directory.binding_id || pointer.binding_generation !== directory.binding_generation ||
        checkpoint.checkpoint_seq !== pointer.checkpoint_seq ||
        cpDigest.digest !== pointer.checkpoint_digest) throw Error('CONTROL_IDENTITY_MISMATCH');
    const mission = await anchor(checkpoint.mission_anchor, repo);
    const policy = await anchor(checkpoint.policy_anchor, repo);
    if (mission.project_id !== project_id || policy.project_id !== project_id) throw Error('ANCHOR_PROJECT_MISMATCH');
    let run = null;
    if (checkpoint.run_ref) {
      const r = checkpoint.run_ref;
      if (REPOS.get(String(r.repository_id_or_resource_id)) !== repo) throw Error('INVALID_RUN_REPO');
      run = JSON.parse(await file(repo, r.path, oid(r.revision)));
      if (run.project_id !== project_id) throw Error('RUN_PROJECT_MISMATCH');
    }
    if (await ref(repo, branch) !== controlSha) throw Error('CONTROL_CHANGED_DURING_READ');
    return {project_id, status:'READBACK_OK', control_head:controlSha, checkpoint:checkpoint.checkpoint_seq,
      canonical_control_spec:mission.payload?.current_construction_spec?.id ?? null,
      lifecycle:checkpoint.lifecycle, owner:checkpoint.owner, stop_requested:checkpoint.stop_requested,
      next_legal_transition:checkpoint.next_legal_transition, unresolved_effect_refs:checkpoint.unresolved_effect_refs,
      mission_revision:mission.mission_revision_id ?? null, policy_revision:policy.policy_revision_id ?? null,
      run_identity:run && {run_id:run.run_id, task_id:run.task_id, attempt_id:run.attempt_id},
      authority:'EXISTING_CANONICAL_READ_ONLY', digest_profile:cpDigest.profile};
  }));
  const projects = results.map((result, i) => result.status === 'fulfilled' ? result.value :
    {project_id:IDS[i], status:'SCOPED_CONTROL_READ_UNAVAILABLE', reason:result.reason.message, authority_granted:false});
  if (await ref(GOV, BRANCH) !== sharedSha || await ref(GOV, 'governance/project-directory') !== directorySha)
    throw Error('SHARED_OR_DIRECTORY_CHANGED_DURING_READ');
  return {schema:'vnext5.2.shared-context-readback.v1', observed_at:new Date().toISOString(),
    shared_head:sharedSha, directory_head:directorySha, human_requested_spec:current.human_requested_spec,
    architecture_revision:current.architecture_revision, projects, observations,
    construction_work,
    installed_runtime:'NOT_OBSERVED', live_mcp:'NOT_OBSERVED', ready_queue:'REQUIRES_CURRENT_COMPLETE_FACTS',
    dispatch:false, host_mutation:false, canonical_write:false, provider_write:false};
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function projectProjectReadback(value, expectedProjectId) {
  if (!value || value.project_id !== expectedProjectId) return null;
  if (value.status === 'SCOPED_CONTROL_READ_UNAVAILABLE') {
    return {
      project_id: expectedProjectId,
      read_status: 'UNAVAILABLE',
      reason_code: smallToken(value.reason) ?? 'CONTROL_READ_UNAVAILABLE',
      authority: 'EXISTING_CANONICAL_READ_ONLY',
    };
  }
  if (value.status !== 'READBACK_OK' || !/^[0-9a-f]{40}$/.test(value.control_head ?? '') ||
      !Number.isSafeInteger(value.checkpoint) || value.checkpoint < 0 || value.checkpoint > 2147483647 ||
      !smallToken(value.lifecycle) || typeof value.stop_requested !== 'boolean' ||
      !Array.isArray(value.unresolved_effect_refs) || value.unresolved_effect_refs.length > 128 ||
      value.unresolved_effect_refs.some(ref => !smallToken(ref))) return null;
  const transition = value.next_legal_transition;
  const run = value.run_identity;
  if (transition !== null && transition !== undefined && (!transition || typeof transition !== 'object' ||
      !smallToken(transition.action) || !smallToken(transition.unit_id))) return null;
  if (run !== null && run !== undefined && (!run || typeof run !== 'object' ||
      Object.keys(run).some(key => !['run_id','task_id','attempt_id'].includes(key)) ||
      Object.values(run).some(item => item !== null && item !== undefined && smallToken(item) === null))) return null;
  const project = {
    project_id: expectedProjectId,
    read_status: 'READBACK_OK',
    control_head: value.control_head,
    checkpoint: value.checkpoint,
    canonical_control_spec: value.canonical_control_spec === null ? null : smallToken(value.canonical_control_spec),
    lifecycle: value.lifecycle,
    stop_requested: value.stop_requested,
    unresolved_effect_count: value.unresolved_effect_refs.length,
    mission_revision: revision(value.mission_revision),
    policy_revision: revision(value.policy_revision),
    run_identity: run ? Object.fromEntries(Object.entries(run).map(([key, item]) => [key, item ?? null])) : null,
    next_legal_transition: transition ? {action: transition.action, unit_id: transition.unit_id} : null,
    authority: 'EXISTING_CANONICAL_READ_ONLY',
  };
  if (value.canonical_control_spec !== null && project.canonical_control_spec === null) return null;
  if (value.mission_revision !== null && project.mission_revision === null) return null;
  if (value.policy_revision !== null && project.policy_revision === null) return null;
  return project;
}

function projectConstructionWork(value) {
  if (!value || !['NOT_INDEXED','READBACK_OK','SCOPED_SOURCE_INDEX_UNAVAILABLE'].includes(value.status)) return null;
  if (value.status !== 'READBACK_OK') return {read_status: value.status, entries: []};
  if (!Array.isArray(value.entries) || value.entries.length > 64) return null;
  const entries = [];
  for (const entry of value.entries) {
    if (!entry || !smallToken(entry.slice_id) || !IDS.includes(entry.project_id) ||
        !/^[0-9a-f]{40}$/.test(entry.source_head ?? '') || !/^[0-9a-f]{40}$/.test(entry.staged_tree ?? '') ||
        (entry.state !== null && entry.state !== undefined && !smallToken(entry.state)) ||
        (entry.live !== null && entry.live !== undefined && typeof entry.live !== 'boolean' && !smallToken(entry.live)) ||
        !Array.isArray(entry.inputs) || entry.inputs.length > 256) return null;
    for (const input of entry.inputs) {
      try { safePath(input.source_path); safePath(input.artifact_path); } catch { return null; }
      if (!/^inputs\//.test(input.artifact_path) || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) return null;
    }
    entries.push({slice_id:entry.slice_id, project_id:entry.project_id, source_head:entry.source_head,
      staged_tree:entry.staged_tree, state:entry.state ?? null, live:entry.live ?? null, input_count:entry.inputs.length});
  }
  return {read_status:'READBACK_OK', snapshot_observed_at:revision(value.snapshot_observed_at), entries};
}

export function projectSharedContextReadback(value) {
  const observedAt = typeof value?.observed_at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(value.observed_at)
    ? value.observed_at : null;
  if (!value || value.schema !== 'vnext5.2.shared-context-readback.v1' ||
      !/^[0-9a-f]{40}$/.test(value.shared_head ?? '') || !/^[0-9a-f]{40}$/.test(value.directory_head ?? '') ||
      !smallToken(value.human_requested_spec) || !revision(value.architecture_revision) ||
      value.dispatch !== false || value.host_mutation !== false || value.canonical_write !== false || value.provider_write !== false ||
      value.installed_runtime !== 'NOT_OBSERVED' || value.live_mcp !== 'NOT_OBSERVED' ||
      value.ready_queue !== 'REQUIRES_CURRENT_COMPLETE_FACTS' || !Array.isArray(value.projects) ||
      !observedAt || (value.construction_work?.status === 'READBACK_OK' && !Array.isArray(value.construction_work?.entries))) {
    return {schema:'vnext5.2.factory-status.shared-context.v1', read_status:'INVALID', reason_code:'SHARED_CONTEXT_BINDING_INVALID', authority:'READ_ONLY_NO_AUTHORITY'};
  }
  const projects = IDS.map(id => projectProjectReadback(value.projects.find(item => item?.project_id === id), id));
  const constructionWork = projectConstructionWork(value.construction_work);
  if (projects.some(project => project === null)) {
    return {schema:'vnext5.2.factory-status.shared-context.v1', read_status:'INVALID', reason_code:'CONTROL_PROJECT_PROJECTION_INVALID', authority:'READ_ONLY_NO_AUTHORITY'};
  }
  if (!constructionWork) {
    return {schema:'vnext5.2.factory-status.shared-context.v1', read_status:'INVALID', reason_code:'CONSTRUCTION_WORK_PROJECTION_INVALID', authority:'READ_ONLY_NO_AUTHORITY'};
  }
  const result = {
    schema:'vnext5.2.factory-status.shared-context.v1',
    read_status:projects.every(project => project.read_status === 'READBACK_OK') ? 'AVAILABLE' : 'PARTIAL',
    observed_at:observedAt,
    shared_head:value.shared_head,
    directory_head:value.directory_head,
    human_requested_spec:value.human_requested_spec,
    architecture_revision:value.architecture_revision,
    projects,
    construction_work:constructionWork,
    installed_runtime:'NOT_OBSERVED',
    live_mcp:'NOT_OBSERVED',
    ready_queue:'REQUIRES_CURRENT_COMPLETE_FACTS',
    dispatch:false,
    host_mutation:false,
    canonical_write:false,
    provider_write:false,
    authority:'READ_ONLY_NO_AUTHORITY',
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 32768) {
    return {schema:'vnext5.2.factory-status.shared-context.v1', read_status:'INVALID', reason_code:'PROJECTION_SIZE_EXCEEDED', authority:'READ_ONLY_NO_AUTHORITY'};
  }
  return result;
}

export function projectSharedContextReadFailure(error) {
  const reason = typeof error?.message === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.message)
    ? error.message : 'SCOPED_READ_FAILED';
  return {schema:'vnext5.2.factory-status.shared-context.v1', read_status:'UNAVAILABLE', reason_code:reason,
    authority:'READ_ONLY_NO_AUTHORITY', dispatch:false, host_mutation:false, canonical_write:false, provider_write:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await readSharedContext(), null, 2)); }
  catch (error) { console.error(JSON.stringify({status:'SCOPED_READER_ROUTE_FAILURE', reason:error.message,
    ready_evaluated:false, authority_granted:false, fallback:'Use connected GitHub GET at same exact paths; do not blind-retry or infer global exhaustion'})); process.exitCode=1; }
}
