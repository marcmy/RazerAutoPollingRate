const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getReportByteForRate,
  parsePollingRate,
  resolveSupportedPollingRate,
} = require('../src/lib/rates');

test('8000 Hz behavior is gated by device compatibility', () => {
  const unsupported = resolveSupportedPollingRate(8000, { is8kCompatible: false });
  const supported = resolveSupportedPollingRate(8000, { is8kCompatible: true });

  assert.equal(unsupported.rate, 4000);
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.warning, /8000 Hz is not supported/);
  assert.equal(supported.rate, 8000);
  assert.equal(supported.supported, true);
});

test('invalid target rate never reaches USB report-byte mapping', () => {
  assert.equal(parsePollingRate('3333'), null);
  assert.throws(() => getReportByteForRate('3333'), /Invalid polling rate/);
});

test('valid target rates map to Razer report bytes', () => {
  assert.equal(getReportByteForRate(125), 0x40);
  assert.equal(getReportByteForRate(250), 0x20);
  assert.equal(getReportByteForRate(500), 0x10);
  assert.equal(getReportByteForRate(1000), 0x08);
  assert.equal(getReportByteForRate(2000), 0x04);
  assert.equal(getReportByteForRate(4000), 0x02);
  assert.equal(getReportByteForRate(8000), 0x01);
});
