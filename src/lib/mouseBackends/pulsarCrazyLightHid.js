'use strict';

const { inspectWindowsHidCaps } = require('./windowsHidCaps');
const { sendWindowsHidOutputReport } = require('./windowsHidOutputReport');

const {
  CRAZYLIGHT_VENDOR_ID,
  CRAZYLIGHT_PRODUCT_ID,
  crazyLightConnection,
} = require('./pulsarCrazyLightIdentity');
const CRAZYLIGHT_INTERFACE = 0x01;
const REPORT_SIZE = 17;
const READ_TIMEOUT_MS = 2000;
const sharedDiscoveryCache = new Map();

function loadNodeHid() {
  // Lazy-load so hardware-independent tests can inject a fake HID API.
  // eslint-disable-next-line global-require
  return require('node-hid');
}

function isInterfaceOne(device) {
  if (!device) return false;
  if (device.interface === CRAZYLIGHT_INTERFACE) return true;
  return typeof device.path === 'string' && /&mi_01(?:&|#|\\|$)/i.test(device.path);
}

function isVendorDefined(device) {
  return Number.isInteger(device && device.usagePage) && device.usagePage >= 0xff00;
}

function candidateScore(device, caps) {
  let score = 0;
  if (device.interface === CRAZYLIGHT_INTERFACE) score += 10;
  if (isVendorDefined(device)) score += 20;
  // Exact 17-byte reports are the strongest match for the captured Nordic
  // protocol. Larger reports remain eligible because Windows may pad them.
  if (caps && caps.inputReportByteLength === REPORT_SIZE) score += 100;
  if (caps && caps.outputReportByteLength === REPORT_SIZE) score += 200;
  return score;
}

function isProtocolCapable(caps) {
  return Boolean(caps
    && caps.inputReportByteLength >= REPORT_SIZE
    && caps.outputReportByteLength >= REPORT_SIZE);
}

function hex16(value) {
  if (!Number.isInteger(value)) return 'unknown';
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function normalizeInfo(device, caps = null) {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.product || null,
    serialNumber: device.serialNumber || null,
    path: device.path || null,
    interfaceNumber: CRAZYLIGHT_INTERFACE,
    usagePage: caps && Number.isInteger(caps.usagePage)
      ? caps.usagePage
      : (Number.isInteger(device.usagePage) ? device.usagePage : null),
    usage: caps && Number.isInteger(caps.usage)
      ? caps.usage
      : (Number.isInteger(device.usage) ? device.usage : null),
    inputReportByteLength: caps ? caps.inputReportByteLength : null,
    outputReportByteLength: caps ? caps.outputReportByteLength : null,
    featureReportByteLength: caps ? caps.featureReportByteLength : null,
  };
}

function describeCandidate(entry) {
  const { device, caps, error } = entry;
  if (error) {
    return `${device.path} [UsagePage=${hex16(device.usagePage)}; Usage=${hex16(device.usage)}; caps-error=${error.message}]`;
  }
  return `${device.path} [UsagePage=${hex16(caps.usagePage)}; Usage=${hex16(caps.usage)}; Input=${caps.inputReportByteLength}; Output=${caps.outputReportByteLength}; Feature=${caps.featureReportByteLength}]`;
}

function createCrazyLightHidTransport(options = {}) {
  const productId = options.preferredProductId || CRAZYLIGHT_PRODUCT_ID;
  if (!crazyLightConnection(productId)) throw new Error('Unsupported CrazyLight HID product ID');
  const serialNumber = options.preferredSerialNumber || null;
  const discoveryCacheKey = `${CRAZYLIGHT_VENDOR_ID}:${productId}:${CRAZYLIGHT_INTERFACE}:${serialNumber || ''}`;
  const hidApi = options.hidApi || loadNodeHid();
  const log = options.log || (() => {});
  const inspectHidCaps = options.inspectHidCaps || inspectWindowsHidCaps;
  const sendOutputReport = options.sendOutputReport || sendWindowsHidOutputReport;
  // Production backend instances are short-lived (one per polling check), so
  // share the validated collection across instances. Injected test transports
  // get an isolated cache unless a test explicitly supplies one.
  const discoveryCache = options.discoveryCache
    || ((options.hidApi || options.inspectHidCaps) ? new Map() : sharedDiscoveryCache);

  let selected = null;
  let selectedCaps = null;
  let handle = null;

  function clearCachedSelection() {
    const cached = discoveryCache.get(discoveryCacheKey);
    if (!cached || !selected || cached.path === selected.path) {
      discoveryCache.delete(discoveryCacheKey);
    }
  }

  function logSelectedCollection(cached = false) {
    log(
      `CrazyLight HID selected ${selected.path} `
      + `(UsagePage=${hex16(selectedCaps.usagePage)}, Usage=${hex16(selectedCaps.usage)}, `
      + `Input=${selectedCaps.inputReportByteLength}, Output=${selectedCaps.outputReportByteLength}, `
      + `Feature=${selectedCaps.featureReportByteLength}${cached ? ', cached' : ''})`,
      true,
    );
  }

  async function enumerate() {
    if (typeof hidApi.devicesAsync === 'function') {
      return hidApi.devicesAsync(CRAZYLIGHT_VENDOR_ID, productId);
    }
    if (typeof hidApi.devices === 'function') {
      return hidApi.devices(CRAZYLIGHT_VENDOR_ID, productId);
    }
    throw new Error('node-hid does not expose a device enumeration API');
  }

  async function discover() {
    const devices = await enumerate();
    const candidates = (devices || [])
      .filter((device) => device
        && device.vendorId === CRAZYLIGHT_VENDOR_ID
        && device.productId === productId
        && (!serialNumber || device.serialNumber === serialNumber)
        && device.path
        && isInterfaceOne(device));

    if (candidates.length === 0) {
      discoveryCache.delete(discoveryCacheKey);
      throw new Error('Pulsar X2 CrazyLight HID interface 1 was not found');
    }

    const cached = discoveryCache.get(discoveryCacheKey);
    if (cached && isProtocolCapable(cached.caps)) {
      const currentDevice = candidates.find((device) => device.path === cached.path);
      if (currentDevice) {
        selected = currentDevice;
        selectedCaps = cached.caps;
        logSelectedCollection(true);
        return normalizeInfo(selected, selectedCaps);
      }
      // Unplug/replug or USB topology change: discard the stale path and do a
      // full caps-driven discovery below.
      discoveryCache.delete(discoveryCacheKey);
    }

    // A composite HID interface can expose several top-level collections. The
    // CrazyLight hardware showed why usage-page heuristics are insufficient:
    // one vendor-defined collection is input-only (8 bytes) and cannot carry
    // the 17-byte Nordic config protocol. Inspect HIDP_CAPS and choose by the
    // actual report capabilities instead.
    const inspected = await Promise.all(candidates.map(async (device) => {
      try {
        const caps = await inspectHidCaps(device.path);
        return { device, caps, error: null };
      } catch (error) {
        return { device, caps: null, error };
      }
    }));

    const usable = inspected
      .filter((entry) => isProtocolCapable(entry.caps))
      .sort((left, right) => candidateScore(right.device, right.caps)
        - candidateScore(left.device, left.caps));

    if (usable.length === 0) {
      discoveryCache.delete(discoveryCacheKey);
      const details = inspected.map(describeCandidate).join('; ');
      throw new Error(
        `No interface 1 HID collection supports 17-byte input/output reports. Candidates: ${details}`,
      );
    }

    selected = usable[0].device;
    selectedCaps = usable[0].caps;
    discoveryCache.set(discoveryCacheKey, {
      path: selected.path,
      caps: selectedCaps,
    });
    logSelectedCollection(false);
    return normalizeInfo(selected, selectedCaps);
  }

  async function open() {
    if (!selected) {
      await discover();
    }

    try {
      if (hidApi.HIDAsync && typeof hidApi.HIDAsync.open === 'function') {
        handle = await hidApi.HIDAsync.open(selected.path, { nonExclusive: true });
        return;
      }

      if (typeof hidApi.HID === 'function') {
        handle = new hidApi.HID(selected.path, { nonExclusive: true });
        return;
      }
    } catch (error) {
      clearCachedSelection();
      throw error;
    }

    throw new Error('node-hid does not expose HIDAsync.open or HID');
  }

  async function writeReport(packet) {
    if (!handle || !selected) {
      throw new Error('CrazyLight HID transport is not open');
    }

    const report = Buffer.from(packet || []);
    if (report.length !== REPORT_SIZE || report[0] !== 0x08) {
      throw new Error('CrazyLight HID output report must be 17 bytes with report ID 0x08');
    }

    // The CrazyLight configuration interface accepts report 0x08 through the
    // HID SET_REPORT(Output) control path. node-hid.write() maps to hid_write()
    // / WriteFile on Windows, which fails because interface 1 has no interrupt
    // OUT endpoint. Use HidD_SetOutputReport on the caps-validated collection.
    try {
      await sendOutputReport(selected.path, report);
    } catch (error) {
      clearCachedSelection();
      throw error;
    }
  }

  async function readReport() {
    if (!handle) {
      throw new Error('CrazyLight HID transport is not open');
    }

    let data;
    if (handle.read.length >= 1 || (hidApi.HIDAsync && typeof hidApi.HIDAsync.open === 'function')) {
      data = await handle.read(READ_TIMEOUT_MS);
    } else if (typeof handle.readTimeout === 'function') {
      data = handle.readTimeout(READ_TIMEOUT_MS);
    } else {
      data = await handle.read();
    }

    if (!data || data.length === 0) {
      throw new Error('CrazyLight HID read timed out');
    }
    return Buffer.from(data);
  }

  async function close() {
    if (!handle) return;
    try {
      await handle.close();
    } catch (error) {
      log(`CrazyLight HID close failed: ${error.message}`, true);
    } finally {
      handle = null;
    }
  }

  return {
    kind: 'hid',
    discover,
    open,
    writeReport,
    readReport,
    close,
    get deviceInfo() {
      return selected ? normalizeInfo(selected, selectedCaps) : null;
    },
  };
}

module.exports = {
  CRAZYLIGHT_INTERFACE,
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
  createCrazyLightHidTransport,
  isInterfaceOne,
  isProtocolCapable,
  isVendorDefined,
};
