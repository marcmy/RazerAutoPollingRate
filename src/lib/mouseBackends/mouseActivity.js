'use strict';

const { dongles } = require('../devices');
const {
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
} = require('./pulsarCrazyLight');

const RAZER_VENDOR_ID = 0x1532;
const GENERIC_DESKTOP_USAGE_PAGE = 0x01;
const MOUSE_USAGE = 0x02;
const REFRESH_INTERVAL_MS = 5000;
const ACTIVE_MOUSE_IDLE_MS = 1500;

function loadNodeHid() {
  // Lazy-load so hardware-independent tests never need the native HID binding.
  // eslint-disable-next-line global-require
  return require('node-hid');
}

function backendForHidMouse(device) {
  if (!device
    || device.usagePage !== GENERIC_DESKTOP_USAGE_PAGE
    || device.usage !== MOUSE_USAGE) {
    return null;
  }

  if (device.vendorId === RAZER_VENDOR_ID && dongles[device.productId] !== undefined) {
    return 'razer';
  }

  if (device.vendorId === CRAZYLIGHT_VENDOR_ID && device.productId === CRAZYLIGHT_PRODUCT_ID) {
    return 'pulsar';
  }

  return null;
}

function discoveryHasPath(discovery, path) {
  if (path === 'razer') {
    return Boolean(discovery && discovery.supportedRazer && discovery.supportedRazer.length > 0);
  }
  if (path === 'pulsar') {
    return Boolean(discovery && discovery.knownCrazyLight && discovery.knownCrazyLight.length > 0);
  }
  return false;
}

function createMouseActivityTracker(options = {}) {
  const hidApi = options.hidApi || loadNodeHid();
  const now = options.now || Date.now;
  const log = options.log || (() => {});
  const onDiagnostic = options.onDiagnostic || (() => {});
  const refreshIntervalMs = Number.isFinite(options.refreshIntervalMs)
    ? options.refreshIntervalMs
    : REFRESH_INTERVAL_MS;
  const idleMs = Number.isFinite(options.idleMs)
    ? Math.max(0, options.idleMs)
    : ACTIVE_MOUSE_IDLE_MS;

  const handles = new Map();
  const lastActivity = new Map();
  let selectedPath = null;
  let lastRefresh = Number.NEGATIVE_INFINITY;

  function closeEntry(entry) {
    if (!entry || !entry.handle) return;
    try {
      if (typeof entry.handle.removeAllListeners === 'function') {
        entry.handle.removeAllListeners('data');
        entry.handle.removeAllListeners('error');
      }
      if (typeof entry.handle.close === 'function') entry.handle.close();
    } catch (error) {
      log(`Mouse activity HID close failed: ${error.message}`, true);
    }
  }

  function enumerate() {
    if (typeof hidApi.devices === 'function') return hidApi.devices();
    return [];
  }

  function recordActivity(backend, device) {
    const timestamp = now();
    const previousSelected = selectedPath;
    const selectedLastActivity = previousSelected
      ? (lastActivity.get(previousSelected) || 0)
      : 0;

    lastActivity.set(backend, timestamp);

    if (!previousSelected) {
      selectedPath = backend;
    } else if (previousSelected !== backend) {
      const selectedIsIdle = selectedLastActivity === 0
        || timestamp - selectedLastActivity >= idleMs;
      if (selectedIsIdle) {
        selectedPath = backend;
      }
    }

    onDiagnostic('mouse_activity_detected', {
      backend,
      vendorId: device.vendorId,
      productId: device.productId,
      selected: selectedPath,
      switched: selectedPath !== previousSelected,
    });
  }

  function openCandidate(device, backend) {
    if (!device.path || handles.has(device.path) || typeof hidApi.HID !== 'function') return;

    try {
      const handle = new hidApi.HID(device.path, { nonExclusive: true });
      const entry = { handle, backend, device };
      handles.set(device.path, entry);

      if (typeof handle.on === 'function') {
        handle.on('data', () => recordActivity(backend, device));
        handle.on('error', (error) => {
          onDiagnostic('mouse_activity_monitor_error', {
            backend,
            error: error && error.message ? error.message : String(error),
          });
          const current = handles.get(device.path);
          if (current === entry) {
            handles.delete(device.path);
            closeEntry(entry);
          }
        });
      }
    } catch (error) {
      // Activity tracking is advisory. Failure to monitor one HID collection
      // must never prevent the polling-rate backend itself from working.
      onDiagnostic('mouse_activity_monitor_error', {
        backend,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  function refresh(force = false) {
    const timestamp = now();
    if (!force && timestamp - lastRefresh < refreshIntervalMs) return;
    lastRefresh = timestamp;

    let devices;
    try {
      devices = enumerate() || [];
    } catch (error) {
      onDiagnostic('mouse_activity_enumeration_error', {
        error: error && error.message ? error.message : String(error),
      });
      return;
    }

    const currentPaths = new Set();
    for (const device of devices) {
      const backend = backendForHidMouse(device);
      if (!backend || !device.path) continue;
      currentPaths.add(device.path);
      openCandidate(device, backend);
    }

    for (const [path, entry] of handles) {
      if (!currentPaths.has(path)) {
        handles.delete(path);
        closeEntry(entry);
      }
    }
  }

  function choosePreferredMousePath(discovery, fallbackPath = null) {
    refresh();

    const hasRazer = discoveryHasPath(discovery, 'razer');
    const hasPulsar = discoveryHasPath(discovery, 'pulsar');

    if (!hasRazer && !hasPulsar) {
      selectedPath = null;
      return fallbackPath;
    }

    if (hasRazer && !hasPulsar) {
      selectedPath = 'razer';
      return selectedPath;
    }

    if (hasPulsar && !hasRazer) {
      selectedPath = 'pulsar';
      return selectedPath;
    }

    // Both dongles are present. Keep the last-used mouse sticky. The data
    // handler changes selectedPath only when this mouse has already been idle,
    // so merely enumerating the other dongle can never steal selection.
    if (selectedPath && discoveryHasPath(discovery, selectedPath)) {
      return selectedPath;
    }

    const razerActivity = lastActivity.get('razer') || 0;
    const pulsarActivity = lastActivity.get('pulsar') || 0;
    if (razerActivity > pulsarActivity) {
      selectedPath = 'razer';
    } else if (pulsarActivity > razerActivity) {
      selectedPath = 'pulsar';
    } else {
      selectedPath = fallbackPath;
    }

    return selectedPath;
  }

  function close() {
    for (const entry of handles.values()) closeEntry(entry);
    handles.clear();
  }

  return {
    choosePreferredMousePath,
    close,
    refresh,
    getLastActivity(path) {
      return lastActivity.get(path) || 0;
    },
    getSelectedPath() {
      return selectedPath;
    },
  };
}

let sharedTracker = null;

function getSharedMouseActivityTracker(options = {}) {
  if (!sharedTracker) sharedTracker = createMouseActivityTracker(options);
  return sharedTracker;
}

module.exports = {
  ACTIVE_MOUSE_IDLE_MS,
  backendForHidMouse,
  createMouseActivityTracker,
  getSharedMouseActivityTracker,
};
