const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CMD_GET_ACTIVE_PROFILE,
  CMD_READ_MEMORY,
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

function createBackendForDevice(device, diagnostics = []) {
  return createPulsarCrazyLightBackend({
    createWebUsb: () => ({
      requestDevice: async () => device,
    }),
    onDiagnostic: (event, details) => diagnostics.push([event, details]),
  });
}

test('CrazyLight backend is explicitly read-only', async () => {
  const backend = createBackendForDevice(createFakeDevice());
  assert.equal(backend.canWrite, false);
  await assert.rejects(
    () => backend.setPollingRate(8000),
    /read-only until hardware validation/i,
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
