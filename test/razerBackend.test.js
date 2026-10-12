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

let windowsFixtureId = 0;
function windowsFixture(productId = 0x00e5, interfaceNumber = 3) {
  const calls = [];
  const replies = [];
  const info = { vendorId: 0x1532, productId, interface: interfaceNumber,
    path: `razer-hid-test-${windowsFixtureId++}`, serialNumber: 'B', product: 'Razer HID test',
    usagePage: 0xff00, usage: 1, release: 1 };
  const hidApi = {
    devicesAsync: async () => [info],
    HIDAsync: { open: async (path) => {
      calls.push(['open', path]);
      return {
        sendFeatureReport: async (bytes) => { calls.push(['send', Buffer.from(bytes)]); return bytes.length; },
        getFeatureReport: async (reportId, length) => { calls.push(['read', reportId, length]); return replies.shift(); },
        close: async () => { calls.push(['close']); },
      };
    } },
  };
  const backend = createRazerBackend({
    platform: 'win32', hidApi,
    inspectHidCaps: async () => ({ usagePage: 0xff00, usage: 1,
      inputReportByteLength: 0, outputReportByteLength: 0, featureReportByteLength: 91 }),
    createWebUsb: () => assert.fail('standard Windows HID must not use WinUSB'),
    preferredProductId: productId, preferredSerialNumber: 'B',
    sleep: async () => {},
  });
  return { backend, hidApi, info, calls, replies };
}

test('Windows Razer uses HID feature reports without a driver replacement', async () => {
  const { backend, calls, replies } = windowsFixture();
  const response = Buffer.alloc(91);
  response[10] = 0x02; // leading report ID, then protocol polling byte 9
  replies.push(response);
  await backend.discover();
  await backend.open();
  assert.equal(await backend.getPollingRate(), 4000);
  await backend.close();
  assert.equal(backend.deviceInfo.interfaceNumber, 3);
  const send = calls.find(([name]) => name === 'send')[1];
  assert.equal(send.length, 91);
  assert.equal(send[0], 0); // unnumbered HID feature report ID
  assert.deepEqual([...send.subarray(1, 9)], [0, 0x1f, 0, 0, 0, 1, 0, 0xc0]);
  assert.deepEqual(calls.find(([name]) => name === 'read'), ['read', 0, 91]);
  assert.equal(calls.filter(([name]) => name === 'close').length, 1);
});

test('Windows Razer keeps the two-stage rate write and subsequent readback', async () => {
  const { backend, calls, replies } = windowsFixture();
  const readback = Buffer.alloc(91);
  readback[10] = 0x02;
  replies.push(Buffer.alloc(91), Buffer.alloc(91), readback);
  await backend.discover();
  await backend.open();
  assert.equal(await backend.setPollingRate(4000), 4000);
  await backend.close();
  const sends = calls.filter(([name]) => name === 'send').map(([, bytes]) => bytes);
  assert.equal(sends.length, 3);
  assert.deepEqual([...sends[0].subarray(1, 9)], [0, 0x1f, 0, 0, 0, 2, 0, 0x40]);
  assert.equal(sends[0][9], 0);
  assert.equal(sends[0][10], 0x02);
  assert.deepEqual([...sends[1].subarray(1, 9)], [0, 0x1f, 0, 0, 0, 2, 0, 0x40]);
  assert.equal(sends[1][9], 1);
  assert.equal(sends[1][10], 0x02);
});

test('Windows Razer chooses its exact HID product, serial and protocol interface', async () => {
  const { backend, hidApi, info, calls } = windowsFixture();
  hidApi.devicesAsync = async () => [
    { ...info, interface: 0, path: 'wrong-interface' },
    { ...info, serialNumber: 'A', path: 'wrong-serial' },
    { ...info, productId: 0x00be, path: 'wrong-product' },
    info,
  ];
  await backend.discover();
  await backend.open();
  assert.deepEqual(calls[0], ['open', info.path]);
  assert.equal(backend.deviceInfo.productName, 'Razer HID test');
  await backend.close();
});

test('Windows Razer rejects short feature replies and can reopen after close', async () => {
  const { backend, calls, replies } = windowsFixture(0x00be, 0);
  replies.push(Buffer.alloc(5), Buffer.alloc(5), Buffer.alloc(5));
  await backend.discover();
  await backend.open();
  await assert.rejects(() => backend.getPollingRate(), /short/i);
  await backend.close();
  const response = Buffer.alloc(91);
  response[10] = 0x08;
  replies.push(response);
  await backend.discover();
  await backend.open();
  assert.equal(await backend.getPollingRate(), 1000);
  await backend.close();
  assert.equal(calls.filter(([name]) => name === 'open').length, 2);
  assert.equal(calls.filter(([name]) => name === 'close').length, 2);
});

test('Windows Razer retains WebUSB for a device bound to WinUSB rather than HID', async () => {
  const device = createFakeDevice(0x00e5, [dataViewWithPollingByte(0x02)]);
  const backend = createBackend(device, [], {
    platform: 'win32',
    hidApi: { devicesAsync: async () => [] },
  });
  await backend.discover();
  await backend.open();
  assert.equal(await backend.getPollingRate(), 4000);
  await backend.close();
});

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
