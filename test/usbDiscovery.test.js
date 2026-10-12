const test = require('node:test');
const assert = require('node:assert/strict');
const { usb } = require('usb');
const { listUsbDevices } = require('../src/lib/mouseBackends/usbDiscovery');

test('USB discovery reads IDs without invoking fallible native serial or configuration getters', async () => {
  const getDevices = usb.getDevices;
  let opened = false;
  usb.getDevices = async () => [{
    vendorId: 0x3710,
    productId: 0x5406,
    get serialNumber() { opened = true; throw new Error('HID driver cannot be opened by nusb'); },
    get configuration() { opened = true; throw new Error('must not open while enumerating'); },
  }];
  try {
    const devices = await listUsbDevices();
    assert.deepEqual(devices, [{ vendorId: 0x3710, productId: 0x5406 }]);
    assert.equal(opened, false);
  } finally {
    usb.getDevices = getDevices;
  }
});
