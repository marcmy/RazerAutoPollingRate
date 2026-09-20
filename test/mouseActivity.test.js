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

test('last-used mouse stays selected while it is active', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    { path: 'razer-mouse', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'pulsar-mouse', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });

  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');

  hidApi.opened.get('razer-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.getSelectedPath(), 'razer');

  timestamp += 500;
  hidApi.opened.get('pulsar-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');

  tracker.close();
});

test('activity on another mouse takes over once the selected mouse is idle', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    { path: 'razer-mouse', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'pulsar-mouse', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });

  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');
  hidApi.opened.get('razer-mouse').emit('data', Buffer.from([1]));

  timestamp += 1600;
  hidApi.opened.get('pulsar-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'pulsar');

  timestamp += 500;
  hidApi.opened.get('razer-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'pulsar');

  timestamp += 1600;
  hidApi.opened.get('razer-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');

  tracker.close();
});

test('powered-off fallback mouse yields immediately when another mouse produces input', () => {
  let timestamp = 10000;
  const hidApi = makeHidApi([
    { path: 'razer-mouse', vendorId: 0x1532, productId: 0x00e5, usagePage: 1, usage: 2 },
    { path: 'pulsar-mouse', vendorId: 0x3710, productId: 0x5406, usagePage: 1, usage: 2 },
  ]);
  const tracker = createMouseActivityTracker({
    hidApi,
    now: () => timestamp,
    idleMs: 1500,
    refreshIntervalMs: 0,
  });

  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'razer');

  // Razer has never produced an input report, matching a powered-off mouse
  // whose dongle is still enumerated. The first real Pulsar input wins.
  hidApi.opened.get('pulsar-mouse').emit('data', Buffer.from([1]));
  assert.equal(tracker.choosePreferredMousePath(discoveryBoth(), 'razer'), 'pulsar');

  tracker.close();
  assert.equal(hidApi.opened.get('razer-mouse').closed, true);
  assert.equal(hidApi.opened.get('pulsar-mouse').closed, true);
});
