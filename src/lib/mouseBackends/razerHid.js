'use strict';

const { dongles } = require('../devices');
const { inspectWindowsHidCaps } = require('./windowsHidCaps');

const REPORT_LENGTH = 90;
const capsCache = new Map();

function interfaceNumber(device) {
  if (Number.isInteger(device.interface) && device.interface >= 0) return device.interface;
  const match = String(device.path || '').match(/&mi_([0-9a-f]{2})(?:[&#\\]|$)/i);
  return match ? parseInt(match[1], 16) : null;
}

// Present HID feature operations through the existing WebUSB-shaped transport
// so the Razer packet format, timing, retries and readback remain unchanged.
async function findRazerHidDevice(options) {
  const hidApi = options.hidApi || require('node-hid');
  const inspectCaps = options.inspectHidCaps || inspectWindowsHidCaps;
  const cache = options.hidApi || options.inspectHidCaps ? new Map() : capsCache;
  const log = options.log || (() => {});
  const infos = await hidApi.devicesAsync(0x1532, 0);
  const candidates = [];
  for (const info of infos) {
    const model = dongles[info.productId];
    if (info.vendorId !== 0x1532 || !model || !info.path
      || interfaceNumber(info) !== (model.interfaceIndex ?? 0)) continue;
    try {
      let caps = cache.get(info.path);
      if (!caps) {
        caps = await inspectCaps(info.path);
        cache.set(info.path, caps);
      }
      if (caps.featureReportByteLength < REPORT_LENGTH + 1) continue;
      candidates.push({ ...info, productName: info.product || null, caps });
    } catch (error) {
      log(`Razer HID caps unavailable: ${error.message}`, true);
    }
  }

  // Prefer the vendor collection when several collections share an interface.
  candidates.sort((a, b) => Number(b.usagePage >= 0xff00) - Number(a.usagePage >= 0xff00));
  const selected = options.devicesFound(candidates);
  if (!selected) return null; // A WinUSB-bound device may still use WebUSB.
  const index = dongles[selected.productId].interfaceIndex ?? 0;
  let handle = null;

  function requireHandle() {
    if (!handle) throw new Error('Razer HID device is not open');
  }

  function validateSetup(setup, request) {
    requireHandle();
    if (setup.requestType !== 'class' || setup.recipient !== 'interface'
      || setup.request !== request || setup.value !== 0x300 || setup.index !== index) {
      throw new Error('Unsupported Razer HID feature transfer');
    }
  }

  return {
    vendorId: selected.vendorId,
    productId: selected.productId,
    productName: selected.productName,
    serialNumber: selected.serialNumber || null,
    configuration: { interfaces: [{ interfaceNumber: index }] },
    async open() {
      try {
        handle = await hidApi.HIDAsync.open(selected.path);
      } catch (error) {
        cache.delete(selected.path);
        throw error;
      }
    },
    async claimInterface(value) {
      requireHandle();
      if (value !== index) throw new Error('Wrong Razer HID protocol interface');
    },
    async releaseInterface() {},
    async controlTransferOut(setup, packet) {
      validateSetup(setup, 0x09);
      if (packet.length !== REPORT_LENGTH) throw new Error('Invalid Razer HID packet length');
      const report = Buffer.alloc(selected.caps.featureReportByteLength);
      Buffer.from(packet).copy(report, 1); // Report ID 0 precedes the 90-byte payload.
      const written = await handle.sendFeatureReport([...report]);
      if (written < report.length) throw new Error(`Razer HID short feature write (${written} bytes)`);
      return { status: 'ok', bytesWritten: packet.length };
    },
    async controlTransferIn(setup, length) {
      validateSetup(setup, 0x01);
      if (length !== REPORT_LENGTH) throw new Error('Invalid Razer HID reply length');
      const report = Buffer.from(await handle.getFeatureReport(0, selected.caps.featureReportByteLength));
      if (report.length < length + 1) throw new Error(`Razer HID short feature reply (${report.length} bytes)`);
      if (report[0] !== 0) throw new Error('Unexpected Razer HID feature report ID');
      const payload = Uint8Array.from(report.subarray(1, length + 1));
      return { status: 'ok', data: new DataView(payload.buffer) };
    },
    async close() {
      const opened = handle;
      handle = null;
      if (opened) await opened.close();
    },
  };
}

module.exports = { findRazerHidDevice };
