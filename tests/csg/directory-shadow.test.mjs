import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExactShadow, buildAliasMaps, validateDescriptor } from '../../directory/lib/shadow-directory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const descriptor = readJson('directory/descriptor.json');
const index = readJson('directory/aliases/index.json');
const expectedRepo = { id: 1352411536, full_name: 'PT-Original-Point/ptysd-vnext42-governance-sandbox' };
const loader = p => readJson(p);

test('known exact name resolves one project without repository scan', () => {
  const result = resolveExactShadow({ name: '全自動軟體工廠', descriptor, index, projectLoader: loader, expectedRepo, liveDirectoryRevision: 3 });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.project.project_id, 'CHATGPT_GLOBAL_SKILL_GOVERNANCE');
  assert.deepEqual(result.reads, ['descriptor', 'alias_index', 'directory/projects/CHATGPT_GLOBAL_SKILL_GOVERNANCE.json']);
});

test('unknown name returns NOT_FOUND without loading any project', () => {
  let loads = 0;
  const result = resolveExactShadow({ name: '不存在的專案', descriptor, index, projectLoader: () => { loads++; return null; }, expectedRepo });
  assert.equal(result.status, 'NOT_FOUND');
  assert.equal(loads, 0);
  assert.deepEqual(result.reads, ['descriptor', 'alias_index']);
});

test('wrong repository identity is rejected', () => {
  assert.throws(() => validateDescriptor(descriptor, { id: 1, full_name: expectedRepo.full_name }), /ROOT_REPOSITORY_IDENTITY_MISMATCH/);
});

test('tampered descriptor authority is rejected', () => {
  assert.throws(() => validateDescriptor({ ...descriptor, authority_mode: 'CANONICAL' }, expectedRepo), /DESCRIPTOR_AUTHORITY_INVALID/);
});

test('normalized unicode collision across project IDs is rejected', () => {
  const bad = { ...index, aliases: [
    { raw_alias: 'Ａ', normalized_alias: 'a', project_id: 'P1', project_path: 'directory/projects/P1.json' },
    { raw_alias: 'a', normalized_alias: 'a', project_id: 'P2', project_path: 'directory/projects/P2.json' }
  ] };
  assert.throws(() => buildAliasMaps(bad), /NORMALIZED_ALIAS_COLLISION/);
});

test('same raw alias cannot bind two project IDs', () => {
  const bad = { ...index, aliases: [
    { raw_alias: 'X', normalized_alias: 'x', project_id: 'P1', project_path: 'directory/projects/P1.json' },
    { raw_alias: 'X', normalized_alias: 'x2', project_id: 'P2', project_path: 'directory/projects/P2.json' }
  ] };
  assert.throws(() => buildAliasMaps(bad), /RAW_ALIAS_COLLISION/);
});

test('live directory revision mismatch blocks stale shadow use', () => {
  const result = resolveExactShadow({ name: '全自動軟體工廠', descriptor, index, projectLoader: loader, expectedRepo, liveDirectoryRevision: 4 });
  assert.equal(result.status, 'STALE_SHADOW');
  assert.equal(result.project, null);
});

test('off-host mode returns identity as read-only with unverified freshness', () => {
  const result = resolveExactShadow({ name: '全自動軟體工廠', descriptor, index, projectLoader: loader, expectedRepo, liveDirectoryRevision: null });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.freshness, 'UNVERIFIED_OFFHOST_READ_ONLY');
  assert.equal(result.project.project_status, 'RESERVED');
});
