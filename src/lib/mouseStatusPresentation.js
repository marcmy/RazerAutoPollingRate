'use strict';

const NO_SUPPORTED_MOUSE_CONNECTED = 'No supported mouse connected';
const NO_SUPPORTED_MOUSE_FOUND = 'No supported mouse found - Is it disconnected, sleeping, or powered off?';
const MOUSE_PREFIX = 'Mouse: ';
const TURBO_MARKER = ' · Turbo ';

function createMouseStatusNormalizer() {
  let lastStableTurboText = null;

  return function normalizeMouseStatusText(value) {
    const text = String(value || '');

    // Collapse every disconnected variant, including the transient
    // "No supported mouse connected · Turbo unavailable" state, into one
    // coherent message.
    if (text.startsWith(NO_SUPPORTED_MOUSE_CONNECTED)
      || text === NO_SUPPORTED_MOUSE_FOUND) {
      lastStableTurboText = null;
      return NO_SUPPORTED_MOUSE_FOUND;
    }

    if (!text.startsWith(MOUSE_PREFIX)) {
      return text;
    }

    const turboIndex = text.indexOf(TURBO_MARKER);
    if (turboIndex >= 0) {
      const turboState = text.slice(turboIndex + TURBO_MARKER.length).toLowerCase();
      if (turboState === 'on' || turboState === 'off') {
        lastStableTurboText = text;
      }
      return text;
    }

    // CrazyLight probing publishes the product name before its Turbo read
    // finishes. If the same mouse was already showing a complete Turbo state,
    // keep that complete state rather than briefly rendering the bare name.
    if (lastStableTurboText
      && lastStableTurboText.startsWith(`${text}${TURBO_MARKER}`)) {
      return lastStableTurboText;
    }

    // A non-Turbo mouse (for example a Razer) is already a complete state.
    lastStableTurboText = null;
    return text;
  };
}

module.exports = {
  NO_SUPPORTED_MOUSE_CONNECTED,
  NO_SUPPORTED_MOUSE_FOUND,
  createMouseStatusNormalizer,
};
