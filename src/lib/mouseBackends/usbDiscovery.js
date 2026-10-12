'use strict';

const { usb } = require('usb');

// USB v3's unrestricted instance lists attached devices without opening or
// claiming them. Keep enumeration fresh for each check so reconnects are seen.
async function listUsbDevices() {
  return usb.getDevices();
}

module.exports = { listUsbDevices };