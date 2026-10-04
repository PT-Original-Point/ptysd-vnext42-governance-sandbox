import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  APPROVED_REPOS,
  MAX_READ_BYTES,
  MAX_DIAGNOSTIC_BYTES,
  gitBlobOid,
  validateGitCacheDir,
  resolveRepoMirror,
  parseApprovedRoute,
  httpGet,
  nativeGitGet,
  createSharedContextTransport,
} from '../src/shared-context-transport.mjs';
import {
  canonicalJson,
  checkpointDigest,
  oid,
  safePath,
  publicGet,
  readSharedContext,
  projectSharedContextReadback,
  projectSharedContextReadFailure,
} from '../src/shared-context.mjs';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const e = 'e'.repeat(40);
const gov = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const ids = ['CHATGPT_GLOBAL_SKILL_GOVERNANCE', 'HANYAO_ADS_LINE_PROD'];
const branch = 'codex/vnext5.2-shared-construction-20261003-r2';

function createFixtureData() {
  const refs = new Map();
  const files = new Map();

  refs.set(`${gov}:${branch}`, a);
  refs.set(`${gov}:governance/project-directory`, b);
  refs.set(`${gov}:codex/vnext5.2-construction-latest`, e);
  refs.set(`${gov}:v45/factory-control`, c);
  refs.set(`t14210184/hanyao:governance/hanyao-control`, c);

  const putFile = (repo, path, sha, content) => {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    files.set(`${repo}:${path}:${sha}`, text);
  };

  const progressCurrent = JSON.stringify({
    schema: 'vnext5.2.construction-progress.v2',
    observed_at: '2026-10-03T10:27:12.000Z',
    valid_until: '2999-10-03T10:42:12.000Z',
    columns: {
      construction: { spec: 'VNEXT5.2', contract: 'V52-UNION59-20261003', operations: 59, mission_complete: false },
      canonical: { spec: 'VNEXT5.1-R2', head: c, checkpoint: 200, lifecycle: 'ACTIVE' },
      installed: { version: 'UNKNOWN', live_mcp: 'NOT_ACCEPTED', live_ads: 'NOT_ACCEPTED', survival: 'NOT_ACCEPTED' },
    },
    ready_ids: ['S-MCP'],
    running_ids: [],
    goal: 'VNEXT5.2',
    reviews: { pr385: { semantic: 'FINDINGS' } },
    dispatch_path: 'refs/heads/codex/vnext5.2-construction-latest',
  });
  const progressCurrentSha = 'sha256:' + createHash('sha256').update(progressCurrent, 'utf8').digest('hex');
  const progressManifest = JSON.stringify({
    schema: 'vnext5.2.progress-manifest.v1',
    files: [{ path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json', sha256: progressCurrentSha }],
  });

  putFile(gov, 'governance/csg/vnext5.2/progress/CURRENT.json', e, JSON.stringify({
    schema: 'vnext5.2.progress-locator.v1', noncanonical: true, dispatch_authority: false,
    canonical_selection: false, execution_owner_allocated: false,
    progress: {
      repository: gov, exact_head: e,
      current_path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json',
      current_sha256: progressCurrentSha,
      manifest_path: 'governance/csg/vnext5.2/progress/MANIFEST.json',
    },
  }));
  putFile(gov, 'governance/csg/vnext5.2/progress/CURRENT-20261003.json', e, progressCurrent);
  putFile(gov, 'governance/csg/vnext5.2/progress/MANIFEST.json', e, progressManifest);

  putFile(gov, 'governance/csg/vnext5.2/construction/CURRENT.json', a, {
    schema: 'vnext5.2.shared-construction-context.v1', project_id: ids[0], canonical_selection_changed: false,
    architecture_path: '01.md', construction_work_index: 'work.json',
    human_requested_spec: 'VNEXT5.2', architecture_revision: 'V52-R1',
  });
  putFile(gov, 'governance/csg/vnext5.2/construction/01.md', a, 'architecture');
  putFile(gov, 'governance/csg/vnext5.2/construction/work.json', a, {
    schema: 'vnext5.2.construction-work-index.v1', observed_at: '2026-10-03T09:09:25.438Z',
    entries: [{
      slice_id: 'S-MCP', project_id: ids[0], head: a, staged_tree: b, state: 'SOURCE_PROVIDER_CANDIDATE',
      live: 'NOT_ACCEPTED_BY_THIS_CAPTURE', inputs: [{
        source_path: 'tools/csg/factory-mcp/src/index.mjs',
        artifact_path: 'inputs/S-MCP/tools/csg/factory-mcp/src/index.mjs',
        sha256: 'd'.repeat(64),
      }],
    }],
  });
  putFile(gov, 'directory/descriptor.json', b, { write_policy: 'SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE' });

  ids.forEach((projectId, index) => {
    const repo = index ? 't14210184/hanyao' : gov;
    const repositoryId = index ? '1272482826' : '1352411536';
    const controlBranch = index ? 'governance/hanyao-control' : 'v45/factory-control';
    putFile(gov, 'directory/projects/' + projectId + '.json', b, {
      project_id: projectId, binding_id: projectId, binding_generation: 1,
      control_locator: { repository_id: repositoryId, ref: 'refs/heads/' + controlBranch, current_path: 'current.json' },
    });
    const checkpoint = {
      project_id: projectId, checkpoint_seq: index ? 2 : 200, lifecycle: 'ACTIVE', stop_requested: false, owner: null,
      unresolved_effect_refs: [], mission_anchor: { ref: 'github://' + repositoryId + '/mission.json@' + a },
      policy_anchor: { ref: 'github://' + repositoryId + '/policy.json@' + a },
    };
    if (index) {
      const receipt = {
        schema: 'hanyao.hg10-readback-evidence.v1', project_id: projectId, target_date: '2026-09-17',
        recorded_at_utc: '2026-09-19T07:34:17.381383Z', closure_state: 'REPORTING_DELTA_CONFIRMED',
        d1: { read_only_guard: true, database_id: 'SENSITIVE_DATABASE_ID' },
        google_ads: { target_date_row_returned: true, customer_id: 'SENSITIVE_CUSTOMER_ID' },
        secrets_printed: false, credentials_persisted: false, provider_mutations: 0, conversion_reingest: 0,
      };
      const receiptText = JSON.stringify(receipt);
      const receiptDigest = 'sha256:' + createHash('sha256').update(receiptText, 'utf8').digest('hex');
      const receiptPath = 'governance/hanyao/evidence/HG10_E17_20260917_20260919.json';
      checkpoint.evidence_refs = [{ kind: 'BUNDLE_OBJECT', path: receiptPath, digest: receiptDigest }];
      putFile(repo, receiptPath, c, receiptText);
    } else {
      checkpoint.evidence_refs = [];
    }
    checkpoint.payload_digest = 'sha256:' + createHash('sha256').update(canonicalJson(checkpoint)).digest('hex');
    putFile(repo, 'current.json', c, {
      project_id: projectId, binding_id: projectId, binding_generation: 1,
      checkpoint_path: 'checkpoint.json', checkpoint_seq: index ? 2 : 200, checkpoint_digest: checkpoint.payload_digest,
    });
    putFile(repo, 'checkpoint.json', c, checkpoint);
    putFile(repo, 'mission.json', a, { project_id: projectId, payload: { current_construction_spec: { id: index ? 'HANYAO' : 'VNEXT5.1-R2' } } });
    putFile(repo, 'policy.json', a, { project_id: projectId });
  });

  return { refs, files };
}

function createStrictGitExecutor(fixture) {
  return async (args, execOpts) => {
    assert.equal(execOpts.shell, false, 'git exec must enforce shell: false');
    assert.equal(execOpts.encoding, null, 'git exec must request raw Buffer via encoding: null');
    assert.equal(execOpts.env?.GIT_TERMINAL_PROMPT, '0', 'GIT_TERMINAL_PROMPT must be 0 in child env');
    assert.equal(execOpts.env?.GCM_INTERACTIVE, 'never', 'GCM_INTERACTIVE must be never in child env');
    assert.equal(process.env.GIT_TERMINAL_PROMPT, undefined, 'GIT_TERMINAL_PROMPT must not leak to parent env');

    if (args[0] === 'ls-remote') {
      const repoUrl = args[2];
      const match = /^https:\/\/github\.com\/(.+)\.git$/.exec(repoUrl);
      assert(match, 'invalid git remote URL');
      const repo = match[1];
      const branchName = args[3];
      const sha = fixture.refs.get(`${repo}:${branchName}`);
      if (!sha) return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      return {
        stdout: Buffer.from(`${sha}\trefs/heads/${branchName}\n`, 'utf8'),
        stderr: Buffer.alloc(0),
      };
    }

    if (args[0] === 'cat-file' && args[1] === '-p') {
      const spec = args[2];
      const colonIndex = spec.indexOf(':');
      assert.notEqual(colonIndex, -1, 'cat-file spec must be sha:path');
      const sha = spec.slice(0, colonIndex);
      const path = spec.slice(colonIndex + 1);
      const repo = execOpts.repo;
      assert(repo, 'execOpts.repo must be provided for cat-file');
      const content = fixture.files.get(`${repo}:${path}:${sha}`);
      if (content !== undefined) {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        return { stdout: buf, stderr: Buffer.alloc(0) };
      }
      throw new Error('fatal: Not a valid object name ' + spec);
    }

    throw new Error('UNSUPPORTED_GIT_COMMAND:' + args.join(' '));
  };
}

function createMockHttp403Response(isRateLimit = false, bodyPadding = 64) {
  const message = isRateLimit
    ? 'API rate limit exceeded for unauthenticated user'
    : 'Must have administrative rights to repository.';
  const payload = Buffer.from(JSON.stringify({ message, padding: 'x'.repeat(bodyPadding) }), 'utf8');

  return async () => ({
    ok: false,
    status: 403,
    headers: {
      get: (header) => (header.toLowerCase() === 'x-ratelimit-remaining' && isRateLimit ? '0' : null),
    },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: payload };
          },
          async cancel() {},
        };
      },
    },
    text: async () => payload.toString('utf8'),
  });
}

function createMockHttp429Response() {
  const payload = Buffer.from('Too Many Requests', 'utf8');
  return async () => ({
    ok: false,
    status: 429,
    headers: { get: () => null },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: payload };
          },
          async cancel() {},
        };
      },
    },
    text: async () => payload.toString('utf8'),
  });
}

// FINDING F-A TESTS: publicGet gates every public read entry with parseApprovedRoute
test('F-A: publicGet strictly validates routes and rejects unapproved repositories, unsafe paths, and malformed OIDs', async () => {
  await assert.rejects(
    publicGet('unapproved-org/unapproved-repo/git/ref/heads/main'),
    /REPOSITORY_NOT_APPROVED/
  );
  await assert.rejects(
    publicGet(gov + '/contents/../../etc/passwd?ref=' + a),
    /INVALID_PATH/
  );
  await assert.rejects(
    publicGet(gov + '/contents/valid/file.json?ref=' + 'A'.repeat(40)),
    /MALFORMED_OID/
  );
  await assert.rejects(
    publicGet(gov + '/git/ref/heads/branch;injection'),
    /INVALID_BRANCH/
  );
});

// FINDING F-B TESTS: cat-file requires verified designated mirror or custom gitExec; fail-closed typed GIT_TRANSPORT_UNAVAILABLE
test('F-B: nativeGitGet cat-file throws GIT_TRANSPORT_UNAVAILABLE when no verified mirror is configured', async () => {
  // Call nativeGitGet without options.gitMirrors, options.gitCacheDir, or options.gitExec
  await assert.rejects(
    nativeGitGet(gov + '/contents/valid/path.json?ref=' + a, null, {}),
    /GIT_TRANSPORT_UNAVAILABLE/
  );
});

test('F-B: resolveRepoMirror enforces containment and rejects traversal in gitMirrors configuration', () => {
  const validDir = join(tmpdir(), 'ptysd-mirror-gov');
  const mirrors = { [gov]: validDir };
  assert.equal(resolveRepoMirror(gov, { gitMirrors: mirrors }), validDir);

  const traversalMirrors = { [gov]: tmpdir() + '/../escape' };
  assert.throws(
    () => resolveRepoMirror(gov, { gitMirrors: traversalMirrors }),
    /INVALID_CACHE_DIR_TRAVERSAL/
  );
});

// DEFECT F1 TESTS: Strict lowercase 40hex, reject uppercase and malformed OID
test('F1: parseApprovedRoute strictly rejects uppercase 40hex ref input', () => {
  const upperRef = 'A'.repeat(40);
  assert.throws(
    () => parseApprovedRoute(gov + '/contents/valid/path.json?ref=' + upperRef),
    /MALFORMED_OID/,
    'Uppercase 40hex must be rejected without converting to lowercase'
  );
});

test('F1: nativeGitGet strictly rejects uppercase 40hex in ls-remote output', async () => {
  const upperSha = 'F'.repeat(40);
  const mockExec = async () => ({
    stdout: Buffer.from(`${upperSha}\trefs/heads/${branch}\n`, 'utf8'),
    stderr: Buffer.alloc(0),
  });

  await assert.rejects(
    nativeGitGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { gitExec: mockExec }),
    /MALFORMED_OID/,
    'Uppercase 40hex in git response must trigger MALFORMED_OID'
  );
});

// DEFECT F2 TESTS: Bounded 4KB diagnostics, no retained secrets
test('F2: httpGet streams max 4KB diagnostics for classification without retaining full error body', async () => {
  const secretKey = 'CRITICAL_SECRET_TOKEN_DO_NOT_RETAIN';
  const massiveBody = 'API rate limit exceeded for test user. ' + secretKey.repeat(5000);

  let capturedError = null;
  const mockFetch = async () => ({
    ok: false,
    status: 403,
    headers: { get: () => '0' },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: Buffer.from(massiveBody, 'utf8') };
          },
          async cancel() {},
        };
      },
    },
  });

  try {
    await httpGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { fetch: mockFetch });
  } catch (err) {
    capturedError = err;
  }

  assert(capturedError, 'httpGet must throw on non-200');
  assert.equal(capturedError.message, 'GITHUB_READ_429_BODY');
  assert.equal(capturedError.isBody429, true);
  // Ensure the error object never retained the body or secret
  assert.equal(capturedError.body, undefined);
  assert.equal(JSON.stringify(capturedError).includes(secretKey), false);
});

// DEFECT F3 TESTS: Native Buffer preservation on cat-file exec
test('F3: nativeGitGet preserves exact raw binary bytes and trailing newlines from cat-file', async () => {
  const rawBytes = Buffer.from('RAW_BINARY_DATA\x00\xFF\xFE\r\n\nTRAILING_LINES\n\n\n', 'binary');
  const rawSha = gitBlobOid(rawBytes);

  const mockExec = async (args, execOpts) => {
    assert.equal(execOpts.encoding, null, 'Must request raw Buffer encoding: null');
    assert.equal(args[0], 'cat-file');
    assert.equal(args[1], '-p');
    return { stdout: rawBytes, stderr: Buffer.alloc(0) };
  };

  const result = await nativeGitGet(
    gov + '/contents/valid/binary.dat?ref=' + a,
    null,
    { gitExec: mockExec }
  );

  assert.equal(result.encoding, 'base64');
  assert.equal(result.sha, rawSha);
  const decoded = Buffer.from(result.content, 'base64');
  assert.deepEqual(decoded, rawBytes, 'Decoded bytes must match exact raw Buffer');
});

// DEFECT F4 TESTS: options.gitCacheDir containment validation
test('F4: validateGitCacheDir enforces strict containment within tmpdir, rejects traversal and arbitrary paths', () => {
  const validTemp = join(tmpdir(), 'ptysd-cache-test');
  assert.equal(validateGitCacheDir(validTemp), validTemp);
  assert.equal(validateGitCacheDir(undefined), undefined);
  assert.equal(validateGitCacheDir(null), undefined);

  assert.throws(() => validateGitCacheDir('relative/path'), /CACHE_DIR_NOT_ABSOLUTE/);
  assert.throws(() => validateGitCacheDir(tmpdir() + '/../escape'), /INVALID_CACHE_DIR_TRAVERSAL/);
  assert.throws(() => validateGitCacheDir('C:\\Windows\\System32'), /CACHE_DIR_OUTSIDE_ALLOWED_ROOT/);
  assert.throws(() => validateGitCacheDir('/etc/passwd'), /CACHE_DIR_NOT_ABSOLUTE|CACHE_DIR_OUTSIDE_ALLOWED_ROOT/);
});

// DEFECT F5 & MATRIX TESTS: Full matrix using bounded Response-shaped mocks and injected git executor
test('Matrix 1 & F5: 403 fallback exercises actual cat-file exec path and parks HTTP', async () => {
  const fixture = createFixtureData();
  let httpCalls = 0;
  let catFileCalls = 0;
  let lsRemoteCalls = 0;

  const mockFetch = async () => {
    httpCalls++;
    return (createMockHttp403Response(false))();
  };

  const rawGitRunner = createStrictGitExecutor(fixture);
  const instrumentedGitExec = async (args, execOpts) => {
    if (args[0] === 'ls-remote') lsRemoteCalls++;
    if (args[0] === 'cat-file') catFileCalls++;
    return rawGitRunner(args, execOpts);
  };

  const transport = createSharedContextTransport({
    fetch: mockFetch,
    gitExec: instrumentedGitExec,
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);

  assert.equal(view.read_status, 'AVAILABLE');
  assert.equal(httpCalls, 1, 'HTTP must be called once and parked');
  assert(lsRemoteCalls > 0, 'ls-remote must be executed');
  assert(catFileCalls > 0, 'cat-file must be executed for file reading');
});

test('Matrix 2a: real429 via bounded Response parks HTTP and falls back to git cat-file', async () => {
  const fixture = createFixtureData();
  let httpCalls = 0;

  const mockFetch = async () => {
    httpCalls++;
    return (createMockHttp429Response())();
  };

  const transport = createSharedContextTransport({
    fetch: mockFetch,
    gitExec: createStrictGitExecutor(fixture),
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);
  assert.equal(view.read_status, 'AVAILABLE');
  assert.equal(httpCalls, 1);
});

test('Matrix 2b: body429 via bounded Response parks HTTP and falls back to git cat-file', async () => {
  const fixture = createFixtureData();
  let httpCalls = 0;

  const mockFetch = async () => {
    httpCalls++;
    return (createMockHttp403Response(true))();
  };

  const transport = createSharedContextTransport({
    fetch: mockFetch,
    gitExec: createStrictGitExecutor(fixture),
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);
  assert.equal(view.read_status, 'AVAILABLE');
  assert.equal(httpCalls, 1);
});

test('Matrix 3: transport unavailable when gitAvailable is false', async () => {
  const mockFetch = createMockHttp403Response(false);

  const transport = createSharedContextTransport({
    fetch: mockFetch,
    gitAvailable: false,
  });

  await assert.rejects(
    readSharedContext(transport),
    /GIT_TRANSPORT_UNAVAILABLE/
  );
});

test('Matrix 4a & F5: deadline bound triggers SHARED_READ_DEADLINE_EXCEEDED on abort signal', async () => {
  const controller = new AbortController();
  controller.abort(new Error('SHARED_READ_DEADLINE_EXCEEDED'));

  const transport = createSharedContextTransport({
    fetch: createMockHttp403Response(false),
    gitExec: async () => { throw new Error('UNREACHABLE'); },
    gitAvailable: true,
  });

  await assert.rejects(
    transport(gov + '/git/ref/heads/' + encodeURIComponent(branch), controller.signal),
    /SHARED_READ_DEADLINE_EXCEEDED/
  );
});

test('Matrix 4b & F5: cat-file maxBuffer exceeded triggers READ_BOUND_EXCEEDED', async () => {
  const mockExec = async (args) => {
    if (args[0] === 'cat-file') {
      const err = new Error('stdout maxBuffer length exceeded');
      err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      throw err;
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };

  await assert.rejects(
    nativeGitGet(
      gov + '/contents/valid/large.json?ref=' + a,
      null,
      { gitExec: mockExec }
    ),
    /READ_BOUND_EXCEEDED/
  );
});

test('Matrix 5 & F5: route length > 2048 and arbitrary inputs are strictly rejected', () => {
  const oversizeRoute = gov + '/git/ref/heads/' + 'x'.repeat(2100);
  assert.throws(() => parseApprovedRoute(oversizeRoute), /INVALID_ROUTE/);
  assert.throws(() => parseApprovedRoute('unapproved/repo/git/ref/heads/main'), /REPOSITORY_NOT_APPROVED/);
  assert.throws(() => parseApprovedRoute(gov + '/git/ref/heads/../traversal'), /INVALID_BRANCH/);
  assert.throws(() => parseApprovedRoute(gov + '/contents/../../etc/passwd?ref=' + a), /INVALID_PATH/);
});

test('Matrix 6 & F5: git ENOENT executable error maps to GIT_TRANSPORT_UNAVAILABLE', async () => {
  const mockExec = async () => {
    const err = new Error('spawn git ENOENT');
    err.code = 'ENOENT';
    throw err;
  };

  await assert.rejects(
    nativeGitGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { gitExec: mockExec }),
    /GIT_TRANSPORT_UNAVAILABLE/
  );
});

// FINDING F-C & MATRICES 7..10: Bounded Response-shaped mocks exercising stream diagnostics and cat-file
test('Matrix 7 & F-C: three columns projected independently with bounded Response-shaped mock', async () => {
  const fixture = createFixtureData();
  let httpCalled = false;

  const mockFetch = async () => {
    httpCalled = true;
    return (createMockHttp403Response(false))();
  };

  const transport = createSharedContextTransport({
    fetch: mockFetch,
    gitExec: createStrictGitExecutor(fixture),
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);

  assert.equal(httpCalled, true);
  assert.equal(view.read_status, 'AVAILABLE');
  assert.deepEqual(view.progress.columns.construction, {
    spec: 'VNEXT5.2', contract: 'V52-UNION59-20261003', operations: 59, mission_complete: false,
  });
  assert.deepEqual(view.progress.columns.canonical, {
    spec: 'VNEXT5.1-R2', head: c, checkpoint: 200, lifecycle: 'ACTIVE',
  });
  assert.deepEqual(view.progress.columns.installed, {
    version: 'UNKNOWN', live_mcp: 'NOT_ACCEPTED', live_ads: 'NOT_ACCEPTED', survival: 'NOT_ACCEPTED',
  });
  assert.equal(view.dispatch, false);
  assert.equal(view.authority, 'READ_ONLY_NO_AUTHORITY');
});

test('Matrix 8 & F-C: stale progress facts flag queue_fresh false with bounded Response-shaped mock', async () => {
  const fixture = createFixtureData();
  const expiredCurrent = JSON.stringify({
    schema: 'vnext5.2.construction-progress.v2',
    observed_at: '2026-10-03T10:27:12.000Z',
    valid_until: '2020-01-01T00:00:00.000Z',
    columns: { canonical: { spec: 'VNEXT5.1-R2' } },
    ready_ids: [],
    running_ids: [],
    goal: 'VNEXT5.2',
  });
  const expiredSha = 'sha256:' + createHash('sha256').update(expiredCurrent, 'utf8').digest('hex');
  const expiredManifest = JSON.stringify({
    schema: 'vnext5.2.progress-manifest.v1',
    files: [{ path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json', sha256: expiredSha }],
  });

  fixture.files.set(`${gov}:governance/csg/vnext5.2/progress/CURRENT.json:${e}`, JSON.stringify({
    schema: 'vnext5.2.progress-locator.v1', noncanonical: true, dispatch_authority: false,
    canonical_selection: false, execution_owner_allocated: false,
    progress: {
      repository: gov, exact_head: e,
      current_path: 'governance/csg/vnext5.2/progress/CURRENT-20261003.json',
      current_sha256: expiredSha,
      manifest_path: 'governance/csg/vnext5.2/progress/MANIFEST.json',
    },
  }));
  fixture.files.set(`${gov}:governance/csg/vnext5.2/progress/CURRENT-20261003.json:${e}`, expiredCurrent);
  fixture.files.set(`${gov}:governance/csg/vnext5.2/progress/MANIFEST.json:${e}`, expiredManifest);

  const transport = createSharedContextTransport({
    fetch: createMockHttp403Response(false),
    gitExec: createStrictGitExecutor(fixture),
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);

  assert.equal(view.read_status, 'AVAILABLE');
  assert.equal(view.progress.read_status, 'READBACK_OK');
  assert.equal(view.progress.queue_fresh, false);
  assert.equal(view.projects[0].canonical_control_spec, 'VNEXT5.1-R2');
});

test('Matrix 9 & F-C: tamper detection rejects mismatched digest with bounded Response-shaped mock', async () => {
  const fixture = createFixtureData();
  fixture.files.set(
    `${gov}:governance/csg/vnext5.2/progress/CURRENT-20261003.json:${e}`,
    JSON.stringify({ schema: 'vnext5.2.construction-progress.v2', tampered: true })
  );

  const transport = createSharedContextTransport({
    fetch: createMockHttp403Response(false),
    gitExec: createStrictGitExecutor(fixture),
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);

  assert.equal(view.progress.read_status, 'SCOPED_SOURCE_INDEX_UNAVAILABLE');
  assert.equal(view.progress.reason_code, 'PROGRESS_CURRENT_DIGEST_MISMATCH');
  assert.equal(view.projects[0].read_status, 'READBACK_OK');
});

test('Matrix 10 & F-C: cold new consumer initializes cleanly with bounded Response-shaped mock', async () => {
  const fixture = createFixtureData();
  const transport = createSharedContextTransport({
    fetch: createMockHttp403Response(false),
    gitExec: createStrictGitExecutor(fixture),
    gitAvailable: true,
  });

  const raw = await readSharedContext(transport);
  const view = projectSharedContextReadback(raw);

  assert.equal(view.read_status, 'AVAILABLE');
  assert.equal(view.human_requested_spec, 'VNEXT5.2');
  assert.equal(view.authority, 'READ_ONLY_NO_AUTHORITY');
  assert.equal(view.dispatch, false);
  assert.equal(view.host_mutation, false);
  assert.equal(view.canonical_write, false);
  assert.equal(view.provider_write, false);
});

test('F4-boundary: sibling Temp-evil/tmp-evil rejected, subdir allowed', () => {
  const base = tmpdir();
  const sibling = base + '-evil';
  assert.throws(() => validateGitCacheDir(sibling), /CACHE_DIR_OUTSIDE_ALLOWED_ROOT/);
  const siblingSub = sibling + sep + 'sub';
  assert.throws(() => validateGitCacheDir(siblingSub), /CACHE_DIR_OUTSIDE_ALLOWED_ROOT/);
  const sub = join(base, 'ptysd-allowed-sub');
  assert.equal(validateGitCacheDir(sub), sub);
});

test('F-A-parity: publicGet delegates success via injected fetch', async () => {
  const payload = Buffer.from(JSON.stringify({ object: { sha: a } }), 'utf8');
  let called = 0;
  const mockFetch = async () => {
    called++;
    return {
      ok: true, status: 200, headers: { get: () => null },
      body: { getReader() { let s = false; return { async read() { if (s) return { done: true, value: undefined }; s = true; return { done: false, value: payload }; }, async cancel() {} }; } },
      text: async () => payload.toString('utf8'),
    };
  };
  const out = await publicGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { fetch: mockFetch });
  assert.deepEqual(out, { object: { sha: a } });
  assert.equal(called, 1);
});

test('F-A-parity: publicGet 429/429-body/403 classification matches httpGet', async () => {
  await assert.rejects(publicGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { fetch: createMockHttp429Response() }), /GITHUB_READ_429/);
  try { await publicGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { fetch: createMockHttp403Response(true) }); assert.fail('expected body429'); }
  catch (e) { assert.equal(e.message, 'GITHUB_READ_429_BODY'); assert.equal(e.isBody429, true); }
  try { await publicGet(gov + '/git/ref/heads/' + encodeURIComponent(branch), null, { fetch: createMockHttp403Response(false) }); assert.fail('expected 403'); }
  catch (e) { assert.equal(e.message, 'GITHUB_READ_403'); }
});
