'use strict';

const { getDeviceList } = require('usb');
const { classifyUsbDevices, choosePreferredMousePath } = require('./discovery');
const { createPulsarCrazyLightBackend } = require('./pulsarCrazyLight');
const { createRazerBackend } = require('./razer');
const { getSharedMouseActivityTracker } = require('./mouseActivity');

function createPreferredMouseBackend(options = {}) {
  const listDevices = options.getDeviceList || getDeviceList;
  const makeRazerBackend = options.createRazerBackend || createRazerBackend;
  const makePulsarBackend = options.createPulsarBackend || createPulsarCrazyLightBackend;
  const log = options.log || (() => {});
  const onDiagnostic = options.onDiagnostic || (() => {});

  const discovery = classifyUsbDevices(listDevices());

  for (const entry of discovery.unknownPulsar) {
    onDiagnostic('pulsar_usb_detected', {
      vendorId: entry.identity.vendorId,
      productId: entry.identity.productId,
      supported: false,
    });
  }

  const fallbackPath = choosePreferredMousePath(discovery);
  const activityTracker = options.activityTracker
    || (!options.getDeviceList ? getSharedMouseActivityTracker({ log, onDiagnostic }) : null);
  const path = activityTracker
    ? activityTracker.choosePreferredMousePath(discovery, fallbackPath)
    : fallbackPath;

  if (path === 'razer') {
    return {
      path,
      discovery,
      backend: makeRazerBackend({ log, onDiagnostic }),
    };
  }

  if (path === 'pulsar') {
    onDiagnostic('pulsar_usb_detected', {
      vendorId: 0x3710,
      productId: 0x5406,
      supported: true,
    });
    return {
      path,
      discovery,
      backend: makePulsarBackend({
        log,
        onDiagnostic,
        // Read/write has now been validated on the user's retail 3710:5406
        // hardware, including an automatic restore with readback.
        allowHardwareValidationWrites: true,
      }),
    };
  }

  throw new Error('No supported Razer or Pulsar mouse found');
}

module.exports = {
  createPreferredMouseBackend,
};
