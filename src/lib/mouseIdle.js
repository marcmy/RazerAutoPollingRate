'use strict';

const MOUSE_IDLE_MS = 10_000;

// Successful settings belong to a particular device/connection and requested
// state. Never suppress a failed check or a pending game/desktop transition.
function createMouseIdlePolicy({ now = Date.now, idleMs = MOUSE_IDLE_MS } = {}) {
  const startedAt = now();
  let verified = null;
  let paused = false;

  return {
    decide({ mouse, connectionToken, lastInput = 0, monitorReady = false, targetRate, turboTarget, enabled }) {
      const signature = JSON.stringify([
        mouse?.backend, mouse?.vendorId, mouse?.productId, mouse?.serialNumber || '',
        connectionToken, targetRate, turboTarget, enabled,
      ]);
      const idleAgeMs = Math.max(0, now() - Math.max(lastInput, startedAt));
      const eligible = mouse?.backend === 'pulsar' && mouse.vendorId === 0x3710 && mouse.productId === 0x5406;
      const pause = eligible && Boolean(connectionToken) && monitorReady
        && idleAgeMs >= idleMs && signature === verified;
      const decision = { pause, enteredIdle: pause && !paused, resumed: !pause && paused, signature, idleAgeMs };
      paused = pause;
      // A new attempt must succeed before its state can be cached again.
      if (!pause) verified = null;
      return decision;
    },
    markVerified(signature) { verified = signature; },
    reset() { verified = null; paused = false; },
  };
}

module.exports = { MOUSE_IDLE_MS, createMouseIdlePolicy };
