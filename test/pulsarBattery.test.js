const test = require('node:test');
const assert = require('node:assert/strict');
const { batteryPercentFromVoltage, createPulsarBatteryEstimator } = require('../src/lib/pulsarBattery');

const sample = (fields = {}) => ({ batteryId: '1bcbc4', batteryPercent: 75,
  voltageMv: 4016, charging: false, ...fields });

test('battery calibration interpolates one-percent readings and handles calibration boundaries', () => {
  assert.equal(batteryPercentFromVoltage(4016), 79);
  assert.equal(batteryPercentFromVoltage(4020), 80);
  assert.equal(batteryPercentFromVoltage(4036), 84);
  assert.equal(batteryPercentFromVoltage(4110), 100);
  assert.equal(batteryPercentFromVoltage(3050), 0);
  assert.equal(batteryPercentFromVoltage(0), null);
  assert.equal(batteryPercentFromVoltage(65535), null);
  assert.equal(createPulsarBatteryEstimator()(sample(), 'dongle', 0), 79);
});

test('charging voltage and coarse 95 percent cannot jump the same mouse across cable transitions', () => {
  const estimate = createPulsarBatteryEstimator();
  assert.equal(estimate(sample(), 'dongle', 0), 79);
  const cable = sample({ batteryPercent: 95, voltageMv: 4172, charging: true });
  assert.equal(estimate(cable, 'cable', 3000), 79);
  assert.equal(estimate(cable, 'cable', 63000), 81);
  assert.equal(estimate(sample(), 'dongle', 64000), 81);
  assert.equal(estimate(sample(), 'dongle', 124000), 80);
});

test('saved battery baseline survives restart on the cable without leaking to another mouse', () => {
  let saved = {};
  createPulsarBatteryEstimator({ saveHistory: (history) => { saved = history; } })(sample(), 'dongle', 1000);
  const restarted = createPulsarBatteryEstimator({ loadHistory: () => saved });
  const cable = sample({ batteryPercent: 95, voltageMv: 4172, charging: true });
  assert.equal(restarted(cable, 'cable', 5000), 79);
  assert.equal(restarted({ ...cable, batteryId: 'abcdef' }, 'other mouse', 5000), null);
});

test('cold charging has no invented level, and full requires repeated device confirmation', () => {
  const estimate = createPulsarBatteryEstimator();
  const charging = sample({ charging: true, batteryPercent: 95, voltageMv: 4172 });
  assert.equal(estimate(charging, 'cable', 0), null);
  for (let i = 1; i < 8; i += 1) {
    assert.equal(estimate({ ...charging, batteryPercent: 100 }, 'cable', i * 60000), null);
  }
  assert.equal(estimate({ ...charging, batteryPercent: 100 }, 'cable', 8 * 60000), 100);
  assert.equal(estimate(sample({ batteryPercent: 0 }), 'dongle', 9 * 60000), 0);
});

test('stale or corrupt history and unsupported voltage do not fabricate precision', () => {
  const loadHistory = () => ({ '1bcbc4': { level: 1, timestamp: 0, charging: false },
    abcdef: { level: 200, timestamp: 0, charging: false } });
  const estimate = createPulsarBatteryEstimator({ loadHistory, saveHistory: () => { throw new Error('store unavailable'); } });
  assert.equal(estimate(sample({ voltageMv: null }), 'dongle', 31 * 60000), 75);
  assert.equal(estimate(sample({ batteryId: 'abcdef' }), 'second', 31 * 60000), 79);
});

test('recharging while the app is closed cannot permanently trap an unplugged estimate', () => {
  const estimate = createPulsarBatteryEstimator({ loadHistory: () => ({
    '1bcbc4': { level: 79, timestamp: 0, charging: false },
  }) });
  assert.equal(estimate(sample({ batteryPercent: 100, voltageMv: 4200 }), 'dongle', 60000), 81);
  assert.equal(estimate(sample({ batteryPercent: 100, voltageMv: 4200 }), 'dongle', 120000), 82);
});
