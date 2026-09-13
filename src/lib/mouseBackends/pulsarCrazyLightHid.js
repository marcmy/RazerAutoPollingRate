'use strict';

const CRAZYLIGHT_VENDOR_ID = 0x3710;
const CRAZYLIGHT_PRODUCT_ID = 0x5406;
const CRAZYLIGHT_INTERFACE = 0x01;
const REPORT_SIZE = 17;
const READ_TIMEOUT_MS = 2000;

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

function candidateScore(device) {
  let score = 0;
  if (device.interface === CRAZYLIGHT_INTERFACE) score += 10;
  if (isVendorDefined(device)) score += 100;
  return score;
}

function normalizeInfo(device) {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.product || null,
    path: device.path || null,
    interfaceNumber: CRAZYLIGHT_INTERFACE,
    usagePage: Number.isInteger(device.usagePage) ? device.usagePage : null,
    usage: Number.isInteger(device.usage) ? device.usage : null,
  };
}

function createCrazyLightHidTransport(options = {}) {
  const hidApi = options.hidApi || loadNodeHid();
  const log = options.log || (() => {});

  let selected = null;
  let handle = null;

  async function enumerate() {
    if (typeof hidApi.devicesAsync === 'function') {
      return hidApi.devicesAsync(CRAZYLIGHT_VENDOR_ID, CRAZYLIGHT_PRODUCT_ID);
    }
    if (typeof hidApi.devices === 'function') {
      return hidApi.devices(CRAZYLIGHT_VENDOR_ID, CRAZYLIGHT_PRODUCT_ID);
    }
    throw new Error('node-hid does not expose a device enumeration API');
  }

  async function discover() {
    const devices = await enumerate();
    const candidates = (devices || [])
      .filter((device) => device
        && device.vendorId === CRAZYLIGHT_VENDOR_ID
        && device.productId === CRAZYLIGHT_PRODUCT_ID
        && device.path
        && isInterfaceOne(device))
      .sort((left, right) => candidateScore(right) - candidateScore(left));

    if (candidates.length === 0) {
      throw new Error('Pulsar X2 CrazyLight HID interface 1 was not found');
    }

    selected = candidates[0];
    return normalizeInfo(selected);
  }

  async function open() {
    if (!selected) {
      await discover();
    }

    if (hidApi.HIDAsync && typeof hidApi.HIDAsync.open === 'function') {
      handle = await hidApi.HIDAsync.open(selected.path, { nonExclusive: true });
      return;
    }

    if (typeof hidApi.HID === 'function') {
      handle = new hidApi.HID(selected.path, { nonExclusive: true });
      return;
    }

    throw new Error('node-hid does not expose HIDAsync.open or HID');
  }

  async function writeReport(packet) {
    if (!handle) {
      throw new Error('CrazyLight HID transport is not open');
    }

    const report = Buffer.from(packet || []);
    if (report.length !== REPORT_SIZE || report[0] !== 0x08) {
      throw new Error('CrazyLight HID output report must be 17 bytes with report ID 0x08');
    }

    const written = await handle.write(report);
    if (Number.isInteger(written) && written < REPORT_SIZE) {
      throw new Error(`CrazyLight HID write was short (${written} bytes)`);
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
      return selected ? normalizeInfo(selected) : null;
    },
  };
}

module.exports = {
  CRAZYLIGHT_INTERFACE,
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
  createCrazyLightHidTransport,
  isInterfaceOne,
  isVendorDefined,
};
