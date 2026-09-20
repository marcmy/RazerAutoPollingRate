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

function normalizeSerialNumber(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mouseKey(mouse) {
  if (!mouse) return null;
  return [
    mouse.backend,
    Number(mouse.vendorId).toString(16),
    Number(mouse.productId).toString(16),
    normalizeSerialNumber(mouse.serialNumber) || '',
  ].join(':');
}

function knownMouseForHidDevice(device) {
  if (!device
    || device.usagePage !== GENERIC_DESKTOP_USAGE_PAGE
    || device.usage !== MOUSE_USAGE) {
    return null;
  }

  if (device.vendorId === RAZER_VENDOR_ID && dongles[device.productId] !== undefined) {
    return {
      backend: 'razer',
      vendorId: device.vendorId,
      productId: device.productId,
      serialNumber: normalizeSerialNumber(device.serialNumber),
    };
  }

  if (device.vendorId === CRAZYLIGHT_VENDOR_ID && device.productId === CRAZYLIGHT_PRODUCT_ID) {
    return {
      backend: 'pulsar',
      vendorId: device.vendorId,
      productId: device.productId,
      serialNumber: normalizeSerialNumber(device.serialNumber),
    };
  }

  return null;
}

function discoveryTargets(discovery) {
  if (!discovery) return [];

  const targets = [];
  for (const entry of discovery.supportedRazer || []) {
    targets.push({
      backend: 'razer',
      vendorId: entry.identity.vendorId,
      productId: entry.identity.productId,
      serialNumber: normalizeSerialNumber(entry.device && entry.device.serialNumber),
    });
  }
  for (const entry of discovery.knownCrazyLight || []) {
    targets.push({
      backend: 'pulsar',
      vendorId: entry.identity.vendorId,
      productId: entry.identity.productId,
      serialNumber: normalizeSerialNumber(entry.device && entry.device.serialNumber),
    });
  }
  return targets;
}

function sameKnownMouse(left, right) {
  if (!left || !right
    || left.backend !== right.backend
    || left.vendorId !== right.vendorId
    || left.productId !== right.productId) {
    return false;
  }

  const leftSerial = normalizeSerialNumber(left.serialNumber);
  const rightSerial = normalizeSerialNumber(right.serialNumber);
  return !leftSerial || !rightSerial || leftSerial === rightSerial;
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
  let selectedMouse = null;
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

  function recordActivity(mouse, device) {
    const timestamp = now();
    const currentKey = mouseKey(mouse);
    const previousSelected = selectedMouse;
    const previousKey = mouseKey(previousSelected);
    const selectedLastActivity = previousKey
      ? (lastActivity.get(previousKey) || 0)
      : 0;

    lastActivity.set(currentKey, timestamp);

    if (!previousSelected) {
      selectedMouse = mouse;
    } else if (previousKey !== currentKey) {
      const selectedIsIdle = selectedLastActivity === 0
        || timestamp - selectedLastActivity >= idleMs;
      if (selectedIsIdle) {
        selectedMouse = mouse;
      }
    }

    onDiagnostic('mouse_activity_detected', {
      backend: mouse.backend,
      vendorId: mouse.vendorId,
      productId: mouse.productId,
      serialNumber: mouse.serialNumber,
      selectedBackend: selectedMouse ? selectedMouse.backend : null,
      selectedVendorId: selectedMouse ? selectedMouse.vendorId : null,
      selectedProductId: selectedMouse ? selectedMouse.productId : null,
      switched: mouseKey(selectedMouse) !== previousKey,
    });
  }

  function openCandidate(device, mouse) {
    if (!device.path || handles.has(device.path) || typeof hidApi.HID !== 'function') return;

    try {
      const handle = new hidApi.HID(device.path, { nonExclusive: true });
      const entry = { handle, mouse, device };
      handles.set(device.path, entry);

      if (typeof handle.on === 'function') {
        handle.on('data', () => recordActivity(mouse, device));
        handle.on('error', (error) => {
          onDiagnostic('mouse_activity_monitor_error', {
            backend: mouse.backend,
            vendorId: mouse.vendorId,
            productId: mouse.productId,
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
        backend: mouse.backend,
        vendorId: mouse.vendorId,
        productId: mouse.productId,
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
      const mouse = knownMouseForHidDevice(device);
      if (!mouse || !device.path) continue;
      currentPaths.add(device.path);
      openCandidate(device, mouse);
    }

    for (const [path, entry] of handles) {
      if (!currentPaths.has(path)) {
        handles.delete(path);
        closeEntry(entry);
      }
    }
  }

  function currentMonitoredMice(discovery) {
    const available = discoveryTargets(discovery);
    const result = new Map();

    for (const { mouse } of handles.values()) {
      if (!available.some((target) => sameKnownMouse(mouse, target))) continue;
      result.set(mouseKey(mouse), mouse);
    }

    return [...result.values()];
  }

  function choosePreferredMouse(discovery, fallbackMouse = null) {
    refresh();

    const available = discoveryTargets(discovery);
    if (available.length === 0) {
      selectedMouse = null;
      return fallbackMouse;
    }

    if (available.length === 1) {
      selectedMouse = available[0];
      return selectedMouse;
    }

    if (selectedMouse && available.some((target) => sameKnownMouse(selectedMouse, target))) {
      return selectedMouse;
    }

    const monitored = currentMonitoredMice(discovery);
    let best = null;
    let bestTimestamp = 0;
    for (const mouse of monitored) {
      const timestamp = lastActivity.get(mouseKey(mouse)) || 0;
      if (timestamp > bestTimestamp) {
        best = mouse;
        bestTimestamp = timestamp;
      }
    }

    selectedMouse = best || fallbackMouse || available[0];
    return selectedMouse;
  }

  function choosePreferredMousePath(discovery, fallbackPath = null) {
    const fallbackMouse = fallbackPath
      ? discoveryTargets(discovery).find((mouse) => mouse.backend === fallbackPath) || null
      : null;
    const mouse = choosePreferredMouse(discovery, fallbackMouse);
    return mouse ? mouse.backend : fallbackPath;
  }

  function close() {
    for (const entry of handles.values()) closeEntry(entry);
    handles.clear();
  }

  return {
    choosePreferredMouse,
    choosePreferredMousePath,
    close,
    refresh,
    getLastActivity(mouse) {
      return lastActivity.get(typeof mouse === 'string' ? mouse : mouseKey(mouse)) || 0;
    },
    getSelectedMouse() {
      return selectedMouse;
    },
    getSelectedPath() {
      return selectedMouse ? selectedMouse.backend : null;
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
  backendForHidMouse: (device) => {
    const mouse = knownMouseForHidDevice(device);
    return mouse ? mouse.backend : null;
  },
  createMouseActivityTracker,
  getSharedMouseActivityTracker,
  knownMouseForHidDevice,
  mouseKey,
};
