'use strict';

const { usb } = require('usb');

// USB v3's unrestricted instance lists attached devices without opening or
// claiming them. Keep enumeration fresh for each check so reconnects are seen.
async function listUsbDevices() {
  const devices = await usb.getDevices();
  // Native v3 serial/configuration getters can open the device. Legacy raw
  // enumeration supplied only descriptors; preserve that behavior, including
  // the serial-free identities used by Windows Raw Input presentation recovery.
  return devices.map((device) => ({ vendorId: device.vendorId, productId: device.productId }));
}

module.exports = { listUsbDevices };
