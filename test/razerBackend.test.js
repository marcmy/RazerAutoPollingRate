const test = require('node:test');
const assert = require('node:assert/strict');

const { getRazerReport } = require('../src/lib/razerReports');
const { createRazerBackend } = require('../src/lib/mouseBackends/razer');

function dataViewWithPollingByte(byte) {
  const buffer = new ArrayBuffer(90);
  new DataView(buffer).setUint8(9, byte);
  return new DataView(buffer);
}

function emptyDataView() {
  return new DataView(new ArrayBuffer(90));
}

function createFakeDevice(productId = 0x00e5, replies = [], serialNumber = null) {
  const calls = [];
  return {
    vendorId: 0x1532,
    productId,
    productName: 'Razer test device',
    serialNumber,
    configuration: null,
    calls,
    async open() {
      calls.push(['open']);
    },
    async selectConfiguration(value) {
      calls.push(['selectConfiguration', value]);
      this.configuration = {
        interfaces: [
          { interfaceNumber: 0 },
          { interfaceNumber: 3 },
        ],
      };
    },
    async claimInterface(value) {
      calls.push(['claimInterface', value]);
    },
    async controlTransferOut(setup, packet) {
      calls.push(['controlTransferOut', setup, Buffer.from(packet)]);
      return { status: 'ok' };
    },
    async controlTransferIn(setup, length) {
      calls.push(['controlTransferIn', setup, length]);
      const next = replies.shift();
      if (!next) throw new Error('fake reply queue empty');
      return { status: 'ok', data: next };
    },
    async releaseInterface(value) {
      calls.push(['releaseInterface', value]);
    },
    async close() {
      calls.push(['close']);
    },
  };
}

function createBackend(deviceOrDevices, diagnostics = [], options = {}) {
  const devices = Array.isArray(deviceOrDevices) ? deviceOrDevices : [deviceOrDevices];
  return createRazerBackend({
    ...options,
    createWebUsb: (devicesFound) => ({
      requestDevice: async () => {
        const selected = devicesFound(devices);
        return selected || null;
      },
    }),
    sleep: async () => {},
    onDiagnostic: (event, details) => diagnostics.push([event, details]),
  });
}

test('Razer backend honors the active mouse product identity when multiple known dongles are connected', async () => {
  const viper = createFakeDevice(0x00e5, [], 'viper');
  const deathadder = createFakeDevice(0x00be, [], 'deathadder');
  const backend = createBackend([viper, deathadder], [], {
    preferredProductId: 0x00be,
  });

  const discovered = await backend.discover();

  assert.equal(discovered, deathadder);
  assert.equal(backend.deviceInfo.productId, 0x00be);
});

test('Razer backend prefers the exact serial when two known mice share a product ID', async () => {
  const first = createFakeDevice(0x00e5, [], 'A');
  const second = createFakeDevice(0x00e5, [], 'B');
  const backend = createBackend([first, second], [], {
    preferredProductId: 0x00e5,
    preferredSerialNumber: 'B',
  });

  const discovered = await backend.discover();

  assert.equal(discovered, second);
  assert.equal(backend.deviceInfo.productId, 0x00e5);
});

test('Razer backend preserves Viper V4 Pro interface and polling read wire format', async () => {
  const device = createFakeDevice(0x00e5, [dataViewWithPollingByte(0x02)]);
  const backend = createBackend(device);

  await backend.discover();
  await backend.open();
  assert.equal(await backend.getPollingRate(), 4000);
  await backend.close();

  assert.equal(backend.id, 'razer');
  assert.equal(backend.canWrite, true);
  assert.equal(backend.is8kCompatible(), true);
  assert.ok(device.calls.some(([name, value]) => name === 'claimInterface' && value === 3));

  const out = device.calls.find(([name]) => name === 'controlTransferOut');
  const input = device.calls.find(([name]) => name === 'controlTransferIn');
  assert.deepEqual(out[1], {
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: 0x03,
  });
  assert.deepEqual(out[2], getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));
  assert.deepEqual(input[1], {
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: 0x03,
  });
  assert.equal(input[2], 90);
  assert.ok(device.calls.some(([name, value]) => name === 'releaseInterface' && value === 3));
  assert.ok(device.calls.some(([name]) => name === 'close'));
});

test('Razer backend preserves the two-stage polling write and verifies by readback', async () => {
  const device = createFakeDevice(0x00e5, [
    emptyDataView(),
    emptyDataView(),
    dataViewWithPollingByte(0x02),
  ]);
  const backend = createBackend(device);

  await backend.discover();
  await backend.open();
  assert.equal(await backend.setPollingRate(4000), 4000);
  await backend.close();

  const outs = device.calls.filter(([name]) => name === 'controlTransferOut');
  assert.equal(outs.length, 3);
  assert.deepEqual(outs[0][2], getRazerReport(0x1F, 0x00, 0x40, 0x02, 0x00, 0x02));
  assert.deepEqual(outs[1][2], getRazerReport(0x1F, 0x00, 0x40, 0x02, 0x01, 0x02));
  assert.deepEqual(outs[2][2], getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));
});

test('Razer backend retries a failed polling query without reopening the device', async () => {
  const diagnostics = [];
  const device = createFakeDevice(0x00e5, [
    new DataView(new ArrayBuffer(4)),
    dataViewWithPollingByte(0x08),
  ]);
  const backend = createBackend(device, diagnostics);

  await backend.discover();
  await backend.open();
  assert.equal(await backend.getPollingRate(), 1000);
  await backend.close();

  assert.equal(device.calls.filter(([name]) => name === 'open').length, 1);
  assert.equal(device.calls.filter(([name]) => name === 'controlTransferOut').length, 2);
  assert.ok(diagnostics.some(([event, details]) => event === 'polling_rate_query_attempt_failed'
    && details.attempt === 1 && details.attempts === 3));
});
