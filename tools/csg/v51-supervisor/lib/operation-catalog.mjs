import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJson} from './fingerprint.mjs';

export const FULL_UNION_COUNT = 59;
export const PARENT_RAW_SHA256 = 'd0f82978679ba8abb720499eeec65ef981f94619b7849e26c7a1c8ac0cab33b5';
export const UNION_CANONICAL_DIGEST = 'sha256:54f2528cf0efdcf457bc83773ba518fa881e93e558b13a3191ba42942f399280';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function shaHex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadUnionCatalog({parentPath, extensionPath, unionPath} = {}) {
  const base = new URL('../operation-plan.vnext5.2.json', import.meta.url);
  const extUrl = new URL('../operation-plan.p52-extension.json', import.meta.url);
  const unionUrl = new URL('../operation-plan.union-59.json', import.meta.url);
  const parentFile = parentPath || base;
  const extFile = extensionPath || extUrl;
  const unionFile = unionPath || unionUrl;
  const parentRaw = fs.readFileSync(parentFile);
  if (shaHex(parentRaw) !== PARENT_RAW_SHA256) fail('OPERATION_PARENT_DIGEST_MISMATCH');
  const parent = JSON.parse(parentRaw.toString('utf8'));
  const ext = JSON.parse(fs.readFileSync(extFile, 'utf8'));
  const union = JSON.parse(fs.readFileSync(unionFile, 'utf8'));
  if (parent.units.length !== 44 || ext.parent_unit_count !== 44 ||
      ext.added_unit_count !== 15 || ext.expected_union_count !== FULL_UNION_COUNT) {
    fail('OPERATION_UNION_COUNT_INVALID');
  }
  if (ext.parent_operation_plan_sha256 !== PARENT_RAW_SHA256) fail('OPERATION_PARENT_DIGEST_MISMATCH');
  if (union.units.length !== FULL_UNION_COUNT ||
      union.parent_unit_count !== 44 || union.expected_union_count !== FULL_UNION_COUNT) {
    fail('OPERATION_UNION_COUNT_INVALID');
  }
  const ids = union.units.map((u) => u.id);
  if (new Set(ids).size !== ids.length) fail('OPERATION_CATALOG_IDS_INVALID');
  const idSet = new Set(ids);
  for (const u of union.units) {
    if (!Array.isArray(u.start_dependencies) || !Array.isArray(u.completion_dependencies) ||
        [...u.start_dependencies, ...u.completion_dependencies].some((id) => !idSet.has(id))) {
      fail(`OPERATION_CATALOG_DEPENDENCY_INVALID:${u.id}`);
    }
  }
  // DAG acyclic for both dependency kinds.
  for (const key of ['start_dependencies', 'completion_dependencies']) {
    const adj = new Map(union.units.map((u) => [u.id, u[key] || []]));
    const state = new Map();
    const visit = (id, stack) => {
      const s = state.get(id);
      if (s === 1) fail(`OPERATION_CATALOG_DEPENDENCY_CYCLE:${key}:${[...stack, id].join('->')}`);
      if (s === 2) return;
      state.set(id, 1);
      for (const dep of adj.get(id) || []) visit(dep, [...stack, id]);
      state.set(id, 2);
    };
    for (const u of union.units) visit(u.id, []);
  }
  // Required parent adjustments must be present.
  const byId = new Map(union.units.map((u) => [u.id, u]));
  if (!byId.get('F01.CELL_PREPARE')?.start_dependencies?.includes('P52.NATIVE_ROUTE_DISCOVERY')) {
    fail('OPERATION_PARENT_ADJUSTMENT_MISSING:F01.CELL_PREPARE');
  }
  if (!byId.get('F01.ISOLATED_EXECUTION')?.start_dependencies?.includes('P52.NATIVE_ROUTE_DISCOVERY')) {
    fail('OPERATION_PARENT_ADJUSTMENT_MISSING:F01.ISOLATED_EXECUTION');
  }
  if (!byId.get('X01.ACCEPT')?.completion_dependencies?.includes('P52.FINAL_PRODUCT_ACCEPTANCE')) {
    fail('OPERATION_PARENT_ADJUSTMENT_MISSING:X01.ACCEPT');
  }
  // Canonical digest check excludes the digest field itself.
  const {union_canonical_digest, ...withoutDigest} = union;
  const computed = `sha256:${createHash('sha256').update(canonicalJson(withoutDigest), 'utf8').digest('hex')}`;
  if (union_canonical_digest !== UNION_CANONICAL_DIGEST || computed !== UNION_CANONICAL_DIGEST) {
    // Enforce exact union identity; do not accept silent catalog drift.
    fail('OPERATION_UNION_DIGEST_MISMATCH');
  }
  return {parent, extension: ext, catalog: union};
}

export function isFullUnionCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.units) || catalog.units.length !== FULL_UNION_COUNT ||
      catalog.union_canonical_digest !== UNION_CANONICAL_DIGEST) return false;
  const {union_canonical_digest, ...payload} = catalog;
  return `sha256:${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}` === UNION_CANONICAL_DIGEST;
}
