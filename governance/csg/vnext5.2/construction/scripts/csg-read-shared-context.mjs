import {pathToFileURL} from 'node:url';

const GOV = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const REPOS = new Map([['1352411536', GOV], ['1272482826', 't14210184/hanyao']]);
const IDS = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'HANYAO_ADS_LINE_PROD'];
const BRANCH = 'codex/vnext5.2-shared-construction-20261003';
const PREFIX = 'governance/csg/vnext5.2/construction/';
export function oid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) throw Error('MALFORMED_OID');
  return value;
}
export function safePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') ||
      value.split('/').some(x => !x || x === '.' || x === '..')) throw Error('INVALID_PATH');
  return value;
}
export async function publicGet(route) {
  const response = await fetch('https://api.github.com/repos/' + route, {
    method: 'GET', headers: {'Accept':'application/vnd.github+json'},
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Error('GITHUB_READ_' + response.status);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  for (;;) { const {done, value} = await reader.read(); if (done) break;
    size += value.length; if (size > 1048576) { await reader.cancel(); throw Error('READ_BOUND_EXCEEDED'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function readSharedContext(get = publicGet) {
  const observations = []; const ref = async (repo, branch) =>
    oid((await get(repo + '/git/ref/heads/' + encodeURIComponent(branch))).object.sha);
  const file = async (repo, path, sha) => {
    safePath(path); oid(sha);
    const result = await get(repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha);
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
    const checkpoint = JSON.parse(await file(repo, pointer.checkpoint_path, controlSha));
    if (pointer.project_id !== project_id || checkpoint.project_id !== project_id ||
        pointer.binding_id !== directory.binding_id || pointer.binding_generation !== directory.binding_generation ||
        checkpoint.checkpoint_seq !== pointer.checkpoint_seq ||
        checkpoint.payload_digest !== pointer.checkpoint_digest) throw Error('CONTROL_IDENTITY_MISMATCH');
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
      authority:'EXISTING_CANONICAL_READ_ONLY', digest_role:'DECLARED_PAYLOAD_DIGEST_EQUALITY_NOT_RAW_HASH_RECOMPUTATION'};
  }));
  const projects = results.map((result, i) => result.status === 'fulfilled' ? result.value :
    {project_id:IDS[i], status:'SCOPED_CONTROL_READ_UNAVAILABLE', reason:result.reason.message, authority_granted:false});
  if (await ref(GOV, BRANCH) !== sharedSha || await ref(GOV, 'governance/project-directory') !== directorySha)
    throw Error('SHARED_OR_DIRECTORY_CHANGED_DURING_READ');
  return {schema:'vnext5.2.shared-context-readback.v1', observed_at:new Date().toISOString(),
    shared_head:sharedSha, directory_head:directorySha, human_requested_spec:current.human_requested_spec,
    architecture_revision:current.architecture_revision, projects, observations,
    installed_runtime:'NOT_OBSERVED', live_mcp:'NOT_OBSERVED', ready_queue:'REQUIRES_CURRENT_COMPLETE_FACTS',
    dispatch:false, host_mutation:false, canonical_write:false, provider_write:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await readSharedContext(), null, 2)); }
  catch (error) { console.error(JSON.stringify({status:'SCOPED_READER_ROUTE_FAILURE', reason:error.message,
    ready_evaluated:false, authority_granted:false, fallback:'Use connected GitHub GET at same exact paths; do not blind-retry or infer global exhaustion'})); process.exitCode=1; }
}

