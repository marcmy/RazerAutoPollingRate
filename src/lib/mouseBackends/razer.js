'use strict';

const { WebUSB } = require('usb');
const { dongles } = require('../devices');
const { retryImmediately } = require('../retryImmediately');
const {
  getRateForReportByte,
  getReportByteForRate,
  resolveSupportedPollingRate,
} = require('../rates');
const { getRazerReport } = require('../razerReports');

const RAZER_VENDOR_ID = 0x1532;
const RAZER_REPORT_LENGTH = 90;
const RAZER_FEATURE_REPORT_VALUE = 0x300;
const SUPPORTED_RATES = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);

function defaultCreateWebUsb(devicesFound) {
  return new WebUSB({ devicesFound });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSupportedRazerDevice(device) {
  return Boolean(device
    && device.vendorId === RAZER_VENDOR_ID
    && dongles[device.productId] !== undefined);
}

function createRazerBackend(options = {}) {
  const createWebUsb = options.createWebUsb || defaultCreateWebUsb;
  const sleep = options.sleep || defaultSleep;
  const log = options.log || (() => {});
  const onDiagnostic = options.onDiagnostic || (() => {});

  let device = null;
  let currentModel = null;
  let claimedInterface = null;

  function is8kCompatible() {
    return Boolean(currentModel && currentModel.is8kCompatible);
  }

  function targetInterfaceIndex() {
    return currentModel && currentModel.interfaceIndex !== undefined
      ? currentModel.interfaceIndex
      : 0x00;
  }

  async function discover() {
    const webUsb = createWebUsb((devices) => devices.find(isSupportedRazerDevice));

    try {
      const discovered = await webUsb.requestDevice({ filters: [{}] });
      if (!isSupportedRazerDevice(discovered)) {
        throw new Error('No compatible Razer HyperPolling dongle found');
      }

      device = discovered;
      currentModel = dongles[device.productId];
      return device;
    } catch (error) {
      if (error && error.name === 'NotFoundError') {
        throw new Error('No compatible Razer HyperPolling dongle found');
      }
      throw error;
    }
  }

  async function open() {
    if (!device || !currentModel) {
      throw new Error('Razer backend has not been discovered');
    }

    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const targetIndex = targetInterfaceIndex();
    const targetInterface = device.configuration.interfaces.find(
      (item) => item.interfaceNumber === targetIndex,
    ) || device.configuration.interfaces[0];

    await device.claimInterface(targetInterface.interfaceNumber);
    claimedInterface = targetInterface.interfaceNumber;
  }

  async function getPollingRateOnce() {
    if (!device || claimedInterface === null) {
      throw new Error('Razer backend is not open');
    }

    const targetIndex = targetInterfaceIndex();

    await device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: 0x09,
      value: RAZER_FEATURE_REPORT_VALUE,
      index: targetIndex,
    }, getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));

    await sleep(100);

    const reply = await device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request: 0x01,
      value: RAZER_FEATURE_REPORT_VALUE,
      index: targetIndex,
    }, RAZER_REPORT_LENGTH);

    const responseLength = reply && reply.data ? reply.data.byteLength : 0;
    if (!reply || !reply.data || responseLength <= 9) {
      throw new Error(`Dongle returned a short polling-rate response (${responseLength} bytes)`);
    }

    const responseByte = reply.data.getUint8(9);
    const pollingRate = getRateForReportByte(responseByte);
    if (!pollingRate) {
      throw new Error(
        `Dongle returned an unknown polling-rate response (byte 0x${responseByte.toString(16).padStart(2, '0')}, length ${responseLength})`,
      );
    }

    return pollingRate;
  }

  async function getPollingRate() {
    return retryImmediately(() => getPollingRateOnce(), {
      attempts: 3,
      onFailure: (error, attempt, attempts) => {
        onDiagnostic('polling_rate_query_attempt_failed', {
          attempt,
          attempts,
          error: error.message,
        });
      },
    });
  }

  async function setPollingRate(pollingRate) {
    if (!device || claimedInterface === null) {
      throw new Error('Razer backend is not open');
    }

    const resolved = resolveSupportedPollingRate(pollingRate, {
      is8kCompatible: is8kCompatible(),
    });
    if (!resolved.rate) {
      throw new Error(resolved.warning);
    }

    if (resolved.warning) {
      log(resolved.warning, true);
    }

    const rateByte = getReportByteForRate(resolved.rate);
    const targetIndex = targetInterfaceIndex();

    await device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: 0x09,
      value: RAZER_FEATURE_REPORT_VALUE,
      index: targetIndex,
    }, getRazerReport(0x1F, 0x00, 0x40, 0x02, 0x00, rateByte));

    await sleep(100);
    await device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request: 0x01,
      value: RAZER_FEATURE_REPORT_VALUE,
      index: targetIndex,
    }, RAZER_REPORT_LENGTH);

    await sleep(100);
    await device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: 0x09,
      value: RAZER_FEATURE_REPORT_VALUE,
      index: targetIndex,
    }, getRazerReport(is8kCompatible() ? 0x1F : 0xFF, 0x00, 0x40, 0x02, 0x01, rateByte));

    await sleep(100);
    await device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request: 0x01,
      value: RAZER_FEATURE_REPORT_VALUE,
      index: targetIndex,
    }, RAZER_REPORT_LENGTH);

    await sleep(100);
    return getPollingRate();
  }

  async function close() {
    if (!device) return;

    if (claimedInterface !== null) {
      try {
        await device.releaseInterface(claimedInterface);
      } catch (error) {
        log(`releaseInterface failed: ${error.message}`, true);
      }
      claimedInterface = null;
    }

    try {
      await device.close();
    } catch (error) {
      log(`close failed: ${error.message}`, true);
    }

    device = null;
    currentModel = null;
  }

  return {
    id: 'razer',
    name: 'Razer HyperPolling',
    canWrite: true,
    supportedRates: SUPPORTED_RATES,
    discover,
    open,
    getPollingRate,
    setPollingRate,
    close,
    is8kCompatible,
    get deviceInfo() {
      return {
        vendorId: device ? device.vendorId : RAZER_VENDOR_ID,
        productId: device ? device.productId : null,
        productName: device ? device.productName || null : null,
        interfaceNumber: claimedInterface !== null ? claimedInterface : targetInterfaceIndex(),
      };
    },
  };
}

module.exports = {
  RAZER_VENDOR_ID,
  RAZER_REPORT_LENGTH,
  createRazerBackend,
  isSupportedRazerDevice,
};
