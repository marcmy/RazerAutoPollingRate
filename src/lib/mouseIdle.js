'use strict';

const MOUSE_IDLE_MS = 10_000;

// Successful settings belong to a particular device/connection and requested
// state. Never suppress a failed check or a pending game/desktop transition.
//
// Unlike Razer mice, where Synapse can change the rate behind RAPR's back, the
// wireless CrazyLight has no background software rewriting its settings. Once
// a state is verified it is trusted until the requested state, selection or
// receiver connection changes, or a check fails:
// - idle (no real input for idleMs): `pause` — no device traffic at all.
// - in use: `verified` — rate/Turbo reads are skipped; only due battery reads run.
function createMouseIdlePolicy({ now = Date.now, idleMs = MOUSE_IDLE_MS } = {}) {
  const startedAt = now();
  let verified = null;
  let paused = false;

  return {
    decide({ mouse, connectionToken, lastInput = 0, monitorReady = false, targetRate, turboTarget, enabled, selectionKey = '' }) {
      const signature = JSON.stringify([
        mouse?.backend, mouse?.vendorId, mouse?.productId, mouse?.serialNumber || '',
        connectionToken, targetRate, turboTarget, enabled, selectionKey,
      ]);
      const idleAgeMs = Math.max(0, now() - Math.max(lastInput, startedAt));
      const eligible = mouse?.backend === 'pulsar' && mouse.vendorId === 0x3710 && mouse.productId === 0x5406;
      const trusted = eligible && Boolean(connectionToken) && signature === verified;
      const pause = trusted && monitorReady && idleAgeMs >= idleMs;
      // Resuming from idle performs one full check so the tray leaves its idle state.
      const skipVerification = trusted && !pause && !paused;
      const decision = {
        pause, skipVerification, enteredIdle: pause && !paused, resumed: !pause && paused, signature, idleAgeMs,
      };
      paused = pause;
      // A new attempt must succeed before its state can be cached again.
      if (!pause && !skipVerification) verified = null;
      return decision;
    },
    markVerified(signature) { verified = signature; },
    reset() { verified = null; paused = false; },
  };
}

module.exports = { MOUSE_IDLE_MS, createMouseIdlePolicy };
