const test = require('node:test');
const assert = require('node:assert/strict');

const { createPreferredMouseBackend } = require('../src/lib/mouseBackends/runtime');

function rawUsb(vendorId, productId, serialNumber = null) {
  return {
    serialNumber,
    deviceDescriptor: {
      idVendor: vendorId,
      idProduct: productId,
    },
  };
}

function fakeBackend(id) {
  return { id, canWrite: true };
}

test('runtime falls back to the first supported Razer identity when no activity is known', () => {
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
  assert.equal(result.selectedMouse.productId, 0x00e5);
  assert.equal(result.backend.id, 'razer');
  assert.equal(created.filter(([kind]) => kind === 'razer').length, 1);
  assert.equal(created.filter(([kind]) => kind === 'pulsar').length, 0);
  assert.equal(created[0][1].preferredProductId, 0x00e5);
});

test('runtime targets the exact active Razer model instead of any Razer dongle', () => {
  const created = [];
  const result = createPreferredMouseBackend({
    getDeviceList: () => [
      rawUsb(0x1532, 0x00e5),
      rawUsb(0x1532, 0x00be),
      rawUsb(0x3710, 0x5406),
    ],
    activityTracker: {
      choosePreferredMouse: (_discovery, fallbackMouse) => {
        assert.equal(fallbackMouse.productId, 0x00e5);
        return {
          backend: 'razer',
          vendorId: 0x1532,
          productId: 0x00be,
          serialNumber: 'deathadder-1',
        };
      },
    },
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
  assert.equal(result.selectedMouse.productId, 0x00be);
  assert.equal(created[0][1].preferredProductId, 0x00be);
  assert.equal(created[0][1].preferredSerialNumber, 'deathadder-1');
});

test('runtime prefers the Pulsar identity selected by mouse activity', () => {
  const created = [];
  const result = createPreferredMouseBackend({
    getDeviceList: () => [
      rawUsb(0x3710, 0x5406),
      rawUsb(0x1532, 0x00e5),
    ],
    activityTracker: {
      choosePreferredMouse: () => ({
        backend: 'pulsar',
        vendorId: 0x3710,
        productId: 0x5406,
        serialNumber: null,
      }),
    },
    createRazerBackend: (options) => {
      created.push(['razer', options]);
      return fakeBackend('razer');
    },
    createPulsarBackend: (options) => {
      created.push(['pulsar', options]);
      return fakeBackend('pulsar-x2-crazylight');
    },
  });

  assert.equal(result.path, 'pulsar');
  assert.equal(result.backend.id, 'pulsar-x2-crazylight');
  assert.equal(created.filter(([kind]) => kind === 'razer').length, 0);
  assert.equal(created.filter(([kind]) => kind === 'pulsar').length, 1);
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
