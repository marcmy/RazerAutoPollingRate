const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyUsbDevices,
  choosePreferredMousePath,
  getUsbIdentity,
} = require('../src/lib/mouseBackends/discovery');

function rawUsb(vendorId, productId) {
  return {
    deviceDescriptor: {
      idVendor: vendorId,
      idProduct: productId,
    },
  };
}

test('getUsbIdentity accepts both WebUSB and node-usb device shapes', () => {
  assert.deepEqual(getUsbIdentity({ vendorId: 0x3710, productId: 0x5406 }), {
    vendorId: 0x3710,
    productId: 0x5406,
  });
  assert.deepEqual(getUsbIdentity(rawUsb(0x3710, 0x5406)), {
    vendorId: 0x3710,
    productId: 0x5406,
  });
});

test('discovery separates known CrazyLight from unknown Pulsar devices', () => {
  const result = classifyUsbDevices([
    rawUsb(0x3710, 0x5406),
    rawUsb(0x3710, 0x9999),
    rawUsb(0x1234, 0xabcd),
  ]);

  assert.equal(result.knownCrazyLight.length, 1);
  assert.equal(result.unknownPulsar.length, 1);
  assert.deepEqual(result.unknownPulsar[0].identity, {
    vendorId: 0x3710,
    productId: 0x9999,
  });
});

test('supported Razer remains preferred for automatic switching when both vendors are present', () => {
  const result = classifyUsbDevices([
    rawUsb(0x1532, 0x00e5),
    rawUsb(0x3710, 0x5406),
  ]);

  assert.equal(result.supportedRazer.length, 1);
  assert.equal(result.knownCrazyLight.length, 1);
  assert.equal(choosePreferredMousePath(result), 'razer');
});

test('known CrazyLight without Razer selects probe-only path', () => {
  const result = classifyUsbDevices([rawUsb(0x3710, 0x5406)]);
  assert.equal(choosePreferredMousePath(result), 'pulsar-probe');
});

test('unknown Pulsar alone never selects a protocol path', () => {
  const result = classifyUsbDevices([rawUsb(0x3710, 0x8888)]);
  assert.equal(choosePreferredMousePath(result), null);
});
