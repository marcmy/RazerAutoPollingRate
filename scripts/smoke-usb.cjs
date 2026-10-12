'use strict';

// Run from source with Node, then from resources/app with the packaged
// executable and ELECTRON_RUN_AS_NODE=1. Never open/claim a device or write.
const assert = require('node:assert/strict');
const { version } = require('usb/package.json');
const { usb, WebUSB } = require('usb');
const hid = require('node-hid');
const { listUsbDevices } = require('../src/lib/mouseBackends/usbDiscovery');
const { createPreferredMouseBackend } = require('../src/lib/mouseBackends/runtime');
const { getUsbIdentity } = require('../src/lib/mouseBackends/discovery');

async function smoke() {
  assert.match(version, /^3\./);
  assert.equal(typeof usb.getDevices, 'function');
  assert.equal(typeof WebUSB, 'function');
  // This reaches the actual platform binary, including in the packaged app.
  const devices = await listUsbDevices();
  assert.ok(Array.isArray(devices));
  for (const device of devices) {
    const identity = getUsbIdentity(device);
    assert.ok(Number.isInteger(identity.vendorId));
    assert.ok(Number.isInteger(identity.productId));
  }
  // Both Windows mouse transports depend on the shipped HID native binary.
  assert.ok(Array.isArray(await hid.devicesAsync(0x1532, 0)));

  // Exercise production selection and backend construction without a mouse
  // attached to CI; neither backend sends commands until discover/open.
  const pulsar = await createPreferredMouseBackend({
    getDevices: async () => [
      { vendorId: 0x3710, productId: 0x5406 },
      { vendorId: 0x3710, productId: 0x3524, serialNumber: 'smoke-wired' },
    ],
  });
  assert.equal(pulsar.selectedMouse.productId, 0x3524);
  assert.equal(pulsar.backend.id, 'pulsar-x2-crazylight');
  assert.equal(pulsar.backend.canWrite, false);

  const razer = await createPreferredMouseBackend({
    getDevices: async () => [
      { vendorId: 0x3710, productId: 0x5406 },
      { vendorId: 0x1532, productId: 0x00e5 },
    ],
  });
  assert.equal(razer.path, 'razer');
  assert.equal(razer.backend.id, 'razer');
  await assert.rejects(() => createPreferredMouseBackend({ getDevices: async () => [] }), /No supported/);
  console.log(`USB ${version} native enumeration and backend selection OK (${devices.length} attached devices; Electron ${process.versions.electron || 'not used'})`);
}

smoke().catch((error) => {
  console.error('USB v3 smoke test failed:', error);
  process.exitCode = 1;
});
