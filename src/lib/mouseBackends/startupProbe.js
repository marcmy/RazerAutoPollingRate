'use strict';

const { getDeviceList } = require('usb');
const { classifyUsbDevices } = require('./discovery');
const { createPulsarCrazyLightBackend } = require('./pulsarCrazyLight');

function formatUsbId(identity) {
  const vendor = Number.isInteger(identity.vendorId)
    ? identity.vendorId.toString(16).padStart(4, '0')
    : '????';
  const product = Number.isInteger(identity.productId)
    ? identity.productId.toString(16).padStart(4, '0')
    : '????';
  return `${vendor}:${product}`;
}

async function runCrazyLightProbe(options = {}) {
  const listDevices = options.getDeviceList || getDeviceList;
  const makeBackend = options.createBackend || createPulsarCrazyLightBackend;
  const log = options.log || (() => {});

  const devices = listDevices();
  const discovery = classifyUsbDevices(devices);

  for (const entry of discovery.unknownPulsar) {
    log(`[Pulsar probe] USB ${formatUsbId(entry.identity)} detected but unsupported; no protocol commands sent.`);
  }

  if (discovery.knownCrazyLight.length === 0) {
    return {
      discovery,
      probe: null,
      error: null,
    };
  }

  log('[Pulsar probe] Known X2 CrazyLight 3710:5406 detected; starting read-only probe.');

  const backend = makeBackend({
    onDiagnostic: (event, details) => {
      log(`[Pulsar probe] ${event}: ${JSON.stringify(details)}`);
    },
    log: (message) => log(`[Pulsar probe] ${message}`),
  });

  try {
    const probe = await backend.probe();
    log(
      `[Pulsar probe] ${probe.name} profile ${probe.activeProfile}; ${probe.pollingRate} Hz; read-only (writes disabled).`,
    );
    return {
      discovery,
      probe,
      error: null,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    log(`[Pulsar probe] Probe failed: ${message}`);
    return {
      discovery,
      probe: null,
      error: message,
    };
  }
}

module.exports = {
  formatUsbId,
  runCrazyLightProbe,
};
