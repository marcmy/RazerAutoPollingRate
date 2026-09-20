const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const {
  backendForHidMouse,
  createMouseActivityTracker,
} = require('../src/lib/mouseBackends/mouseActivity');

function discoveryBoth() {
  return {
    supportedRazer: [{ identity: { vendorId: 0x1532, productId: 0x00e5 } }],
    knownCrazyLight: [{ identity: { vendorId: 0x3710, productId: 0x5406 } }],
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

test('activity classifier only accepts supported mouse HID collections', () => {
  assert.equal(backendForHidMouse({
    vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2,
  }), 'razer');
  assert.equal(backendForHidMouse({
    vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2,
  }), 'pulsar');
  assert.equal(backendForHidMouse({
    vendorId: 0x3710, productId: 0x5406, usagePage: 0xff00, usage: 1,
  }), null);
});

test('most recently active attached mouse wins over fixed Razer fallback', () => {
  let timestamp = 100;
  const hidApi = makeHidApi([
    { path: 'razer-mouse', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'pulsar-mouse', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    refreshIntervalMs: 0,
  });

  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');

  timestamp = 200;
  hidApi.opened.get('pulsar-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'pulsar');

  timestamp = 300;
  hidApi.opened.get('razer-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');

  tracker.close();
  assert.equal(hidApi.opened.get('razer-mouse').closed, true);
  assert.equal(hidApi.opened.get('pulsar-mouse').closed, true);
});
