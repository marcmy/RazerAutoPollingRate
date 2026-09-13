'use strict';

const { WebUSB } = require('usb');
const { createCrazyLightHidTransport } = require('./pulsarCrazyLightHid');
const {
  CMD_GET_ACTIVE_PROFILE,
  REPORT_SIZE,
  buildCommandPacket,
  buildMemoryReadPacket,
  decodePollingRate,
  parseActiveProfileReply,
  parseMemoryReadReply,
} = require('./pulsarCrazyLightProtocol');

const CRAZYLIGHT_VENDOR_ID = 0x3710;
const CRAZYLIGHT_PRODUCT_ID = 0x5406;
const CRAZYLIGHT_INTERFACE = 0x01;
const CRAZYLIGHT_ENDPOINT_IN = 0x82;
const CRAZYLIGHT_ENDPOINT_NUMBER = CRAZYLIGHT_ENDPOINT_IN & 0x0f;
const MAX_STALE_REPLIES = 4;

function defaultCreateWebUsb(devicesFound) {
  return new WebUSB({ devicesFound });
}

function transferDataToBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data.buffer instanceof ArrayBuffer) {
    return Buffer.from(data.buffer, data.byteOffset || 0, data.byteLength || data.buffer.byteLength);
  }
  return Buffer.alloc(0);
}

function isCrazyLightDevice(device) {
  return Boolean(device
    && device.vendorId === CRAZYLIGHT_VENDOR_ID
    && device.productId === CRAZYLIGHT_PRODUCT_ID);
}

function createPulsarCrazyLightBackend(options = {}) {
  const createWebUsb = options.createWebUsb || defaultCreateWebUsb;
  const onDiagnostic = options.onDiagnostic || (() => {});
  const log = options.log || (() => {});
  // Tests that inject WebUSB keep exercising the original transport unless
  // they explicitly request Windows. Real Windows runs default to HIDAPI.
  const platform = options.platform || (options.createWebUsb ? 'webusb' : process.platform);
  const useHidTransport = platform === 'win32';
  const hidTransport = useHidTransport
    ? createCrazyLightHidTransport({
      hidApi: options.hidApi,
      log,
      sendOutputReport: options.sendOutputReport,
    })
    : null;

  let device = null;
  let claimedInterface = null;

  async function discover() {
    if (hidTransport) {
      const info = await hidTransport.discover();
      device = {
        vendorId: info.vendorId,
        productId: info.productId,
        productName: info.productName,
        path: info.path,
        usagePage: info.usagePage,
        usage: info.usage,
      };
      return device;
    }

    const webUsb = createWebUsb((devices) => devices.find(isCrazyLightDevice));
    const discovered = await webUsb.requestDevice({ filters: [{}] });
    if (!isCrazyLightDevice(discovered)) {
      throw new Error('USB device is not a supported Pulsar X2 CrazyLight (expected 3710:5406)');
    }
    device = discovered;
    return device;
  }

  async function open() {
    if (!device) {
      throw new Error('Pulsar X2 CrazyLight has not been discovered');
    }

    if (hidTransport) {
      await hidTransport.open();
      claimedInterface = CRAZYLIGHT_INTERFACE;
      return;
    }

    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const targetInterface = device.configuration
      && Array.isArray(device.configuration.interfaces)
      ? device.configuration.interfaces.find((item) => item.interfaceNumber === CRAZYLIGHT_INTERFACE)
      : null;
    if (!targetInterface) {
      throw new Error(`Pulsar X2 CrazyLight interface ${CRAZYLIGHT_INTERFACE} was not found`);
    }

    await device.claimInterface(CRAZYLIGHT_INTERFACE);
    claimedInterface = CRAZYLIGHT_INTERFACE;
  }

  async function receiveExpectedReply(expectedCommand) {
    for (let attempt = 0; attempt <= MAX_STALE_REPLIES; attempt += 1) {
      let reply;

      if (hidTransport) {
        reply = await hidTransport.readReport();
      } else {
        const result = await device.transferIn(CRAZYLIGHT_ENDPOINT_NUMBER, REPORT_SIZE);
        if (result && result.status && result.status !== 'ok') {
          throw new Error(`CrazyLight interrupt read failed with status ${result.status}`);
        }
        reply = transferDataToBuffer(result && result.data);
      }

      const command = reply.length > 1 ? reply[1] : null;
      if (command === expectedCommand) {
        return reply;
      }

      onDiagnostic('crazylight_stale_reply', {
        expectedCommand,
        command,
        length: reply.length,
        attempt: attempt + 1,
      });
    }

    throw new Error(
      `CrazyLight did not return command 0x${expectedCommand.toString(16).padStart(2, '0')} after ${MAX_STALE_REPLIES + 1} replies`,
    );
  }

  async function sendCommand(packet, expectedCommand) {
    if (!device || claimedInterface === null) {
      throw new Error('Pulsar X2 CrazyLight backend is not open');
    }

    if (hidTransport) {
      await hidTransport.writeReport(packet);
    } else {
      const out = await device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x09,
        value: 0x0208,
        index: CRAZYLIGHT_INTERFACE,
      }, packet);

      if (out && out.status && out.status !== 'ok') {
        throw new Error(`CrazyLight SET_REPORT failed with status ${out.status}`);
      }
    }

    return receiveExpectedReply(expectedCommand);
  }

  async function getActiveProfile() {
    const reply = await sendCommand(
      buildCommandPacket(CMD_GET_ACTIVE_PROFILE),
      CMD_GET_ACTIVE_PROFILE,
    );
    return parseActiveProfileReply(reply);
  }

  async function readMemory(address, length) {
    const reply = await sendCommand(buildMemoryReadPacket(address, length), 0x08);
    return parseMemoryReadReply(reply, address, length);
  }

  async function getPollingRate() {
    const bytes = await readMemory(0x0000, 1);
    const value = bytes[0];
    const rate = decodePollingRate(value);
    if (!rate) {
      throw new Error(`CrazyLight returned unknown polling-rate value 0x${value.toString(16).padStart(2, '0')}`);
    }
    return rate;
  }

  async function setPollingRate() {
    throw new Error('Pulsar X2 CrazyLight backend is read-only until hardware validation');
  }

  async function close() {
    if (!device) return;

    if (hidTransport) {
      try {
        await hidTransport.close();
      } finally {
        claimedInterface = null;
        device = null;
      }
      return;
    }

    if (claimedInterface !== null) {
      try {
        await device.releaseInterface(claimedInterface);
      } catch (error) {
        log(`CrazyLight releaseInterface failed: ${error.message}`, true);
      }
      claimedInterface = null;
    }

    try {
      await device.close();
    } catch (error) {
      log(`CrazyLight close failed: ${error.message}`, true);
    }

    device = null;
  }

  async function probe() {
    await discover();
    try {
      await open();
      const activeProfile = await getActiveProfile();
      const pollingRate = await getPollingRate();
      return {
        backend: 'pulsar-x2-crazylight',
        name: 'Pulsar X2 CrazyLight',
        vendorId: CRAZYLIGHT_VENDOR_ID,
        productId: CRAZYLIGHT_PRODUCT_ID,
        interfaceNumber: CRAZYLIGHT_INTERFACE,
        endpoint: CRAZYLIGHT_ENDPOINT_IN,
        activeProfile,
        pollingRate,
        canWrite: false,
        transport: hidTransport ? 'hid' : 'webusb',
      };
    } finally {
      await close();
    }
  }

  return {
    id: 'pulsar-x2-crazylight',
    name: 'Pulsar X2 CrazyLight',
    canWrite: false,
    supportedRates: [125, 250, 500, 1000, 2000, 4000, 8000],
    discover,
    open,
    getActiveProfile,
    getPollingRate,
    probe,
    setPollingRate,
    close,
    get deviceInfo() {
      if (hidTransport && hidTransport.deviceInfo) {
        return {
          ...hidTransport.deviceInfo,
          endpoint: CRAZYLIGHT_ENDPOINT_IN,
        };
      }
      return {
        vendorId: device ? device.vendorId : CRAZYLIGHT_VENDOR_ID,
        productId: device ? device.productId : CRAZYLIGHT_PRODUCT_ID,
        productName: device ? device.productName || null : null,
        interfaceNumber: CRAZYLIGHT_INTERFACE,
        endpoint: CRAZYLIGHT_ENDPOINT_IN,
      };
    },
  };
}

module.exports = {
  CRAZYLIGHT_ENDPOINT_IN,
  CRAZYLIGHT_INTERFACE,
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
  createPulsarCrazyLightBackend,
  isCrazyLightDevice,
};
