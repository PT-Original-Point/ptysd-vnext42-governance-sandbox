import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createSharedContextTransport, parseApprovedRoute, httpGet} from './shared-context-transport.mjs';

const GOV = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const REPOS = new Map([['1352411536', GOV], ['1272482826', 't14210184/hanyao']]);
const IDS = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'HANYAO_ADS_LINE_PROD'];
const BRANCH = 'codex/vnext5.2-shared-construction-20261003-r2';
const PROGRESS_BRANCH = 'codex/vnext5.2-construction-latest';
const PROGRESS_LOCATOR_PATH = 'governance/csg/vnext5.2/progress/CURRENT.json';
const PROGRESS_PREFIX = 'governance/csg/vnext5.2/progress/';
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
export async function publicGet(route, outerSignal, options = {}) {
  parseApprovedRoute(route);
  return httpGet(route, outerSignal, options);
}
const defaultSharedTransport = createSharedContextTransport();
export {createSharedContextTransport, parseApprovedRoute};
export async function readSharedContext(get = defaultSharedTransport) {
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
  const fileBytes = async (repo, path, sha) => {
    safePath(path); oid(sha);
    const result = await boundedGet(repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha);
    if (result.encoding !== 'base64' || typeof result.content !== 'string') throw Error('INVALID_FILE_RESPONSE');
    const bytes = Buffer.from(result.content, 'base64');
    if (bytes.length > 1048576) throw Error('READ_BOUND_EXCEEDED');
    observations.push({repo, path, revision:sha, blob_oid:oid(result.sha)});
    return bytes;
  };
  const file = async (repo, path, sha) => (await fileBytes(repo, path, sha)).toString('utf8');
  const progressPath = path => {
    const scoped = safePath(path);
    if (!scoped.startsWith(PROGRESS_PREFIX) || scoped.length > 256) throw Error('PROGRESS_PATH_OUT_OF_SCOPE');
    return scoped;
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
  const locatorSha = await (async () => { try { return await ref(GOV, PROGRESS_BRANCH); } catch { return null; } })();
  let progress = {status:'SCOPED_SOURCE_INDEX_UNAVAILABLE', reason:'PROGRESS_LOCATOR_REF_UNAVAILABLE'};
  if (locatorSha) {
    try {
      const locatorText = await file(GOV, PROGRESS_LOCATOR_PATH, locatorSha);
      const locator = JSON.parse(locatorText);
      if (locator.schema !== 'vnext5.2.progress-locator.v1' || locator.noncanonical !== true ||
          locator.dispatch_authority !== false || locator.canonical_selection !== false ||
          locator.execution_owner_allocated !== false) throw Error('LOCATOR_SCOPE_INVALID');
      const pin = locator.progress;
      if (!pin || pin.repository !== GOV || !/^[0-9a-f]{40}$/.test(pin.exact_head ?? '')) throw Error('LOCATOR_IDENTITY_INVALID');
      const currentPath = progressPath(pin.current_path);
      const manifestPath = progressPath(pin.manifest_path);
      const currentBytes = await fileBytes(GOV, currentPath, pin.exact_head);
      const currentDigest = 'sha256:' + createHash('sha256').update(currentBytes).digest('hex');
      if (currentDigest !== pin.current_sha256) throw Error('PROGRESS_CURRENT_DIGEST_MISMATCH');
      const current = JSON.parse(currentBytes.toString('utf8'));
      const manifestText = (await fileBytes(GOV, manifestPath, pin.exact_head)).toString('utf8');
      const manifest = JSON.parse(manifestText);
      if (manifest.schema !== 'vnext5.2.progress-manifest.v1' || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 40)
        throw Error('MANIFEST_INVALID');
      const seenPaths = new Set();
      let currentCovered = false, validated = 0;
      for (const item of manifest.files) {
        if (typeof item?.path !== 'string' || seenPaths.has(item.path) || !/^sha256:[a-f0-9]{64}$/.test(item?.sha256 ?? '')) throw Error('MANIFEST_INVALID');
        const itemPath = progressPath(item.path);
        if (seenPaths.has(itemPath)) throw Error('MANIFEST_INVALID');
        seenPaths.add(itemPath);
        const itemBytes = await fileBytes(GOV, itemPath, pin.exact_head);
        const itemDigest = 'sha256:' + createHash('sha256').update(itemBytes).digest('hex');
        if (itemDigest !== item.sha256) throw Error('MANIFEST_DIGEST_MISMATCH:' + itemPath);
        if (itemPath === currentPath && itemDigest === currentDigest) currentCovered = true;
        validated += 1;
      }
      if (!currentCovered) throw Error('MANIFEST_CURRENT_ENTRY_MISSING');
      if (await ref(GOV, PROGRESS_BRANCH) !== locatorSha) throw Error('PROGRESS_LOCATOR_CHANGED_DURING_READ');
      const validUntil = Date.parse(current?.valid_until ?? '');
      progress = {status:'READBACK_OK', locator_head:locatorSha, progress_head:pin.exact_head,
        current_digest:currentDigest, manifest_paths_validated:validated,
        queue_fresh:Number.isFinite(validUntil) ? validUntil > Date.now() : null,
        observed_at:typeof current?.observed_at === 'string' ? current.observed_at : null,
        valid_until:typeof current?.valid_until === 'string' ? current.valid_until : null,
        columns:current?.columns && typeof current.columns === 'object' && JSON.stringify(current.columns).length <= 4096 ? current.columns : null,
        ready_ids:Array.isArray(current?.ready_ids) && current.ready_ids.length <= 64 ? current.ready_ids : null,
        running_ids:Array.isArray(current?.running_ids) && current.running_ids.length <= 64 ? current.running_ids : null,
        goal:current?.goal && typeof current.goal === 'object' && !Array.isArray(current.goal) || typeof current?.goal === 'string'
          ? current.goal : null,
        reviews:current?.reviews && typeof current.reviews === 'object' && JSON.stringify(current.reviews).length <= 4096 ? current.reviews : null,
        dispatch_path:current?.dispatch_path === 'dispatch.json' ? 'dispatch.json' : null,
        dispatch_authority:false};
    } catch (error) {
      progress = {status:'SCOPED_SOURCE_INDEX_UNAVAILABLE', reason:error.message};
    }
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
    const readReceipts = [];
    if (project_id === 'HANYAO_ADS_LINE_PROD') {
      const refs = checkpoint.evidence_refs ?? [];
      if (!Array.isArray(refs) || refs.length > 32) throw Error('BUSINESS_EVIDENCE_REFS_INVALID');
      const seenEvidence = new Set();
      for (const ref of refs) {
        if (!ref || ref.kind !== 'BUNDLE_OBJECT' || typeof ref.path !== 'string' ||
            !/^governance\/hanyao\/evidence\/[A-Za-z0-9._-]{1,160}\.json$/.test(ref.path) ||
            !/^sha256:[a-f0-9]{64}$/.test(ref.digest ?? '') || seenEvidence.has(ref.path)) {
          throw Error('BUSINESS_EVIDENCE_REF_INVALID');
        }
        seenEvidence.add(ref.path);
        const evidenceBytes = await fileBytes(repo, ref.path, controlSha);
        if (evidenceBytes.length > 65536) throw Error('BUSINESS_EVIDENCE_SIZE_INVALID');
        const evidenceDigest = 'sha256:' + createHash('sha256').update(evidenceBytes).digest('hex');
        if (evidenceDigest !== ref.digest) throw Error('BUSINESS_EVIDENCE_DIGEST_MISMATCH');
        const evidence = JSON.parse(evidenceBytes.toString('utf8'));
        if (evidence.schema !== 'hanyao.hg10-readback-evidence.v1') continue;
        if (evidence.project_id !== project_id || !/^\d{4}-\d\d-\d\d$/.test(evidence.target_date ?? '') ||
            typeof evidence.recorded_at_utc !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(evidence.recorded_at_utc) ||
            !smallToken(evidence.closure_state) || typeof evidence.d1?.read_only_guard !== 'boolean' ||
            typeof evidence.google_ads?.target_date_row_returned !== 'boolean' ||
            typeof evidence.secrets_printed !== 'boolean' || typeof evidence.credentials_persisted !== 'boolean' ||
            !Number.isSafeInteger(evidence.provider_mutations) || evidence.provider_mutations < 0 ||
            !Number.isSafeInteger(evidence.conversion_reingest) || evidence.conversion_reingest < 0) {
          throw Error('BUSINESS_READ_RECEIPT_SHAPE_INVALID');
        }
        readReceipts.push({kind:'HANYAO_DATE_SCOPED_READBACK', path:ref.path, digest:ref.digest,
          target_date:evidence.target_date, recorded_at_utc:evidence.recorded_at_utc,
          closure_state:evidence.closure_state, d1_read_only_guard:evidence.d1.read_only_guard,
          google_ads_target_date_row_returned:evidence.google_ads.target_date_row_returned,
          secrets_printed:evidence.secrets_printed, credentials_persisted:evidence.credentials_persisted,
          provider_mutations:evidence.provider_mutations, conversion_reingest:evidence.conversion_reingest});
      }
    }
    if (await ref(repo, branch) !== controlSha) throw Error('CONTROL_CHANGED_DURING_READ');
    return {project_id, status:'READBACK_OK', control_head:controlSha, checkpoint:checkpoint.checkpoint_seq,
      canonical_control_spec:mission.payload?.current_construction_spec?.id ?? null,
      lifecycle:checkpoint.lifecycle, owner:checkpoint.owner, stop_requested:checkpoint.stop_requested,
      next_legal_transition:checkpoint.next_legal_transition, unresolved_effect_refs:checkpoint.unresolved_effect_refs,
      mission_revision:mission.mission_revision_id ?? null, policy_revision:policy.policy_revision_id ?? null,
      run_identity:run && {run_id:run.run_id, task_id:run.task_id, attempt_id:run.attempt_id},
      read_receipts:readReceipts,
      authority:'EXISTING_CANONICAL_READ_ONLY', digest_profile:cpDigest.profile};
  }));
  const projects = results.map((result, i) => result.status === 'fulfilled' ? result.value :
    {project_id:IDS[i], status:'SCOPED_CONTROL_READ_UNAVAILABLE', reason:result.reason.message, authority_granted:false});
  if (await ref(GOV, BRANCH) !== sharedSha || await ref(GOV, 'governance/project-directory') !== directorySha ||
      (locatorSha !== null && await ref(GOV, PROGRESS_BRANCH) !== locatorSha))
    throw Error('SHARED_OR_DIRECTORY_CHANGED_DURING_READ');
  return {schema:'vnext5.2.shared-context-readback.v1', observed_at:new Date().toISOString(),
    shared_head:sharedSha, directory_head:directorySha, human_requested_spec:current.human_requested_spec,
    architecture_revision:current.architecture_revision, projects, observations,
    construction_work,
    progress,
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
  const receipts = value.read_receipts ?? [];
  if (!Array.isArray(receipts) || receipts.length > 32 || receipts.some(item => !item ||
      item.kind !== 'HANYAO_DATE_SCOPED_READBACK' ||
      !/^governance\/hanyao\/evidence\/[A-Za-z0-9._-]{1,160}\.json$/.test(item.path ?? '') ||
      !/^sha256:[a-f0-9]{64}$/.test(item.digest ?? '') || !/^\d{4}-\d\d-\d\d$/.test(item.target_date ?? '') ||
      !/^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(item.recorded_at_utc ?? '') || !smallToken(item.closure_state) ||
      typeof item.d1_read_only_guard !== 'boolean' || typeof item.google_ads_target_date_row_returned !== 'boolean' ||
      typeof item.secrets_printed !== 'boolean' || typeof item.credentials_persisted !== 'boolean' ||
      !Number.isSafeInteger(item.provider_mutations) || item.provider_mutations < 0 ||
      !Number.isSafeInteger(item.conversion_reingest) || item.conversion_reingest < 0)) return null;
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
    read_receipts: receipts.map(item => ({kind:item.kind, path:item.path, digest:item.digest,
      target_date:item.target_date, recorded_at_utc:item.recorded_at_utc, closure_state:item.closure_state,
      d1_read_only_guard:item.d1_read_only_guard,
      google_ads_target_date_row_returned:item.google_ads_target_date_row_returned,
      secrets_printed:item.secrets_printed, credentials_persisted:item.credentials_persisted,
      provider_mutations:item.provider_mutations, conversion_reingest:item.conversion_reingest})),
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

const progressStates = new Set(['ACTIVE','ACTIVE_WAITING','BLOCKED','COMPLETED','FAIL','FAILED','FINDINGS','IN_PROGRESS',
  'NOT_ACCEPTED','NOT_OBSERVED','PASS','PENDING','READY','RUNNING','SKIPPED_NOT_PASS','STOP','UNKNOWN','WAITING']);
const progressState = value => typeof value === 'string' && progressStates.has(value) ? value : null;
const progressRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function projectProgressColumns(value) {
  if (!progressRecord(value)) return null;
  const result = {};
  const construction = value.construction;
  if (progressRecord(construction)) {
    const safe = {};
    for (const key of ['spec','contract']) { const token = smallToken(construction[key]); if (token) safe[key] = token; }
    if (Number.isSafeInteger(construction.operations) && construction.operations >= 0 && construction.operations <= 1000) safe.operations = construction.operations;
    if (typeof construction.mission_complete === 'boolean') safe.mission_complete = construction.mission_complete;
    if (Object.keys(safe).length) result.construction = safe;
  }
  const canonical = value.canonical;
  if (progressRecord(canonical)) {
    const safe = {};
    const spec = smallToken(canonical.spec); if (spec) safe.spec = spec;
    if (typeof canonical.head === 'string' && /^[0-9a-f]{40}$/.test(canonical.head)) safe.head = canonical.head;
    if (Number.isSafeInteger(canonical.checkpoint) && canonical.checkpoint >= 0 && canonical.checkpoint <= 2147483647) safe.checkpoint = canonical.checkpoint;
    const lifecycle = progressState(canonical.lifecycle); if (lifecycle) safe.lifecycle = lifecycle;
    if (Object.keys(safe).length) result.canonical = safe;
  }
  const installed = value.installed;
  if (progressRecord(installed)) {
    const safe = {};
    if (typeof installed.version === 'string' && /^(?:UNKNOWN|\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.test(installed.version)) safe.version = installed.version;
    for (const key of ['live_mcp','live_ads','survival']) { const state = progressState(installed[key]); if (state) safe[key] = state; }
    if (Object.keys(safe).length) result.installed = safe;
  }
  return Object.keys(result).length ? result : null;
}

function projectProgressGoal(value) {
  if (typeof value === 'string') return smallToken(value);
  if (!progressRecord(value)) return null;
  const result = {};
  for (const key of ['root','worker_luna','automation_id','heartbeat']) {
    const token = smallToken(value[key]); if (token) result[key] = token;
  }
  if (typeof value.app_running_required === 'boolean') result.app_running_required = value.app_running_required;
  return Object.keys(result).length ? result : null;
}

function projectProgressReviews(value) {
  if (!progressRecord(value) || Object.keys(value).length > 16) return null;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^pr\d{1,4}$/i.test(key) || !progressRecord(item)) continue;
    const safe = {};
    if (typeof item.head === 'string' && /^[0-9a-f]{40}$/.test(item.head)) safe.head = item.head;
    for (const field of ['semantic','structural','live']) { const state = progressState(item[field]); if (state) safe[field] = state; }
    if (Object.keys(safe).length) result[key.toLowerCase()] = safe;
  }
  return result;
}

function projectProgress(value) {
  if (!value || !['READBACK_OK','SCOPED_SOURCE_INDEX_UNAVAILABLE'].includes(value.status)) return null;
  if (value.status !== 'READBACK_OK') {
    return {read_status:value.status, reason_code: smallToken(value.reason) ?? 'SCOPED_READ_FAILED'};
  }
  if (!/^[0-9a-f]{40}$/.test(value.locator_head ?? '') || !/^[0-9a-f]{40}$/.test(value.progress_head ?? '') ||
      !/^sha256:[a-f0-9]{64}$/.test(value.current_digest ?? '') ||
       !Number.isSafeInteger(value.manifest_paths_validated) || value.manifest_paths_validated < 0 || value.manifest_paths_validated > 40 ||
      (value.queue_fresh !== true && value.queue_fresh !== false && value.queue_fresh !== null) ||
      (value.observed_at !== null && value.observed_at !== undefined &&
        !(typeof value.observed_at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(value.observed_at))) ||
       (value.valid_until !== null && value.valid_until !== undefined &&
        !(typeof value.valid_until === 'string' && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(value.valid_until)))) return null;
  const boundedId = item => typeof item === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,79}$/.test(item) ? item : null;
  const readyIds = Array.isArray(value.ready_ids) && value.ready_ids.length <= 64
    ? value.ready_ids.map(boundedId) : null;
  const runningIds = Array.isArray(value.running_ids) && value.running_ids.length <= 64
    ? value.running_ids.map(boundedId) : null;
  if ((value.ready_ids !== null && (!Array.isArray(readyIds) || readyIds.some(item => item === null))) ||
      (value.running_ids !== null && (!Array.isArray(runningIds) || runningIds.some(item => item === null))) ||
       (value.goal !== null && value.goal !== undefined && !progressRecord(value.goal) && typeof value.goal !== 'string') ||
       (value.columns !== null && value.columns !== undefined && !progressRecord(value.columns)) ||
       (value.reviews !== null && value.reviews !== undefined && !progressRecord(value.reviews)) ||
      value.dispatch_authority !== false) return null;
  return {read_status:'READBACK_OK', locator_head:value.locator_head, progress_head:value.progress_head,
    current_digest:value.current_digest, manifest_paths_validated:value.manifest_paths_validated,
    queue_fresh:value.queue_fresh ?? null, observed_at:value.observed_at ?? null,
    valid_until:value.valid_until ?? null, columns:projectProgressColumns(value.columns),
    ready_ids:readyIds, running_ids:runningIds,
    goal:projectProgressGoal(value.goal), reviews:projectProgressReviews(value.reviews),
    dispatch_path:value.dispatch_path === 'dispatch.json' ? 'dispatch.json' : null, dispatch_authority:false};
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
  const progress = projectProgress(value.progress);
  if (progress === null) {
    return {schema:'vnext5.2.factory-status.shared-context.v1', read_status:'INVALID', reason_code:'PROGRESS_PROJECTION_INVALID', authority:'READ_ONLY_NO_AUTHORITY'};
  }
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
    progress,
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
