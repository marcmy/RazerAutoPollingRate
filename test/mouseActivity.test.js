const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { dongles } = require('../src/lib/devices');
const {
  backendForHidMouse,
  createMouseActivityTracker,
  knownMouseForHidDevice,
  knownMouseForIdentity,
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

function makeRawMonitorHarness() {
  let callbacks = null;
  let closed = false;

  return {
    factory(options) {
      callbacks = options;
      return {
        close() {
          closed = true;
        },
      };
    },
    emit(vendorId, productId, devicePath = null) {
      assert.ok(callbacks, 'raw monitor must be started first');
      callbacks.onActivity({ vendorId, productId, devicePath });
    },
    get closed() {
      return closed;
    },
  };
}

function makeHidApi(devices) {
  const opened = new Map();
  class FakeHid extends EventEmitter {
    constructor(devicePath) {
      super();
      this.path = devicePath;
      this.closed = false;
      opened.set(devicePath, this);
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
    const mouse = knownMouseForIdentity(0x1532, productId);
    assert.equal(mouse.backend, 'razer');
    assert.equal(mouse.productId, productId);
  }

  assert.equal(knownMouseForIdentity(0x3710, 0x5406).backend, 'pulsar');
  assert.equal(knownMouseForIdentity(0x3710, 0x9999), null);

  assert.equal(backendForHidMouse({
    vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2,
  }), 'pulsar');
  assert.equal(knownMouseForHidDevice({
    vendorId: 0x3710, productId: 0x5406, usagePage: 0xff00, usage: 1,
  }), null);
});

test('Windows Raw Input switches from fallback Razer to active CrazyLight immediately', () => {
  let timestamp = 10000;
  const changes = [];
  const raw = makeRawMonitorHarness();
  const tracker = createMouseActivityTracker({
    platform: 'win32',
    rawMouseMonitorFactory: raw.factory,
    now: () => timestamp,
    onActiveMouseChanged: (details) => changes.push(details),
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x3710, 0x5406));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);

  timestamp += 1;
  raw.emit(0x3710, 0x5406, '\\\\?\\HID#VID_3710&PID_5406&MI_00#pulsar');
  assert.equal(tracker.getSelectedMouse().productId, 0x5406);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].activeMouse.backend, 'pulsar');

  tracker.close();
  assert.equal(raw.closed, true);
});

test('Windows Raw Input can switch back and forth with no idle delay', () => {
  const changes = [];
  const raw = makeRawMonitorHarness();
  const tracker = createMouseActivityTracker({
    platform: 'win32',
    rawMouseMonitorFactory: raw.factory,
    onActiveMouseChanged: (details) => changes.push(details),
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x3710, 0x5406));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  tracker.choosePreferredMouse(available, fallback);
  raw.emit(0x3710, 0x5406, 'pulsar');
  raw.emit(0x1532, 0x00e5, 'viper');
  raw.emit(0x3710, 0x5406, 'pulsar');

  assert.equal(tracker.getSelectedMouse().backend, 'pulsar');
  assert.deepEqual(changes.map((change) => change.activeMouse.backend), ['pulsar', 'razer', 'pulsar']);
  tracker.close();
});

test('Windows Raw Input switches between exact known Razer models', () => {
  const raw = makeRawMonitorHarness();
  const tracker = createMouseActivityTracker({
    platform: 'win32',
    rawMouseMonitorFactory: raw.factory,
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x1532, 0x00be));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  assert.equal(tracker.choosePreferredMouse(available, fallback).productId, 0x00e5);
  raw.emit(0x1532, 0x00be, 'deathadder');
  assert.equal(tracker.getSelectedMouse().productId, 0x00be);

  tracker.close();
});

test('unsupported Raw Input devices never steal selection', () => {
  const changes = [];
  const raw = makeRawMonitorHarness();
  const tracker = createMouseActivityTracker({
    platform: 'win32',
    rawMouseMonitorFactory: raw.factory,
    onActiveMouseChanged: (details) => changes.push(details),
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x3710, 0x5406));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  tracker.choosePreferredMouse(available, fallback);
  raw.emit(0x046d, 0xc547, 'unrelated-mouse');

  assert.equal(tracker.getSelectedMouse().productId, 0x00e5);
  assert.equal(changes.length, 0);
  tracker.close();
});

test('non-Windows fallback still uses changing HID reports for activity', () => {
  const hidApi = makeHidApi([
    { path: 'viper', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'pulsar', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    platform: 'linux',
    hidApi,
    refreshIntervalMs: 0,
  });
  const available = discovery(rawUsb(0x1532, 0x00e5), rawUsb(0x3710, 0x5406));
  const fallback = { backend: 'razer', vendorId: 0x1532, productId: 0x00e5, serialNumber: null };

  tracker.choosePreferredMouse(available, fallback);
  hidApi.opened.get('pulsar').emit('data', Buffer.from([1, 0, 0]));
  hidApi.opened.get('pulsar').emit('data', Buffer.from([1, 2, 0]));

  assert.equal(tracker.getSelectedMouse().backend, 'pulsar');
  tracker.close();
});
