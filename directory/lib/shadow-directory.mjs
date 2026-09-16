const EXPECTED_DESCRIPTOR_SCHEMA = 'CSG_DIRECTORY_SHADOW_DESCRIPTOR_V1';
const EXPECTED_INDEX_SCHEMA = 'CSG_DIRECTORY_ALIAS_INDEX_V1';
const EXPECTED_PROJECT_SCHEMA = 'CSG_DIRECTORY_SHADOW_PROJECT_V1';
const EXPECTED_NORMALIZATION = 'PYTHON_UNICODE_NFKC_CASEFOLD_COLLAPSE_WS_V1';

export function validateDescriptor(descriptor, expectedRepo) {
  if (!descriptor || descriptor.schema !== EXPECTED_DESCRIPTOR_SCHEMA) throw new Error('DESCRIPTOR_SCHEMA_INVALID');
  if (descriptor.authority_mode !== 'SHADOW_NON_AUTHORITATIVE') throw new Error('DESCRIPTOR_AUTHORITY_INVALID');
  if (descriptor.mutation_authority !== false) throw new Error('DESCRIPTOR_MUTATION_AUTHORITY_FORBIDDEN');
  if (descriptor.normalization_version !== EXPECTED_NORMALIZATION) throw new Error('NORMALIZATION_VERSION_MISMATCH');
  if (descriptor.lookup_mode !== 'EXACT_ALIAS_INDEX_NO_REPOSITORY_SCAN') throw new Error('LOOKUP_MODE_INVALID');
  if (expectedRepo && (descriptor.repository_id !== expectedRepo.id || descriptor.repository_full_name !== expectedRepo.full_name)) {
    throw new Error('ROOT_REPOSITORY_IDENTITY_MISMATCH');
  }
  return true;
}

export function buildAliasMaps(index) {
  if (!index || index.schema !== EXPECTED_INDEX_SCHEMA) throw new Error('ALIAS_INDEX_SCHEMA_INVALID');
  if (index.normalization_version !== EXPECTED_NORMALIZATION) throw new Error('NORMALIZATION_VERSION_MISMATCH');
  const raw = new Map();
  const normalized = new Map();
  for (const binding of index.aliases ?? []) {
    if (!binding.raw_alias || !binding.normalized_alias || !binding.project_id || !binding.project_path) throw new Error('ALIAS_BINDING_INVALID');
    if (raw.has(binding.raw_alias) && raw.get(binding.raw_alias).project_id !== binding.project_id) throw new Error('RAW_ALIAS_COLLISION');
    if (normalized.has(binding.normalized_alias) && normalized.get(binding.normalized_alias).project_id !== binding.project_id) throw new Error('NORMALIZED_ALIAS_COLLISION');
    raw.set(binding.raw_alias, binding);
    normalized.set(binding.normalized_alias, binding);
  }
  return { raw, normalized };
}

export function resolveExactShadow({ name, descriptor, index, projectLoader, expectedRepo, liveDirectoryRevision = null }) {
  validateDescriptor(descriptor, expectedRepo);
  const maps = buildAliasMaps(index);
  const binding = maps.raw.get(name);
  if (!binding) return { status: 'NOT_FOUND', project: null, freshness: 'NOT_APPLICABLE', reads: ['descriptor', 'alias_index'] };

  if (liveDirectoryRevision !== null && liveDirectoryRevision !== descriptor.source_directory_revision) {
    return { status: 'STALE_SHADOW', project: null, freshness: 'STALE', reads: ['descriptor', 'alias_index'] };
  }

  const project = projectLoader(binding.project_path);
  if (!project || project.schema !== EXPECTED_PROJECT_SCHEMA) throw new Error('PROJECT_RECORD_SCHEMA_INVALID');
  if (project.shadow_authority !== false) throw new Error('PROJECT_RECORD_AUTHORITY_INVALID');
  if (project.project_id !== binding.project_id) throw new Error('PROJECT_ID_BINDING_MISMATCH');
  if (project.source_directory_revision !== descriptor.source_directory_revision || index.source_directory_revision !== descriptor.source_directory_revision) {
    throw new Error('SHADOW_REVISION_INCONSISTENT');
  }

  return {
    status: 'FOUND',
    project,
    freshness: liveDirectoryRevision === null ? 'UNVERIFIED_OFFHOST_READ_ONLY' : 'LIVE_REVISION_MATCH',
    reads: ['descriptor', 'alias_index', binding.project_path]
  };
}
