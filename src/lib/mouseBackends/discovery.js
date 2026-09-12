'use strict';

const { dongles } = require('../devices');
const {
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
} = require('./pulsarCrazyLight');

const RAZER_VENDOR_ID = 0x1532;

function getUsbIdentity(device) {
  if (!device) return { vendorId: null, productId: null };

  if (Number.isInteger(device.vendorId) && Number.isInteger(device.productId)) {
    return {
      vendorId: device.vendorId,
      productId: device.productId,
    };
  }

  const descriptor = device.deviceDescriptor || {};
  return {
    vendorId: Number.isInteger(descriptor.idVendor) ? descriptor.idVendor : null,
    productId: Number.isInteger(descriptor.idProduct) ? descriptor.idProduct : null,
  };
}

function classifyUsbDevices(devices = []) {
  const result = {
    supportedRazer: [],
    knownCrazyLight: [],
    unknownPulsar: [],
  };

  for (const device of devices) {
    const identity = getUsbIdentity(device);
    const entry = { device, identity };

    if (identity.vendorId === RAZER_VENDOR_ID && dongles[identity.productId] !== undefined) {
      result.supportedRazer.push(entry);
      continue;
    }

    if (identity.vendorId === CRAZYLIGHT_VENDOR_ID && identity.productId === CRAZYLIGHT_PRODUCT_ID) {
      result.knownCrazyLight.push(entry);
      continue;
    }

    if (identity.vendorId === CRAZYLIGHT_VENDOR_ID) {
      result.unknownPulsar.push(entry);
    }
  }

  return result;
}

function choosePreferredMousePath(discovery) {
  if (discovery && discovery.supportedRazer && discovery.supportedRazer.length > 0) {
    return 'razer';
  }
  if (discovery && discovery.knownCrazyLight && discovery.knownCrazyLight.length > 0) {
    return 'pulsar-probe';
  }
  return null;
}

module.exports = {
  RAZER_VENDOR_ID,
  choosePreferredMousePath,
  classifyUsbDevices,
  getUsbIdentity,
};
