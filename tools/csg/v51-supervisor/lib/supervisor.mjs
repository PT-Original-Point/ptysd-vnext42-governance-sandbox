import {setTimeout as delay} from 'node:timers/promises';
import {reconcileOnWake} from './reconcile.mjs';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function errorIdentity(error) {
  return String(error?.code || error?.name || error?.message || 'SUPERVISOR_CYCLE_FAILED');
}

function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function providerRetryDelayMs(error, now = Date.now()) {
  if (error?.code !== 'GITHUB_PROVIDER_WAITING_EXTERNAL') return null;
  const retryAfter = retryAfterMs(error.retry_after, now);
  const resetSeconds = Number(error.rate_limit_reset);
  const resetDelay = Number.isFinite(resetSeconds) ? Math.max(0, resetSeconds * 1000 - now) : null;
  const delays = [retryAfter, resetDelay].filter((value) => Number.isFinite(value) && value > 0);
  return delays.length === 0 ? null : Math.min(Math.max(...delays), 2147483647);
}

export async function runSupervisor(config, ports) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('SUPERVISOR_CONFIG_REQUIRED');
  if (config.project_id !== 'CHATGPT_GLOBAL_SKILL_GOVERNANCE' ||
      typeof config.locator !== 'string' || config.locator.length === 0) fail('SUPERVISOR_LOCATOR_REQUIRED');
  if (!config.signal || typeof config.signal.aborted !== 'boolean' ||
      typeof config.signal.addEventListener !== 'function') fail('SUPERVISOR_ABORT_SIGNAL_REQUIRED');
  const intervalMs = config.poll_interval_ms === undefined ? 5000 : config.poll_interval_ms;
  if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 300000) {
    fail('SUPERVISOR_POLL_INTERVAL_INVALID');
  }
  const maxBackoffMs = config.max_backoff_ms === undefined ? 900000 : config.max_backoff_ms;
  if (!Number.isInteger(maxBackoffMs) || maxBackoffMs < intervalMs || maxBackoffMs > 2147483647) {
    fail('SUPERVISOR_MAX_BACKOFF_INVALID');
  }
  if (typeof ports?.appendLocalEvidence !== 'function' || typeof ports?.readProjectDirectory !== 'function') {
    fail('SUPERVISOR_PORTS_REQUIRED');
  }
  if (config.onEvidence !== undefined && typeof config.onEvidence !== 'function') fail('SUPERVISOR_CALLBACK_INVALID');
  if (config.onOperationalError !== undefined && typeof config.onOperationalError !== 'function') {
    fail('SUPERVISOR_CALLBACK_INVALID');
  }
  const wait = ports.wait || ((ms, signal) => delay(ms, undefined, {signal}));
  if (typeof wait !== 'function') fail('SUPERVISOR_WAIT_PORT_INVALID');

  let cycles = 0;
  let evidenceDeltas = 0;
  let lastResult = null;
  let lastError = null;
  let currentDelayMs = intervalMs;
  while (!config.signal.aborted) {
    try {
      // The loop deliberately reconstructs this minimal locator payload each time.
      lastResult = await reconcileOnWake({project_id: config.project_id, locator: config.locator}, ports);
      cycles++;
      lastError = null;
      currentDelayMs = intervalMs;
      if (lastResult.persistence?.status === 'DURABLE_LOCAL_PROJECTION' &&
          lastResult.persistence.new_record === true) {
        evidenceDeltas++;
        await config.onEvidence?.(lastResult);
      }
    } catch (error) {
      cycles++;
      const identity = errorIdentity(error);
      const providerDelay = providerRetryDelayMs(error);
      currentDelayMs = providerDelay === null
        ? (identity === lastError ? Math.min(currentDelayMs * 2, maxBackoffMs) : Math.min(intervalMs, maxBackoffMs))
        : providerDelay;
      if (identity !== lastError) {
        lastError = identity;
        await config.onOperationalError?.({identity, at: new Date().toISOString()});
      }
    }
    if (!config.signal.aborted) {
      try {
        await wait(currentDelayMs, config.signal);
      } catch (error) {
        if (!config.signal.aborted) throw error;
      }
    }
  }
  return {status: 'STOPPED_BY_PROCESS_SIGNAL', cycles, evidence_deltas: evidenceDeltas,
    last_result: lastResult, last_error: lastError};
}
