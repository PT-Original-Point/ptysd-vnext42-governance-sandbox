const PROJECT_ID = 'CHATGPT_GLOBAL_SKILL_GOVERNANCE';
const DIRECTORY_LOCATOR = 'refs/heads/governance/project-directory';
const TASK_NAME = 'VNEXT5.1-R2-Supervisor';
const SYSTEM_PRINCIPAL = 'NT AUTHORITY\\SYSTEM';
const LOCAL_SERVICE_PRINCIPAL = 'NT AUTHORITY\\LOCAL SERVICE';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SUPERVISOR_TASK_PROFILE_INVALID');
  return value;
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
    !value.startsWith('/') && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

export function validateSupervisorTaskProfile(input) {
  const profile = record(input);
  const principal = record(profile.principal);
  const trigger = record(profile.trigger);
  const action = record(profile.action);
  const settings = record(profile.settings);
  if (profile.schema !== 'VNEXT5_1_R2_SUPERVISOR_TASK_PROFILE_V1' ||
      profile.task_name !== TASK_NAME || profile.task_path !== '\\' ||
      profile.candidate_only !== true || profile.install_acceptance !== 'C7_HOST_ACCEPTANCE_ONLY' ||
      profile.host_effect !== 'REGISTER_ONE_DEDICATED_SCHEDULED_TASK') {
    fail('SUPERVISOR_TASK_PROFILE_IDENTITY_INVALID');
  }
  if (principal.user_id === SYSTEM_PRINCIPAL || principal.user_id !== LOCAL_SERVICE_PRINCIPAL ||
      principal.logon_type !== 'ServiceAccount' || principal.run_level !== 'Limited') {
    fail('SUPERVISOR_TASK_PRINCIPAL_INVALID');
  }
  if (trigger.kind !== 'AtStartup' || trigger.random_delay_seconds !== 30) {
    fail('SUPERVISOR_TASK_STARTUP_TRIGGER_INVALID');
  }
  if (!safeRelativePath(action.node_executable_relative_path) ||
      action.node_executable_relative_path !== 'runtime/node.exe' ||
      !safeRelativePath(action.entrypoint_relative_path) ||
      action.entrypoint_relative_path !== 'bin/host-supervisor.mjs' ||
      action.working_directory !== '.' ||
      JSON.stringify(action.arguments) !== JSON.stringify([
        '--project-id', PROJECT_ID, '--locator', DIRECTORY_LOCATOR
      ])) {
    fail('SUPERVISOR_TASK_ACTION_INVALID');
  }
  if (settings.start_when_available !== true || settings.allow_start_if_on_batteries !== true ||
      settings.stop_if_going_on_batteries !== false || settings.multiple_instances !== 'IgnoreNew' ||
      settings.execution_time_limit_seconds !== 0 ||
      !Number.isInteger(settings.restart_on_failure_count) ||
      settings.restart_on_failure_count < 1 || settings.restart_on_failure_count > 255 ||
      settings.restart_interval_seconds !== 60) {
    fail('SUPERVISOR_TASK_SETTINGS_INVALID');
  }
  return Object.freeze(structuredClone(profile));
}

export const SUPERVISOR_TASK_IDENTITY = Object.freeze({
  task_name: TASK_NAME,
  principal: LOCAL_SERVICE_PRINCIPAL,
  project_id: PROJECT_ID,
  directory_locator: DIRECTORY_LOCATOR
});
