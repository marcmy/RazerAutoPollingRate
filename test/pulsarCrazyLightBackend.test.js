const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CMD_GET_ACTIVE_PROFILE,
  CMD_READ_MEMORY,
  CMD_WRITE_MEMORY,
  buildCommandPacket,
} = require('../src/lib/mouseBackends/pulsarCrazyLightProtocol');
const {
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
  createPulsarCrazyLightBackend,
} = require('../src/lib/mouseBackends/pulsarCrazyLight');

function dataView(buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function createFakeDevice(replies = []) {
  const calls = [];
  const device = {
    vendorId: CRAZYLIGHT_VENDOR_ID,
    productId: CRAZYLIGHT_PRODUCT_ID,
    productName: 'Pulsar X2 CrazyLight',
    configuration: null,
    calls,
    async open() {
      calls.push(['open']);
    },
    async selectConfiguration(value) {
      calls.push(['selectConfiguration', value]);
      this.configuration = {
        configurationValue: value,
        interfaces: [{ interfaceNumber: 1 }],
      };
    },
    async claimInterface(value) {
      calls.push(['claimInterface', value]);
    },
    async controlTransferOut(setup, packet) {
      calls.push(['controlTransferOut', setup, Buffer.from(packet)]);
      return { status: 'ok', bytesWritten: packet.length };
    },
    async transferIn(endpoint, length) {
      calls.push(['transferIn', endpoint, length]);
      const next = replies.shift();
      if (!next) throw new Error('fake transfer queue empty');
      return { status: 'ok', data: dataView(next) };
    },
    async releaseInterface(value) {
      calls.push(['releaseInterface', value]);
    },
    async close() {
      calls.push(['close']);
    },
  };
  return device;
}

function createBackendForDevice(device, diagnostics = [], options = {}) {
  return createPulsarCrazyLightBackend({
    createWebUsb: () => ({
      requestDevice: async () => device,
    }),
    onDiagnostic: (event, details) => diagnostics.push([event, details]),
    ...options,
  });
}

test('CrazyLight backend remains read-only unless hardware-validation writes are explicit', async () => {
  const backend = createBackendForDevice(createFakeDevice());
  assert.equal(backend.canWrite, false);
  await assert.rejects(
    () => backend.setPollingRate(8000),
    /hardware-validation/i,
  );
});

test('CrazyLight discovery rejects a device whose VID or PID is not the validated pair', async () => {
  const unknown = createFakeDevice();
  unknown.productId = 0x9999;
  const backend = createBackendForDevice(unknown);

  await assert.rejects(() => backend.discover(), /not a supported Pulsar X2 CrazyLight/i);
});

test('CrazyLight probe reads active profile and polling rate while skipping unsolicited replies', async () => {
  const stale = buildCommandPacket(0x0A, { 6: 4 });
  const profileReply = buildCommandPacket(CMD_GET_ACTIVE_PROFILE, { 6: 2 });
  const staleAgain = buildCommandPacket(0x0A, { 6: 4 });
  const pollingReply = buildCommandPacket(CMD_READ_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x01,
    6: 0x40,
  });
  const diagnostics = [];
  const device = createFakeDevice([stale, profileReply, staleAgain, pollingReply]);
  const backend = createBackendForDevice(device, diagnostics);

  await backend.discover();
  await backend.open();
  assert.equal(await backend.getActiveProfile(), 3);
  assert.equal(await backend.getPollingRate(), 8000);
  await backend.close();

  const transferOutCalls = device.calls.filter(([name]) => name === 'controlTransferOut');
  assert.equal(transferOutCalls.length, 2);
  assert.deepEqual(transferOutCalls[0][1], {
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x0208,
    index: 0x0001,
  });
  assert.equal(transferOutCalls[0][2][1], CMD_GET_ACTIVE_PROFILE);
  assert.equal(transferOutCalls[1][2][1], CMD_READ_MEMORY);
  assert.equal(transferOutCalls[1][2][3], 0x00);
  assert.equal(transferOutCalls[1][2][4], 0x00);
  assert.equal(transferOutCalls[1][2][5], 0x01);

  assert.ok(diagnostics.some(([event, details]) => event === 'crazylight_stale_reply'
    && details.command === 0x0A));
  assert.ok(device.calls.some(([name, value]) => name === 'claimInterface' && value === 1));
  assert.ok(device.calls.some(([name, value]) => name === 'releaseInterface' && value === 1));
  assert.ok(device.calls.some(([name]) => name === 'close'));
});

test('CrazyLight backend rejects unknown polling bytes', async () => {
  const pollingReply = buildCommandPacket(CMD_READ_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x01,
    6: 0x7f,
  });
  const backend = createBackendForDevice(createFakeDevice([pollingReply]));

  await backend.discover();
  await backend.open();
  await assert.rejects(() => backend.getPollingRate(), /unknown polling-rate value/i);
  await backend.close();
});

test('hardware-validation backend writes polling value plus complement and verifies readback', async () => {
  const writeReply = buildCommandPacket(CMD_WRITE_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x02,
    6: 0x40,
    7: 0x15,
  });
  const pollingReply = buildCommandPacket(CMD_READ_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x01,
    6: 0x40,
  });
  const device = createFakeDevice([writeReply, pollingReply]);
  const backend = createBackendForDevice(device, [], {
    allowHardwareValidationWrites: true,
  });

  assert.equal(backend.canWrite, true);
  await backend.discover();
  await backend.open();
  assert.equal(await backend.setPollingRate(8000), 8000);
  await backend.close();

  const transferOutCalls = device.calls.filter(([name]) => name === 'controlTransferOut');
  assert.equal(transferOutCalls.length, 2);
  const writePacket = transferOutCalls[0][2];
  assert.equal(writePacket[1], CMD_WRITE_MEMORY);
  assert.equal(writePacket[3], 0x00);
  assert.equal(writePacket[4], 0x00);
  assert.equal(writePacket[5], 0x02);
  assert.equal(writePacket[6], 0x40);
  assert.equal(writePacket[7], 0x15);
  assert.equal(transferOutCalls[1][2][1], CMD_READ_MEMORY);
});

test('hardware-validation backend rejects polling write when readback does not match', async () => {
  const writeReply = buildCommandPacket(CMD_WRITE_MEMORY);
  const wrongPollingReply = buildCommandPacket(CMD_READ_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x01,
    6: 0x01,
  });
  const backend = createBackendForDevice(createFakeDevice([writeReply, wrongPollingReply]), [], {
    allowHardwareValidationWrites: true,
  });

  await backend.discover();
  await backend.open();
  await assert.rejects(
    () => backend.setPollingRate(8000),
    /readback.*1000.*8000/i,
  );
  await backend.close();
});

test('probe closes the device when claiming the interface fails', async () => {
  const device = createFakeDevice();
  device.claimInterface = async (value) => {
    device.calls.push(['claimInterface', value]);
    throw new Error('claimInterface failed');
  };
  const backend = createBackendForDevice(device);

  await assert.rejects(() => backend.probe(), /claimInterface failed/);
  assert.ok(device.calls.some(([name]) => name === 'close'));
});

test('CrazyLight backend uses HID transport on Windows instead of WebUSB', async () => {
  const profileReply = buildCommandPacket(CMD_GET_ACTIVE_PROFILE, { 6: 1 });
  const pollingReply = buildCommandPacket(CMD_READ_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x01,
    6: 0x20,
  });
  const replies = [profileReply, pollingReply];
  const calls = [];
  const hidApi = {
    devicesAsync: async () => [{
      vendorId: CRAZYLIGHT_VENDOR_ID,
      productId: CRAZYLIGHT_PRODUCT_ID,
      path: 'vendor-config-interface',
      interface: 1,
      usagePage: 0xff00,
      usage: 1,
      product: 'Pulsar X2 CrazyLight',
    }],
    HIDAsync: {
      open: async (devicePath, options) => {
        calls.push(['open', devicePath, options]);
        return {
          async write(packet) {
            calls.push(['write', Buffer.from(packet)]);
            return packet.length;
          },
          async read(timeout) {
            calls.push(['read', timeout]);
            return replies.shift();
          },
          async close() {
            calls.push(['close']);
          },
        };
      },
    },
  };

  const backend = createPulsarCrazyLightBackend({
    platform: 'win32',
    hidApi,
    inspectHidCaps: async () => ({
      usagePage: 0xff00,
      usage: 1,
      inputReportByteLength: 17,
      outputReportByteLength: 17,
      featureReportByteLength: 0,
    }),
    sendOutputReport: async (devicePath, packet) => {
      calls.push(['sendOutputReport', devicePath, Buffer.from(packet)]);
    },
    createWebUsb: () => {
      throw new Error('WebUSB must not be used for CrazyLight on Windows');
    },
  });

  const result = await backend.probe();

  assert.equal(result.activeProfile, 2);
  assert.equal(result.pollingRate, 4000);
  assert.equal(result.transport, 'hid');
  assert.ok(calls.some(([name, devicePath]) => name === 'open' && devicePath === 'vendor-config-interface'));
  assert.equal(calls.filter(([name]) => name === 'sendOutputReport').length, 2);
  assert.equal(calls.filter(([name]) => name === 'write').length, 0);
  assert.ok(calls.some(([name]) => name === 'close'));
});
