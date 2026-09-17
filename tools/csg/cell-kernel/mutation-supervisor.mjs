import { createHash } from 'node:crypto';

const cells = new Map();
const HEX_RE = /^[0-9a-f]{40,64}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const fail = (code, detail = '') => { throw new Error(detail ? `${code}:${detail}` : code); };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const digest = value => `sha256:${createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
const copy = value => structuredClone(value);
const reqId = (value, name) => { if (typeof value !== 'string' || !ID_RE.test(value)) fail(`INVALID_${name}`); return value; };
const reqGit = (value, name) => { if (typeof value !== 'string' || !HEX_RE.test(value)) fail(`INVALID_${name}`); return value; };
const reqDigest = (value, name) => { if (typeof value !== 'string' || !DIGEST_RE.test(value)) fail(`INVALID_${name}`); return value; };
const reqInt = (value, min, max, name) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`INVALID_${name}`); return value; };

function normalizeHashes(value, name = 'FILE_HASHES') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`INVALID_${name}`);
  const out = {};
  for (const path of Object.keys(value).sort()) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) fail('INVALID_FILE_PATH', path);
    out[path] = reqDigest(value[path], 'FILE_HASH');
  }
  return out;
}

function validatePrestate(prestate) {
  if (!prestate || typeof prestate !== 'object' || Array.isArray(prestate)) fail('INVALID_PRESTATE');
  return {
    base_commit: reqGit(prestate.base_commit, 'BASE_COMMIT'),
    base_tree: reqGit(prestate.base_tree, 'BASE_TREE'),
    file_hashes: normalizeHashes(prestate.file_hashes),
  };
}

function validateExpected(actual, expected) {
  const e = validatePrestate(expected);
  if (e.base_commit !== actual.base_commit) fail('STALE_BASE_HASH', 'base_commit');
  if (e.base_tree !== actual.base_tree) fail('STALE_BASE_HASH', 'base_tree');
  for (const [path, hash] of Object.entries(e.file_hashes)) if (actual.file_hashes[path] !== hash) fail('STALE_FILE_HASH', path);
  return e;
}

function getCell(cellId, runner, initialPrestate, limits) {
  reqId(cellId, 'CELL_ID');
  const existing = cells.get(cellId);
  if (existing) {
    if (runner && existing.runner !== runner) fail('RUNNER_IDENTITY_MISMATCH');
    return existing;
  }
  if (!runner || typeof runner.start !== 'function' || typeof runner.poll !== 'function' || typeof runner.cancel !== 'function') fail('INVALID_RUNNER');
  const cell = {
    cell_id: cellId,
    runner,
    prestate: validatePrestate(initialPrestate),
    mutation_busy: false,
    mutation_revision: 0,
    jobs: new Map(),
    launches: new Map(),
    cursor_map: new Map(),
    limits: {
      max_output_bytes: reqInt(limits?.max_output_bytes ?? 1024, 64, 65536, 'MAX_OUTPUT_BYTES'),
      max_cursor_bytes: reqInt(limits?.max_cursor_bytes ?? 96, 32, 512, 'MAX_CURSOR_BYTES'),
      max_events: reqInt(limits?.max_events ?? 32, 1, 1024, 'MAX_EVENTS'),
    },
  };
  cells.set(cellId, cell);
  return cell;
}

function cursorToken(cell, jobId, raw) {
  if (raw == null || raw === '') return null;
  const token = `c_${createHash('sha256').update(`${cell.cell_id}\0${jobId}\0${String(raw)}`).digest('hex').slice(0, 32)}`;
  if (Buffer.byteLength(token, 'utf8') > cell.limits.max_cursor_bytes) fail('CURSOR_BOUND_INTERNAL');
  cell.cursor_map.set(jobId, { token, raw: String(raw) });
  return token;
}

function resolveCursor(cell, jobId, token) {
  if (token == null || token === '') return null;
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > cell.limits.max_cursor_bytes) fail('INVALID_CURSOR');
  const entry = cell.cursor_map.get(jobId);
  if (!entry || entry.token !== token) fail('UNKNOWN_CURSOR');
  return entry.raw;
}

function boundEvents(events, maxEvents, maxBytes) {
  if (!Array.isArray(events)) fail('INVALID_RUNNER_EVENTS');
  const out = [];
  let bytes = 2;
  for (const event of events.slice(0, maxEvents)) {
    const item = typeof event === 'string' ? event : JSON.stringify(event);
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + (out.length ? 1 : 0);
    if (bytes + itemBytes > maxBytes) break;
    out.push(item);
    bytes += itemBytes;
  }
  return out;
}

export function createJobSupervisor({ cell_id, runner, initial_prestate, limits = {} }) {
  const cell = getCell(cell_id, runner, initial_prestate, limits);
  return {
    async mutate(expected_prestate, operation) {
      if (cell.mutation_busy) fail('MUTATION_LANE_BUSY');
      validateExpected(cell.prestate, expected_prestate);
      if (typeof operation !== 'function') fail('INVALID_MUTATION_OPERATION');
      cell.mutation_busy = true;
      try {
        const result = await operation(copy(cell.prestate));
        if (!result || typeof result !== 'object' || Array.isArray(result)) fail('INVALID_MUTATION_RESULT');
        const next = validatePrestate({
          base_commit: result.base_commit ?? cell.prestate.base_commit,
          base_tree: result.base_tree ?? cell.prestate.base_tree,
          file_hashes: result.file_hashes ?? cell.prestate.file_hashes,
        });
        cell.prestate = next;
        cell.mutation_revision += 1;
        return { mutation_revision: cell.mutation_revision, prestate: copy(next), result: result.result ?? null };
      } finally { cell.mutation_busy = false; }
    },

    async start(job_spec) {
      if (!job_spec || typeof job_spec !== 'object' || Array.isArray(job_spec)) fail('INVALID_JOB_SPEC');
      const jobId = reqId(job_spec.job_id, 'JOB_ID');
      const launchKey = reqId(job_spec.launch_key, 'LAUNCH_KEY');
      const existingId = cell.launches.get(launchKey);
      if (existingId) {
        const existing = cell.jobs.get(existingId);
        if (job_spec.mode === 'background') existing.mode = 'background';
        return copy({ job_id: existing.job_id, process_ref: existing.process_ref, status: existing.status, mode: existing.mode, revision: existing.revision, reused: true });
      }
      if (cell.jobs.has(jobId)) fail('JOB_ID_COLLISION');
      const launched = await cell.runner.start(copy(job_spec));
      if (!launched || typeof launched.process_ref !== 'string' || !launched.process_ref) fail('RUNNER_START_INVALID');
      const job = { job_id: jobId, launch_key: launchKey, process_ref: launched.process_ref, status: launched.status ?? 'RUNNING', mode: job_spec.mode === 'background' ? 'background' : 'foreground', revision: 1, cancel_requested: false, last_cursor: null };
      cell.jobs.set(jobId, job);
      cell.launches.set(launchKey, jobId);
      return copy({ job_id: job.job_id, process_ref: job.process_ref, status: job.status, mode: job.mode, revision: job.revision, reused: false });
    },

    async poll(job_id, since_revision = 0, cursor = null) {
      reqId(job_id, 'JOB_ID');
      reqInt(since_revision, 0, Number.MAX_SAFE_INTEGER, 'SINCE_REVISION');
      const job = cell.jobs.get(job_id); if (!job) fail('JOB_NOT_FOUND');
      if (since_revision > job.revision) fail('FUTURE_REVISION');
      const rawCursor = resolveCursor(cell, job_id, cursor);
      const observed = await cell.runner.poll(job.process_ref, { cursor: rawCursor });
      if (!observed || typeof observed !== 'object' || Array.isArray(observed)) fail('RUNNER_POLL_INVALID');
      const nextStatus = observed.status ?? job.status;
      const events = boundEvents(observed.events ?? [], cell.limits.max_events, cell.limits.max_output_bytes);
      const nextCursor = cursorToken(cell, job_id, observed.cursor ?? rawCursor);
      const changed = nextStatus !== job.status || events.length > 0 || nextCursor !== job.last_cursor;
      if (changed) job.revision += 1;
      job.status = nextStatus;
      job.last_cursor = nextCursor;
      const response = { job_id, status: job.status, revision: job.revision, unchanged: since_revision >= job.revision, events: since_revision >= job.revision ? [] : events, cursor: nextCursor };
      if (Buffer.byteLength(JSON.stringify(response.events), 'utf8') > cell.limits.max_output_bytes) fail('OUTPUT_BOUND_INTERNAL');
      return copy(response);
    },

    async cancel(job_id) {
      reqId(job_id, 'JOB_ID');
      const job = cell.jobs.get(job_id); if (!job) fail('JOB_NOT_FOUND');
      if (!job.cancel_requested) { await cell.runner.cancel(job.process_ref); job.cancel_requested = true; job.revision += 1; }
      return copy({ job_id, status: job.status, cancel_requested: true, revision: job.revision });
    },

    snapshot() {
      return { cell_id: cell.cell_id, mutation_busy: cell.mutation_busy, mutation_revision: cell.mutation_revision, prestate: copy(cell.prestate), jobs: [...cell.jobs.values()].map(copy) };
    },
  };
}

export function supervisorDigest(snapshot) { return digest(snapshot); }
