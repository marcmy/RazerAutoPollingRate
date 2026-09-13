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
      usagePage: 0xff00,
      usage: 0x01,
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

test('Windows HID transport selects interface 1 vendor-defined collection first', async () => {
  const hidApi = createFakeHidApi();
  const transport = createCrazyLightHidTransport({ hidApi });

  const info = await transport.discover();
  await transport.open();

  assert.equal(info.vendorId, CRAZYLIGHT_VENDOR_ID);
  assert.equal(info.productId, CRAZYLIGHT_PRODUCT_ID);
  assert.equal(info.interfaceNumber, CRAZYLIGHT_INTERFACE);
  assert.equal(info.path, 'vendor-collection');
  assert.deepEqual(hidApi.calls.find(([name]) => name === 'open'), [
    'open',
    'vendor-collection',
    { nonExclusive: true },
  ]);

  await transport.close();
});

test('Windows HID transport sends report 0x08 unchanged as an output report and reads input report', async () => {
  const reply = Buffer.from([0x08, 0x0e, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x3e]);
  const hidApi = createFakeHidApi([reply]);
  const transport = createCrazyLightHidTransport({ hidApi });
  const packet = Buffer.alloc(17);
  packet[0] = 0x08;
  packet[1] = 0x0e;

  await transport.discover();
  await transport.open();
  await transport.writeReport(packet);
  const received = await transport.readReport();
  await transport.close();

  const write = hidApi.calls.find(([name]) => name === 'write');
  assert.deepEqual(write[1], packet);
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
  const transport = createCrazyLightHidTransport({ hidApi });

  await assert.rejects(() => transport.discover(), /interface 1/i);
});
