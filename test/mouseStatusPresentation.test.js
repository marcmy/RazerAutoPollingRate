const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NO_SUPPORTED_MOUSE_FOUND,
  createMouseStatusNormalizer,
} = require('../src/lib/mouseStatusPresentation');

test('CrazyLight shutdown does not expose intermediate Turbo presentation states', () => {
  const normalize = createMouseStatusNormalizer();

  assert.equal(
    normalize('Mouse: 8K Dongle Gen.2 · Turbo off'),
    'Mouse: 8K Dongle Gen.2 · Turbo off',
  );

  // Turbo state is cleared before the backend finally reports the sleeping
  // device unavailable. Keep the last complete presentation during that gap.
  assert.equal(
    normalize('Mouse: 8K Dongle Gen.2'),
    'Mouse: 8K Dongle Gen.2 · Turbo off',
  );

  // A Turbo error attached to an already-disconnected state must never be
  // rendered as a separate intermediate status.
  assert.equal(
    normalize('No supported mouse connected · Turbo unavailable'),
    NO_SUPPORTED_MOUSE_FOUND,
  );

  assert.equal(
    normalize('No supported mouse connected'),
    NO_SUPPORTED_MOUSE_FOUND,
  );
});

test('normal Razer mouse transitions are unchanged', () => {
  const normalize = createMouseStatusNormalizer();

  assert.equal(
    normalize('Mouse: Razer Viper V4 Pro'),
    'Mouse: Razer Viper V4 Pro',
  );
  assert.equal(
    normalize('No supported mouse connected'),
    NO_SUPPORTED_MOUSE_FOUND,
  );
});

test('Turbo unavailable remains visible when an actual mouse is still visible', () => {
  const normalize = createMouseStatusNormalizer();

  assert.equal(
    normalize('Mouse: 8K Dongle Gen.2 · Turbo unavailable'),
    'Mouse: 8K Dongle Gen.2 · Turbo unavailable',
  );
});
