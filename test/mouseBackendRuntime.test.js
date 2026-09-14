const test = require('node:test');
const assert = require('node:assert/strict');

const { createPreferredMouseBackend } = require('../src/lib/mouseBackends/runtime');

function rawUsb(vendorId, productId) {
  return {
    deviceDescriptor: {
      idVendor: vendorId,
      idProduct: productId,
    },
  };
}

function fakeBackend(id) {
  return { id, canWrite: true };
}

test('runtime prefers the existing Razer automatic backend when both vendors are attached', () => {
  const created = [];
  const result = createPreferredMouseBackend({
    getDeviceList: () => [
      rawUsb(0x3710, 0x5406),
      rawUsb(0x1532, 0x00e5),
    ],
    createRazerBackend: (options) => {
      created.push(['razer', options]);
      return fakeBackend('razer');
    },
    createPulsarBackend: (options) => {
      created.push(['pulsar', options]);
      return fakeBackend('pulsar-x2-crazylight');
    },
  });

  assert.equal(result.path, 'razer');
  assert.equal(result.backend.id, 'razer');
  assert.equal(created.filter(([kind]) => kind === 'razer').length, 1);
  assert.equal(created.filter(([kind]) => kind === 'pulsar').length, 0);
});

test('runtime enables writes only for the hardware-validated CrazyLight identity', () => {
  let factoryOptions = null;
  const result = createPreferredMouseBackend({
    getDeviceList: () => [rawUsb(0x3710, 0x5406)],
    createRazerBackend: () => {
      throw new Error('Razer backend must not be created');
    },
    createPulsarBackend: (options) => {
      factoryOptions = options;
      return fakeBackend('pulsar-x2-crazylight');
    },
  });

  assert.equal(result.path, 'pulsar');
  assert.equal(result.backend.id, 'pulsar-x2-crazylight');
  assert.equal(factoryOptions.allowHardwareValidationWrites, true);
});

test('runtime never constructs a protocol backend for an unknown Pulsar PID', () => {
  const diagnostics = [];
  let factoryCalls = 0;

  assert.throws(() => createPreferredMouseBackend({
    getDeviceList: () => [rawUsb(0x3710, 0x9999)],
    createRazerBackend: () => {
      factoryCalls += 1;
      return fakeBackend('razer');
    },
    createPulsarBackend: () => {
      factoryCalls += 1;
      return fakeBackend('pulsar-x2-crazylight');
    },
    onDiagnostic: (event, details) => diagnostics.push([event, details]),
  }), /No supported Razer or Pulsar/i);

  assert.equal(factoryCalls, 0);
  assert.ok(diagnostics.some(([event, details]) => event === 'pulsar_usb_detected'
    && details.vendorId === 0x3710 && details.productId === 0x9999
    && details.supported === false));
});
