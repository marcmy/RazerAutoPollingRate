const test = require('node:test');
const assert = require('node:assert/strict');
const { createMouseTelemetryReader, formatMouseTelemetry } = require('../src/lib/mouseTelemetry');

test('battery reads are cached across polling backends and refreshed on cable changes or reconnect', async () => {
  let timestamp = 0;
  let reads = 0;
  const read = createMouseTelemetryReader({ now: () => timestamp });
  const backend = (productId, path) => ({
    id: 'pulsar-x2-crazylight',
    deviceInfo: { vendorId: 0x3710, productId, path },
    async getBatteryStatus() { reads += 1; return { batteryPercent: 95, charging: productId === 0x3524 }; },
  });
  assert.equal((await read(backend(0x5406, 'dongle'))).charging, false);
  timestamp = 1500;
  await read(backend(0x5406, 'dongle'));
  assert.equal(reads, 1);
  assert.equal((await read(backend(0x3524, 'wire'))).charging, true);
  assert.equal(reads, 2);
  timestamp += 60000;
  await read(backend(0x3524, 'wire'));
  assert.equal(reads, 3);
  read.reset();
  await read(backend(0x3524, 'wire'));
  assert.equal(reads, 4);
});

test('battery failures clear stale power readings, back off retries and do not reject the polling check', async () => {
  let timestamp = 0;
  let reads = 0;
  const read = createMouseTelemetryReader({ now: () => timestamp });
  const backend = { id: 'pulsar', deviceInfo: { path: 'same' }, async getBatteryStatus() {
    reads += 1;
    if (reads === 1) return { batteryPercent: 1, charging: true };
    throw new Error('Battery unavailable');
  } };
  await read(backend);
  timestamp = 60000;
  assert.deepEqual(await read(backend), { batteryPercent: null, charging: null, batteryError: 'Battery unavailable' });
  timestamp += 1500;
  await read(backend);
  assert.equal(reads, 2);
  assert.equal((await read({ id: 'razer', deviceInfo: {} })).batteryError, null);
});

test('a wire alone never implies charging and a real empty battery remains visible', () => {
  assert.equal(formatMouseTelemetry({ connection: 'wired' }), 'Wired');
  assert.equal(formatMouseTelemetry({ connection: 'wired', batteryPercent: 0, charging: false }), 'Wired · 0% battery · Not charging');
  assert.equal(formatMouseTelemetry({ connection: 'wired', batteryPercent: 95, charging: true }), 'Wired · 95% battery · Charging');
});
