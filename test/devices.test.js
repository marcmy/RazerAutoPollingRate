const test = require('node:test');
const assert = require('node:assert/strict');

const { dongles, models } = require('../src/lib/devices');

test('DeathAdder V4 Pro wired and wireless use the polling control interface', () => {
  for (const productId of [0x00BE, 0x00BF]) {
    assert.deepEqual(dongles[productId], {
      model: models.DeathAdderV4Pro,
      is8kCompatible: true,
      interfaceIndex: 0x00,
    });
  }
});

test('Viper V4 Pro retains its distinct control interface', () => {
  assert.equal(dongles[0x00E5].interfaceIndex, 0x03);
  assert.equal(dongles[0x00E6].interfaceIndex, 0x03);
});
