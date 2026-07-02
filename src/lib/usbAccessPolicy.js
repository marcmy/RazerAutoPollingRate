'use strict';

function createUsbAccessPolicy(options = {}) {
  const healthMs = options.healthCheckIntervalMs ?? 300000;
  const baseMs = options.errorBackoffBaseMs ?? 5000;
  const maxMs = options.errorBackoffMaxMs ?? 300000;
  let lastTarget = null;
  let lastSuccess = 0;
  let retryAfter = 0;
  let errors = 0;
  let force = true;
  let wasEnabled = null;

  function shouldAccess({ now = Date.now(), targetRate, enabled, firstRun = false }) {
    if (!enabled) {
      wasEnabled = false;
      return { access: false, reason: 'disabled', retryAfter };
    }
    const justEnabled = wasEnabled === false;
    wasEnabled = true;
    const changed = lastTarget !== targetRate;
    if (now < retryAfter) return { access: false, reason: 'backoff', retryAfter, targetChanged: changed };
    if (firstRun) return { access: true, reason: 'startup', targetChanged: changed };
    if (justEnabled) return { access: true, reason: 'enabled', targetChanged: changed };
    if (force) return { access: true, reason: 'retry', targetChanged: changed };
    if (changed) return { access: true, reason: 'target_changed', targetChanged: true };
    if (now - lastSuccess >= healthMs) return { access: true, reason: 'health_check', targetChanged: false };
    return { access: false, reason: 'unchanged', targetChanged: false };
  }

  function recordSuccess({ now = Date.now(), targetRate }) {
    lastTarget = targetRate;
    lastSuccess = now;
    retryAfter = 0;
    errors = 0;
    force = false;
  }

  function recordFailure({ now = Date.now() } = {}) {
    errors += 1;
    const backoffMs = Math.min(maxMs, baseMs * Math.pow(2, errors - 1));
    retryAfter = now + backoffMs;
    force = true;
    return { backoffMs, retryAfter, consecutiveErrors: errors };
  }

  return { shouldAccess, recordSuccess, recordFailure };
}

module.exports = { createUsbAccessPolicy };
