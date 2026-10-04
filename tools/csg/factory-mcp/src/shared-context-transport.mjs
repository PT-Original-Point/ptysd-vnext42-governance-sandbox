import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { resolve, normalize, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { oid, safePath } from './shared-context.mjs';

const execFileAsync = promisify(execFile);

export const APPROVED_REPOS = new Set([
  'PT-Original-Point/ptysd-vnext42-governance-sandbox',
  't14210184/hanyao',
]);

export const MAX_READ_BYTES = 1048576;
export const MAX_READ_MS = 20000;
export const DEFAULT_TIMEOUT_MS = 8000;
export const MAX_DIAGNOSTIC_BYTES = 4096;

export function gitBlobOid(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

export function validateGitCacheDir(dir) {
  if (dir === undefined || dir === null) return undefined;
  if (typeof dir !== 'string' || !dir.trim()) {
    throw new Error('INVALID_CACHE_DIR');
  }
  if (!isAbsolute(dir)) {
    throw new Error('CACHE_DIR_NOT_ABSOLUTE');
  }
  if (dir.includes('..')) {
    throw new Error('INVALID_CACHE_DIR_TRAVERSAL');
  }
  const normalized = normalize(dir);
  if (normalized.includes('..')) {
    throw new Error('INVALID_CACHE_DIR_TRAVERSAL');
  }
  // Lexical containment only (no symlink resolution, no sandbox framework):
  // operator-provisioned path must equal tmpdir or stay under it via separator boundary.
  const allowedBase = normalize(tmpdir());
  const isWin = process.platform === 'win32';
  const normCmp = isWin ? normalized.toLowerCase() : normalized;
  const baseCmp = isWin ? allowedBase.toLowerCase() : allowedBase;
  const prefix = baseCmp.endsWith(sep) ? baseCmp : baseCmp + sep;
  if (normCmp !== baseCmp && !normCmp.startsWith(prefix)) {
    throw new Error('CACHE_DIR_OUTSIDE_ALLOWED_ROOT');
  }
  return normalized;
}

export function resolveRepoMirror(repo, options = {}) {
  if (options.gitMirrors) {
    const dir = options.gitMirrors instanceof Map
      ? options.gitMirrors.get(repo)
      : options.gitMirrors[repo];
    if (dir) return validateGitCacheDir(dir);
  }
  if (options.gitCacheDir) {
    return validateGitCacheDir(options.gitCacheDir);
  }
  return undefined;
}

export function parseApprovedRoute(route) {
  if (typeof route !== 'string' || !route || route.length > 2048) {
    throw new Error('INVALID_ROUTE');
  }

  // Ref pattern: <repo>/git/ref/heads/<branch>
  const refPrefix = '/git/ref/heads/';
  const refIndex = route.indexOf(refPrefix);
  if (refIndex !== -1) {
    const repo = route.slice(0, refIndex);
    if (!APPROVED_REPOS.has(repo)) {
      throw new Error('REPOSITORY_NOT_APPROVED');
    }
    const rawBranch = route.slice(refIndex + refPrefix.length);
    const branch = decodeURIComponent(rawBranch);
    if (!branch || branch.length > 256 || branch.includes('..') || branch.includes('\\') ||
        branch.startsWith('/') || branch.endsWith('/') || branch.includes('//') ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
      throw new Error('INVALID_BRANCH');
    }
    return { type: 'ref', repo, branch };
  }

  // Contents pattern: <repo>/contents/<path>?ref=<sha>
  const contentsPrefix = '/contents/';
  const contentsIndex = route.indexOf(contentsPrefix);
  if (contentsIndex !== -1) {
    const repo = route.slice(0, contentsIndex);
    if (!APPROVED_REPOS.has(repo)) {
      throw new Error('REPOSITORY_NOT_APPROVED');
    }
    const remainder = route.slice(contentsIndex + contentsPrefix.length);
    const refSplit = remainder.split('?ref=');
    if (refSplit.length !== 2) {
      throw new Error('INVALID_ROUTE');
    }
    const rawPath = refSplit[0];
    const rawSha = refSplit[1];
    const path = rawPath.split('/').map(decodeURIComponent).join('/');
    safePath(path);
    // Strict lower 40hex validation; do not toLowerCase or trim
    const sha = oid(rawSha);
    return { type: 'contents', repo, path, sha };
  }

  throw new Error('INVALID_ROUTE');
}

function getChildEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  };
}

async function extractBoundedDiagnostics(response, maxDiagBytes = MAX_DIAGNOSTIC_BYTES, maxOverallBytes = MAX_READ_BYTES) {
  if (!response.body) {
    if (typeof response.text === 'function') {
      const fullText = await response.text();
      if (Buffer.byteLength(fullText, 'utf8') > maxOverallBytes) {
        throw new Error('READ_BOUND_EXCEEDED');
      }
      return fullText.slice(0, maxDiagBytes);
    }
    return '';
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalRead = 0;
  let diagRead = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalRead += value.length;
      if (totalRead > maxOverallBytes) {
        await reader.cancel();
        throw new Error('READ_BOUND_EXCEEDED');
      }
      if (diagRead < maxDiagBytes) {
        const take = Math.min(value.length, maxDiagBytes - diagRead);
        chunks.push(Buffer.from(value.buffer, value.byteOffset, take));
        diagRead += take;
      }
    }
  } catch (err) {
    if (err.message === 'READ_BOUND_EXCEEDED') throw err;
    return Buffer.concat(chunks).toString('utf8');
  }

  return Buffer.concat(chunks).toString('utf8');
}

export async function httpGet(route, outerSignal, options = {}) {
  parseApprovedRoute(route);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('HTTP_TRANSPORT_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(new Error('GITHUB_READ_TIMEOUT')), timeoutMs);
  timeout.unref?.();
  const abort = () => controller.abort(outerSignal?.reason ?? new Error('SHARED_READ_DEADLINE_EXCEEDED'));
  outerSignal?.addEventListener('abort', abort, { once: true });
  if (outerSignal?.aborted) abort();

  try {
    const response = await fetchImpl('https://api.github.com/repos/' + route, {
      method: 'GET',
      headers: { 'Accept': 'application/vnd.github+json' },
      redirect: 'error',
      signal: controller.signal,
    });

    const rateLimitRemaining = response.headers?.get?.('x-ratelimit-remaining');

    if (!response.ok) {
      // Stream bounded diagnostics (max 4KB, max 1MB overall), never retain full error body
      const diag = await extractBoundedDiagnostics(response, MAX_DIAGNOSTIC_BYTES, MAX_READ_BYTES);

      if (response.status === 429) {
        const err = new Error('GITHUB_READ_429');
        err.status = 429;
        err.isReal429 = true;
        throw err;
      }

      if (response.status === 403) {
        const isBodyRateLimit = rateLimitRemaining === '0' ||
          /rate\s*limit/i.test(diag) ||
          /secondary\s*rate/i.test(diag);
        const err = new Error(isBodyRateLimit ? 'GITHUB_READ_429_BODY' : 'GITHUB_READ_403');
        err.status = 403;
        err.isBody429 = isBodyRateLimit;
        throw err;
      }

      throw new Error('GITHUB_READ_' + response.status);
    }

    const maxBytes = options.maxBytes ?? MAX_READ_BYTES;
    const chunks = [];
    let size = 0;

    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('READ_BOUND_EXCEEDED');
        }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('READ_BOUND_EXCEEDED');
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abort);
  }
}

export async function nativeGitGet(route, outerSignal, options = {}) {
  const parsed = parseApprovedRoute(route);

  if (options.gitAvailable === false) {
    throw new Error('GIT_TRANSPORT_UNAVAILABLE');
  }

  const gitExec = options.gitExec ?? (async (args, execOpts) => {
    return execFileAsync('git', args, execOpts);
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_READ_BYTES;

  if (outerSignal?.aborted) {
    throw (outerSignal.reason ?? new Error('SHARED_READ_DEADLINE_EXCEEDED'));
  }

  if (parsed.type === 'ref') {
    const repoUrl = `https://github.com/${parsed.repo}.git`;
    const args = ['ls-remote', '--heads', repoUrl, parsed.branch];
    const execOpts = {
      shell: false,
      encoding: null, // Native Buffer: preserves raw output exactly
      env: getChildEnv(),
      signal: outerSignal,
      timeout: timeoutMs,
      maxBuffer: maxBytes,
      repo: parsed.repo,
    };

    let result;
    try {
      result = await gitExec(args, execOpts);
    } catch (err) {
      if (err.name === 'AbortError' || outerSignal?.aborted) {
        throw (outerSignal?.reason ?? new Error('SHARED_READ_DEADLINE_EXCEEDED'));
      }
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/.test(err.message)) {
        throw new Error('READ_BOUND_EXCEEDED');
      }
      if (err.code === 'ENOENT') {
        throw new Error('GIT_TRANSPORT_UNAVAILABLE');
      }
      throw new Error(err.message && /^[A-Z0-9_]{1,64}$/.test(err.message) ? err.message : 'GIT_EXEC_FAILED');
    }

    const stdoutBuf = Buffer.isBuffer(result?.stdout ?? result)
      ? (result.stdout ?? result)
      : Buffer.from(result ?? '', 'utf8');

    const stdoutStr = stdoutBuf.toString('utf8');
    const lines = stdoutStr.split(/\r?\n/).filter(Boolean);
    const targetRef = `refs/heads/${parsed.branch}`;

    for (const line of lines) {
      const tabIndex = line.indexOf('\t');
      if (tabIndex === -1) continue;
      const hash = line.slice(0, tabIndex);
      const refName = line.slice(tabIndex + 1);
      if (refName === targetRef) {
        // Strict lower-40hex: no toLowerCase, no loose trim
        const validatedSha = oid(hash);
        return { object: { sha: validatedSha } };
      }
    }

    throw new Error('GIT_REF_NOT_FOUND');
  }

  if (parsed.type === 'contents') {
    const mirrorDir = resolveRepoMirror(parsed.repo, options);
    // Explicit verified designated mirror requirement:
    // If running in live production (no mock gitExec) and no designated mirror directory is configured,
    // native Git cannot read repository objects safely and must fail closed with GIT_TRANSPORT_UNAVAILABLE.
    if (!mirrorDir && !options.gitExec) {
      throw new Error('GIT_TRANSPORT_UNAVAILABLE');
    }

    const targetSpec = `${parsed.sha}:${parsed.path}`;
    const args = ['cat-file', '-p', targetSpec];
    const execOpts = {
      shell: false,
      encoding: null, // Native Buffer: preserves raw binary/UTF-8 bytes and trailing newlines exactly
      env: getChildEnv(),
      signal: outerSignal,
      timeout: timeoutMs,
      maxBuffer: maxBytes,
      cwd: mirrorDir,
      repo: parsed.repo,
    };

    let result;
    try {
      result = await gitExec(args, execOpts);
    } catch (err) {
      if (err.name === 'AbortError' || outerSignal?.aborted) {
        throw (outerSignal?.reason ?? new Error('SHARED_READ_DEADLINE_EXCEEDED'));
      }
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/.test(err.message)) {
        throw new Error('READ_BOUND_EXCEEDED');
      }
      if (err.code === 'ENOENT') {
        throw new Error('GIT_TRANSPORT_UNAVAILABLE');
      }
      throw new Error(err.message && /^[A-Z0-9_]{1,64}$/.test(err.message) ? err.message : 'GIT_EXEC_FAILED');
    }

    const buf = Buffer.isBuffer(result?.stdout ?? result)
      ? (result.stdout ?? result)
      : Buffer.from(result ?? '');

    if (buf.length > maxBytes) {
      throw new Error('READ_BOUND_EXCEEDED');
    }

    const blobSha = gitBlobOid(buf);
    return {
      encoding: 'base64',
      content: buf.toString('base64'),
      sha: blobSha,
    };
  }

  throw new Error('INVALID_ROUTE');
}

export function createSharedContextTransport(options = {}) {
  let httpParked = options.initialHttpParked ?? false;

  return async function sharedContextTransport(route, signal) {
    parseApprovedRoute(route);

    if (!httpParked) {
      try {
        return await httpGet(route, signal, options);
      } catch (err) {
        const is403 = err.message === 'GITHUB_READ_403' || err.status === 403;
        const is429 = err.message === 'GITHUB_READ_429' || err.status === 429 || err.isReal429;
        const isBody429 = err.message === 'GITHUB_READ_429_BODY' || err.isBody429;

        if (is403 || is429 || isBody429) {
          // Park that exact HTTP transport only
          httpParked = true;
          // Try at most one available qualified read-only native transport
          return await nativeGitGet(route, signal, options);
        }

        throw err;
      }
    }

    // HTTP transport is parked; proceed directly with native Git transport
    return await nativeGitGet(route, signal, options);
  };
}
