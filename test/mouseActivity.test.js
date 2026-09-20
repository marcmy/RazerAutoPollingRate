const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { dongles } = require('../src/lib/devices');
const {
  backendForHidMouse,
  createMouseActivityTracker,
  knownMouseForHidDevice,
} = require('../src/lib/mouseBackends/mouseActivity');

function rawUsb(vendorId, productId, serialNumber = null) {
  return {
    serialNumber,
    deviceDescriptor: {
      idVendor: vendorId,
      idProduct: productId,
    },
  };
}

function discovery(...devices) {
  return {
    supportedRazer: devices
      .filter((device) => device.deviceDescriptor.idVendor === 0x1532)
      .map((device) => ({
        device,
        identity: {
          vendorId: device.deviceDescriptor.idVendor,
          productId: device.deviceDescriptor.idProduct,
        },
      })),
    knownCrazyLight: devices
      .filter((device) => device.deviceDescriptor.idVendor === 0x3710
        && device.deviceDescriptor.idProduct === 0x5406)
      .map((device) => ({
        device,
        identity: {
          vendorId: device.deviceDescriptor.idVendor,
          productId: device.deviceDescriptor.idProduct,
        },
      })),
    unknownPulsar: [],
  };
}

function makeHidApi(devices) {
  const opened = new Map();
  class FakeHid extends EventEmitter {
    constructor(path) {
      super();
      this.path = path;
      this.closed = false;
      opened.set(path, this);
    }

    close() {
      this.closed = true;
    }
  }

  return {
    HID: FakeHid,
    devices: () => devices,
    opened,
  };
}

test('activity classifier covers every Razer dongle identity known by the app plus CrazyLight', () => {
  for (const productId of Object.keys(dongles).map(Number)) {
    const mouse = knownMouseForHidDevice({
      vendorId: 0x1532,
      productId,
      usagePage: 1,
      usage: 2,
    });
    assert.equal(mouse.backend, 'razer');
    assert.equal(mouse.productId, productId);
  }

  assert.equal(backendForHidMouse({
    vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2,
  }), 'pulsar');
  assert.equal(knownMouseForHidDevice({
    vendorId: 0x3710, productId: 0x5406, usagePage: 0xff00, usage: 1,
  }), null);
});

test('last-used mouse stays selected while it is active across different backends', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    { path: 'viper', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'pulsar', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x3710, 0x5406));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);

  hidApi.opened.get('viper').emit('data', Buffer.from([1]));
  timestamp += 500;
  hidApi.opened.get('pulsar').emit('data', Buffer.from([1]));

  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);
  tracker.close();
});

test('another known mouse takes over once the selected mouse is idle, including Razer-to-Razer', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    { path: 'viper', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'deathadder', vendorId: 0x1532, productId: 0x00be, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x1532, 0x00be));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);
  hidApi.opened.get('viper').emit('data', Buffer.from([1]));

  timestamp += 1600;
  hidApi.opened.get('deathadder').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00be);

  timestamp += 500;
  hidApi.opened.get('viper').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00be);

  timestamp += 1600;
  hidApi.opened.get('viper').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);

  tracker.close();
});

test('powered-off fallback mouse yields immediately to any other known mouse that produces input', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    { path: 'viper', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'deathadder', vendorId: 0x1532, productId: 0x00be, usagePage: 1, usage: 2 },
    { path: 'pulsar', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });
  const available = discovery(
    rawUsb(0x1532, 0x00e5),
    rawUsb(0x1532, 0x00be),
    rawUsb(0x3710, 0x5406),
  );
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);

  hidApi.opened.get('deathadder').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00be);

  tracker.close();
});

test('serial number distinguishes two known mice that share the same product ID', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    {
      path: 'viper-a',
      vendorId: 0x1532,
      productId: 0x00e5,
      serialNumber: 'A',
      usagePage: 1,
      usage: 2,
    },
    {
      path: 'viper-b',
      vendorId: 0x1532,
      productId: 0x00e5,
      serialNumber: 'B',
      usagePage: 1,
      usage: 2,
    },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });
  const available = discovery(
    rawUsb(0x1532, 0x00e5, 'A'),
    rawUsb(0x1532, 0x00e5, 'B'),
  );
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: 'A' };

  assert.equal(tracker.choosePreferredMouse(available, fallback).serialNumber, 'A');
  hidApi.opened.get('viper-a').emit('data', Buffer.from([1]));

  timestamp += 1600;
  hidApi.opened.get('viper-b').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMouse(available, fallback).serialNumber, 'B');

  tracker.close();
});
