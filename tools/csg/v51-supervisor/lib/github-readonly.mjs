import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {canonicalJson} from './fingerprint.mjs';

const API = 'https://api.github.com';
const REPOSITORY = 'PT-Original-Point/ptysd-vnext42-governance-sandbox';
const REPOSITORY_ID = '1352411536';
const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const PROJECT_DIRECTORY_PATH = 'directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json';
const CONTROL_REF = 'refs/heads/v45/factory-control';
const CONTROL_POINTER_PATH = 'governance/csg/current.json';
const CONTENT_LIMIT = 2 * 1024 * 1024;

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function pathForApi(path) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') ||
      path.split('/').some((part) => part === '..' || part.length === 0)) {
    fail('INVALID_GITHUB_REPOSITORY_PATH');
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

function gitBlobOid(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    fail(code);
  }
}

function decodeBase64(value, size) {
  if (typeof value !== 'string') fail('GITHUB_CONTENT_MISSING');
  const compact = value.replace(/\s+/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    fail('GITHUB_CONTENT_BASE64_INVALID');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > CONTENT_LIMIT || (Number.isFinite(size) && size !== bytes.length)) {
    fail('GITHUB_CONTENT_SIZE_INVALID');
  }
  return bytes;
}

function parsePinnedRef(reference) {
  const match = /^github:\/\/([0-9]+)\/(.+)@([0-9a-f]{40})$/.exec(reference || '');
  if (!match || match[1] !== REPOSITORY_ID) fail('CANONICAL_REF_IDENTITY_INVALID');
  return {path: match[2], revision: match[3]};
}

export function createGitHubReadOnlyReader({fetchImpl = globalThis.fetch, cache = new Map()} = {}) {
  if (typeof fetchImpl !== 'function') fail('FETCH_IMPLEMENTATION_REQUIRED');

  async function getJson(url) {
    const previous = cache.get(url);
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    const response = await fetchImpl(url, {method: 'GET', headers});
    if (response.status === 304) {
      if (!previous) fail('GITHUB_CACHE_MISS_ON_NOT_MODIFIED');
      return previous.json;
    }
    if (response.status === 403 || response.status === 429) {
      fail('GITHUB_PROVIDER_WAITING_EXTERNAL', {
        retry_after: response.headers?.get?.('retry-after') || null,
        rate_limit_reset: response.headers?.get?.('x-ratelimit-reset') || null
      });
    }
    if (response.status < 200 || response.status >= 300) {
      fail('GITHUB_READ_FAILED', {status: response.status});
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > CONTENT_LIMIT) fail('GITHUB_RESPONSE_TOO_LARGE');
    const json = parseJson(Buffer.from(raw, 'utf8'), 'GITHUB_JSON_INVALID');
    const etag = response.headers?.get?.('etag') || null;
    if (etag) cache.set(url, {etag, json});
    return json;
  }

  async function getRef(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) fail('CONTROL_REF_NOT_ALLOWED');
    const branch = ref.slice('refs/heads/'.length);
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('%2F');
    const data = await getJson(`${API}/repos/${REPOSITORY}/git/ref/heads/${encodedBranch}`);
    const head = data?.object?.sha;
    if (!/^[0-9a-f]{40}$/.test(head || '')) fail('GITHUB_BRANCH_HEAD_INVALID');
    return head;
  }

  async function getContentFile(path, ref) {
    if (typeof ref !== 'string' || !/^(?:refs\/heads\/)?[A-Za-z0-9._/-]{1,160}$/.test(ref)) {
      fail('GITHUB_CONTENT_REF_INVALID');
    }
    const url = new URL(`${API}/repos/${REPOSITORY}/contents/${pathForApi(path)}`);
    url.searchParams.set('ref', ref.replace(/^refs\/heads\//, ''));
    const response = await getJson(url.href);
    if (response?.type !== 'file' || response.encoding !== 'base64') fail('GITHUB_CONTENT_SHAPE_INVALID');
    const bytes = decodeBase64(response.content, response.size);
    const observedOid = gitBlobOid(bytes);
    if (observedOid !== response.sha) fail('GITHUB_GIT_BLOB_OID_MISMATCH');
    return {path, ref, blob_oid: observedOid, sha256: sha256(bytes), bytes, data: parseJson(bytes, 'GITHUB_FILE_JSON_INVALID')};
  }

  async function readProjectDirectory(wake) {
    if (wake?.project_id !== PROJECT_ID) fail('PROJECT_DIRECTORY_ID_MISMATCH');
    const directoryHead = await getRef('refs/heads/governance/project-directory');
    const file = await getContentFile(PROJECT_DIRECTORY_PATH, directoryHead);
    const directory = file.data;
    if (directory.project_id !== PROJECT_ID || directory.registration_state !== 'BOUND' ||
        directory.control_locator?.provider !== 'github' ||
        directory.control_locator?.ref !== CONTROL_REF ||
        directory.control_locator?.current_path !== CONTROL_POINTER_PATH) {
      fail('PROJECT_DIRECTORY_CONTROL_LOCATOR_INVALID');
    }
    return {...directory, project_directory_head: directoryHead, project_directory_blob_oid: file.blob_oid};
  }

  async function readCurrentPointer(locator) {
    if (locator?.provider !== 'github' || locator.ref !== CONTROL_REF ||
        locator.current_path !== CONTROL_POINTER_PATH) fail('PROJECT_DIRECTORY_CONTROL_LOCATOR_INVALID');
    const controlHead = await getRef(locator.ref);
    const file = await getContentFile(locator.current_path, controlHead);
    if (file.data.project_id !== PROJECT_ID || file.data.schema_version !== 'csg.pointer.v1') {
      fail('CANONICAL_POINTER_IDENTITY_INVALID');
    }
    return {...file.data, ref: locator.ref, path: locator.current_path,
      control_head: controlHead, pointer_blob_oid: file.blob_oid, pointer_sha256: file.sha256};
  }

  async function readCanonicalSnapshot(directory, pointer) {
    if (directory?.project_id !== PROJECT_ID || pointer?.project_id !== PROJECT_ID ||
        pointer.ref !== directory.control_locator?.ref || pointer.path !== directory.control_locator?.current_path) {
      fail('DIRECTORY_POINTER_PROJECT_MISMATCH');
    }
    const checkpointFile = await getContentFile(pointer.checkpoint_path, pointer.control_head);
    const checkpoint = {...checkpointFile.data, path: pointer.checkpoint_path, blob_oid: checkpointFile.blob_oid};
    const checkpointPayload = structuredClone(checkpointFile.data);
    delete checkpointPayload.payload_digest;
    if (checkpoint.checkpoint_seq !== pointer.checkpoint_seq ||
        checkpoint.payload_digest !== pointer.checkpoint_digest ||
        sha256(Buffer.from(canonicalJson(checkpointPayload), 'utf8')) !== pointer.checkpoint_digest) {
      fail('POINTER_CHECKPOINT_DIGEST_MISMATCH');
    }

    const missionRef = parsePinnedRef(checkpoint.mission_anchor?.ref);
    const policyRef = parsePinnedRef(checkpoint.policy_anchor?.ref);
    const missionFile = await getContentFile(missionRef.path, missionRef.revision);
    const policyFile = await getContentFile(policyRef.path, policyRef.revision);
    const runRef = checkpoint.run_ref;
    if (runRef?.provider !== 'GitHub' || String(runRef.repository_id_or_resource_id) !== REPOSITORY_ID ||
        !/^[0-9a-f]{40}$/.test(runRef.revision || '')) fail('CANONICAL_RUN_REF_INVALID');
    const runFile = await getContentFile(runRef.path, runRef.revision);
    const currentPolicyFile = await getContentFile('governance/csg/v51/current-execution-policy.json', pointer.control_head);

    if (missionFile.data.mission_revision_id !== checkpoint.mission_anchor.revision ||
        missionFile.data.mission_hash !== checkpoint.mission_anchor.declared_hash ||
        policyFile.data.policy_revision_id !== checkpoint.policy_anchor.revision ||
        policyFile.data.policy_hash !== checkpoint.policy_anchor.declared_hash ||
        currentPolicyFile.data.policy_hash !== policyFile.data.policy_hash ||
        runFile.sha256 !== runRef.digest) {
      fail('CANONICAL_IMMUTABLE_EVIDENCE_BINDING_MISMATCH');
    }
    return {
      checkpoint,
      mission: {...missionFile.data, path: missionRef.path, blob_oid: missionFile.blob_oid},
      policy: {...policyFile.data, path: policyRef.path, blob_oid: policyFile.blob_oid},
      current_execution_policy: {...currentPolicyFile.data,
        path: 'governance/csg/v51/current-execution-policy.json', blob_oid: currentPolicyFile.blob_oid},
      run: {...runFile.data, path: runRef.path, blob_oid: runFile.blob_oid},
      evidence: {
        control_head: pointer.control_head,
        checkpoint_blob_oid: checkpointFile.blob_oid,
        mission_blob_oid: missionFile.blob_oid,
        policy_blob_oid: policyFile.blob_oid,
        run_blob_oid: runFile.blob_oid,
        current_policy_blob_oid: currentPolicyFile.blob_oid
      }
    };
  }

  return Object.freeze({readProjectDirectory, readCurrentPointer, readCanonicalSnapshot});
}

export const GITHUB_READONLY_REPOSITORY = REPOSITORY;
