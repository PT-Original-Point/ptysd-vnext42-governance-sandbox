import { createHash } from 'node:crypto';

const identityTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function getStableSystemOperationKey(projectId, capabilityId, operationId) {
  for (const [name, value] of Object.entries({ projectId, capabilityId, operationId })) {
    if (typeof value !== 'string' || !identityTokenPattern.test(value)) {
      throw new Error(`SYSTEM_OPERATION_IDENTITY_INVALID:${name}`);
    }
  }

  const fields = ['PTYSD-SYSTEM-OPERATION-V1', projectId.toUpperCase(), capabilityId.toUpperCase(), operationId.toUpperCase()];
  const canonical = fields.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
