'use strict';

const { dongles } = require('../devices');
const { requestLatestCheck } = require('../checkGuard');
const {
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
} = require('./pulsarCrazyLight');
const { createWindowsRawMouseMonitor } = require('./windowsRawMouseActivity');

const RAZER_VENDOR_ID = 0x1532;
const GENERIC_DESKTOP_USAGE_PAGE = 0x01;
const MOUSE_USAGE = 0x02;
const REFRESH_INTERVAL_MS = 5000;

function loadNodeHid() {
  // Lazy-load so Windows can use Raw Input without attempting to open
  // OS-owned mouse HID collections.
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

function knownMouseForIdentity(vendorId, productId, extra = {}) {
  if (vendorId === RAZER_VENDOR_ID && dongles[productId] !== undefined) {
    return {
      backend: 'razer',
      vendorId,
      productId,
      serialNumber: normalizeSerialNumber(extra.serialNumber),
      devicePath: extra.devicePath || null,
    };
  }

  if (vendorId === CRAZYLIGHT_VENDOR_ID && productId === CRAZYLIGHT_PRODUCT_ID) {
    return {
      backend: 'pulsar',
      vendorId,
      productId,
      serialNumber: normalizeSerialNumber(extra.serialNumber),
      devicePath: extra.devicePath || null,
    };
  }

  return null;
}

function knownMouseForHidDevice(device) {
  if (!device
    || device.usagePage !== GENERIC_DESKTOP_USAGE_PAGE
    || device.usage !== MOUSE_USAGE) {
    return null;
  }

  return knownMouseForIdentity(device.vendorId, device.productId, {
    serialNumber: device.serialNumber,
    devicePath: device.path,
  });
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
  const platform = options.platform || process.platform;
  const now = options.now || Date.now;
  const log = options.log || (() => {});
  const onDiagnostic = options.onDiagnostic || (() => {});
  const refreshIntervalMs = Number.isFinite(options.refreshIntervalMs)
    ? options.refreshIntervalMs
    : REFRESH_INTERVAL_MS;
  const rawMouseMonitorFactory = options.rawMouseMonitorFactory || createWindowsRawMouseMonitor;
  const hidApi = platform === 'win32' ? null : (options.hidApi || loadNodeHid());

  const handles = new Map();
  const lastActivity = new Map();
  const lastReports = new Map();
  let rawMouseMonitor = null;
  let selectedMouse = null;
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let onActiveMouseChanged = typeof options.onActiveMouseChanged === 'function'
    ? options.onActiveMouseChanged
    : null;

  function recordActivity(mouse) {
    if (!mouse) return;

    const timestamp = now();
    const currentKey = mouseKey(mouse);
    const previousSelected = selectedMouse;
    const previousKey = mouseKey(previousSelected);

    lastActivity.set(currentKey, timestamp);
    selectedMouse = mouse;

    const switched = previousKey !== currentKey;
    onDiagnostic('mouse_activity_detected', {
      backend: mouse.backend,
      vendorId: mouse.vendorId,
      productId: mouse.productId,
      serialNumber: mouse.serialNumber,
      devicePath: mouse.devicePath || null,
      selectedBackend: selectedMouse.backend,
      selectedVendorId: selectedMouse.vendorId,
      selectedProductId: selectedMouse.productId,
      switched,
      source: platform === 'win32' ? 'raw-input' : 'hid',
    });

    if (!switched) return;

    // Wake the main polling loop immediately. checkGuard coalesces requests
    // and queues one follow-up if a USB check is already in progress.
    requestLatestCheck();

    if (onActiveMouseChanged) {
      try {
        onActiveMouseChanged({
          previousMouse: previousSelected,
          activeMouse: selectedMouse,
          timestamp,
        });
      } catch (error) {
        onDiagnostic('mouse_activity_change_handler_error', {
          error: error && error.message ? error.message : String(error),
        });
      }
    }
  }

  function ensureWindowsRawInputMonitor() {
    if (platform !== 'win32' || rawMouseMonitor) return;

    rawMouseMonitor = rawMouseMonitorFactory({
      log,
      onDiagnostic,
      onActivity: (activity) => {
        const mouse = knownMouseForIdentity(activity.vendorId, activity.productId, {
          devicePath: activity.devicePath,
          serialNumber: activity.serialNumber,
        });
        if (!mouse) {
          onDiagnostic('raw_mouse_unsupported_activity', {
            vendorId: activity.vendorId,
            productId: activity.productId,
            devicePath: activity.devicePath || null,
          });
          return;
        }
        recordActivity(mouse);
      },
    });
  }

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
    if (entry.device && entry.device.path) {
      lastReports.delete(entry.device.path);
    }
  }

  function enumerate() {
    if (hidApi && typeof hidApi.devices === 'function') return hidApi.devices();
    return [];
  }

  function reportChanged(path, data) {
    const current = Buffer.from(data || []);
    if (current.length === 0) return false;

    const previous = lastReports.get(path);
    lastReports.set(path, current);
    if (!previous) return false;
    return !previous.equals(current);
  }

  function openCandidate(device, mouse) {
    if (!hidApi || !device.path || handles.has(device.path) || typeof hidApi.HID !== 'function') return;

    try {
      const handle = new hidApi.HID(device.path, { nonExclusive: true });
      const entry = { handle, mouse, device };
      handles.set(device.path, entry);

      if (typeof handle.on === 'function') {
        handle.on('data', (data) => {
          if (!reportChanged(device.path, data)) return;
          recordActivity(mouse);
        });
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
      onDiagnostic('mouse_activity_monitor_error', {
        backend: mouse.backend,
        vendorId: mouse.vendorId,
        productId: mouse.productId,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  function refresh(force = false) {
    if (platform === 'win32') {
      ensureWindowsRawInputMonitor();
      return;
    }

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

    let best = null;
    let bestTimestamp = 0;
    for (const mouse of available) {
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
    lastReports.clear();
    if (rawMouseMonitor) {
      rawMouseMonitor.close();
      rawMouseMonitor = null;
    }
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
    setOnActiveMouseChanged(handler) {
      onActiveMouseChanged = typeof handler === 'function' ? handler : null;
    },
  };
}

let sharedTracker = null;

function getSharedMouseActivityTracker(options = {}) {
  if (!sharedTracker) {
    sharedTracker = createMouseActivityTracker(options);
  } else if (typeof sharedTracker.setOnActiveMouseChanged === 'function'
    && typeof options.onActiveMouseChanged === 'function') {
    sharedTracker.setOnActiveMouseChanged(options.onActiveMouseChanged);
  }
  return sharedTracker;
}

function closeSharedMouseActivityTracker() {
  if (!sharedTracker) return;
  sharedTracker.close();
  sharedTracker = null;
}

module.exports = {
  backendForHidMouse: (device) => {
    const mouse = knownMouseForHidDevice(device);
    return mouse ? mouse.backend : null;
  },
  closeSharedMouseActivityTracker,
  createMouseActivityTracker,
  getSharedMouseActivityTracker,
  knownMouseForHidDevice,
  knownMouseForIdentity,
  mouseKey,
};
