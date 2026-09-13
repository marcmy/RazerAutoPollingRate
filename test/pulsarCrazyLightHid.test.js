const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
  CRAZYLIGHT_INTERFACE,
  createCrazyLightHidTransport,
} = require('../src/lib/mouseBackends/pulsarCrazyLightHid');

function createFakeHidApi(replies = []) {
  const calls = [];
  const devices = [
    {
      vendorId: CRAZYLIGHT_VENDOR_ID,
      productId: CRAZYLIGHT_PRODUCT_ID,
      path: 'mouse-interface',
      interface: 0,
      usagePage: 0x01,
      usage: 0x02,
      product: 'Pulsar X2 CrazyLight',
    },
    {
      vendorId: CRAZYLIGHT_VENDOR_ID,
      productId: CRAZYLIGHT_PRODUCT_ID,
      path: 'consumer-collection',
      interface: CRAZYLIGHT_INTERFACE,
      usagePage: 0x0c,
      usage: 0x01,
      product: 'Pulsar X2 CrazyLight',
    },
    {
      vendorId: CRAZYLIGHT_VENDOR_ID,
      productId: CRAZYLIGHT_PRODUCT_ID,
      path: 'vendor-collection',
      interface: CRAZYLIGHT_INTERFACE,
      usagePage: 0xff05,
      usage: 0x00,
      product: 'Pulsar X2 CrazyLight',
    },
  ];

  const handle = {
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

  return {
    calls,
    devicesAsync: async (vendorId, productId) => {
      calls.push(['devicesAsync', vendorId, productId]);
      return devices;
    },
    HIDAsync: {
      open: async (path, options) => {
        calls.push(['open', path, options]);
        return handle;
      },
    },
  };
}

function createCapsInspector(overrides = {}) {
  const defaults = {
    'consumer-collection': {
      usagePage: 0x0c,
      usage: 0x01,
      inputReportByteLength: 17,
      outputReportByteLength: 17,
      featureReportByteLength: 0,
    },
    'vendor-collection': {
      usagePage: 0xff05,
      usage: 0x00,
      inputReportByteLength: 8,
      outputReportByteLength: 0,
      featureReportByteLength: 0,
    },
  };
  const caps = { ...defaults, ...overrides };
  return async (devicePath) => {
    if (!caps[devicePath]) throw new Error(`no fake caps for ${devicePath}`);
    return caps[devicePath];
  };
}

test('Windows HID transport selects interface 1 collection by usable report caps, not vendor usage page', async () => {
  const hidApi = createFakeHidApi();
  const transport = createCrazyLightHidTransport({
    hidApi,
    inspectHidCaps: createCapsInspector(),
  });

  const info = await transport.discover();
  await transport.open();

  assert.equal(info.vendorId, CRAZYLIGHT_VENDOR_ID);
  assert.equal(info.productId, CRAZYLIGHT_PRODUCT_ID);
  assert.equal(info.interfaceNumber, CRAZYLIGHT_INTERFACE);
  assert.equal(info.path, 'consumer-collection');
  assert.equal(info.inputReportByteLength, 17);
  assert.equal(info.outputReportByteLength, 17);
  assert.deepEqual(hidApi.calls.find(([name]) => name === 'open'), [
    'open',
    'consumer-collection',
    { nonExclusive: true },
  ]);

  await transport.close();
});

test('Windows HID transport reports every interface 1 candidate when none support 17-byte I/O', async () => {
  const hidApi = createFakeHidApi();
  const transport = createCrazyLightHidTransport({
    hidApi,
    inspectHidCaps: createCapsInspector({
      'consumer-collection': {
        usagePage: 0x0c,
        usage: 0x01,
        inputReportByteLength: 8,
        outputReportByteLength: 0,
        featureReportByteLength: 0,
      },
    }),
  });

  await assert.rejects(
    () => transport.discover(),
    (error) => {
      assert.match(error.message, /no interface 1 hid collection supports 17-byte input\/output reports/i);
      assert.match(error.message, /consumer-collection.*Input=8.*Output=0/i);
      assert.match(error.message, /vendor-collection.*Input=8.*Output=0/i);
      return true;
    },
  );
});

test('Windows HID transport sends report 0x08 through control output path and reads input report', async () => {
  const reply = Buffer.from([0x08, 0x0e, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x3e]);
  const hidApi = createFakeHidApi([reply]);
  const controlWrites = [];
  const transport = createCrazyLightHidTransport({
    hidApi,
    inspectHidCaps: createCapsInspector(),
    sendOutputReport: async (devicePath, packet) => {
      controlWrites.push([devicePath, Buffer.from(packet)]);
    },
  });
  const packet = Buffer.alloc(17);
  packet[0] = 0x08;
  packet[1] = 0x0e;

  await transport.discover();
  await transport.open();
  await transport.writeReport(packet);
  const received = await transport.readReport();
  await transport.close();

  assert.deepEqual(controlWrites, [['consumer-collection', packet]]);
  assert.equal(hidApi.calls.some(([name]) => name === 'write'), false);
  assert.deepEqual(received, reply);
  assert.ok(hidApi.calls.some(([name, timeout]) => name === 'read' && timeout === 2000));
});

test('Windows HID transport rejects missing interface 1 HID collection', async () => {
  const hidApi = createFakeHidApi();
  hidApi.devicesAsync = async () => [{
    vendorId: CRAZYLIGHT_VENDOR_ID,
    productId: CRAZYLIGHT_PRODUCT_ID,
    path: 'mouse-only',
    interface: 0,
    usagePage: 0x01,
    usage: 0x02,
  }];
  const transport = createCrazyLightHidTransport({
    hidApi,
    inspectHidCaps: createCapsInspector(),
  });

  await assert.rejects(() => transport.discover(), /interface 1/i);
});
