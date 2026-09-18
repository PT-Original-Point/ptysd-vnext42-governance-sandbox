export const MAX_TASKS = 12;
export const MAX_ATTEMPTS = 3;

const requiredString = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`INVALID_${name}`);
  return value;
};

export function validateBoundedContract(contract) {
  if (!contract || contract.schema_version !== 'factory.contract.v1') throw new Error('FORMAL_CONTRACT_REQUIRED');
  requiredString(contract.contract_id, 'CONTRACT_ID');
  requiredString(contract.project_id, 'PROJECT_ID');
  if (!Number.isInteger(contract.revision) || contract.revision < 1) throw new Error('INVALID_CONTRACT_REVISION');
  if (!Array.isArray(contract.tasks) || contract.tasks.length < 1 || contract.tasks.length > MAX_TASKS) throw new Error('INVALID_TASK_COUNT');
  const ids = new Set();
  for (const task of contract.tasks) {
    requiredString(task.task_id, 'TASK_ID');
    if (ids.has(task.task_id)) throw new Error('DUPLICATE_TASK_ID');
    ids.add(task.task_id);
    const attempts = task.max_attempts ?? MAX_ATTEMPTS;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) throw new Error('INVALID_MAX_ATTEMPTS');
  }
  return true;
}
