const test = require('node:test');
const assert = require('node:assert/strict');

let rollingBuildVersion = {};
try {
  rollingBuildVersion = require('../scripts/stamp-rolling-build');
} catch (_error) {
  // RED: the implementation is introduced after these behavior tests.
}

test('CalVer maps to a monotonic Squirrel-compatible internal version', () => {
  assert.equal(typeof rollingBuildVersion.toInternalVersion, 'function');
  assert.equal(rollingBuildVersion.toInternalVersion('20260914.0818'), '2026.914.818');
  assert.equal(rollingBuildVersion.toInternalVersion('20261231.2359'), '2026.1231.2359');
});

test('invalid rolling versions are rejected before packaging', () => {
  assert.equal(typeof rollingBuildVersion.toInternalVersion, 'function');
  assert.throws(() => rollingBuildVersion.toInternalVersion('1.3.6'), /rolling version/i);
  assert.throws(() => rollingBuildVersion.toInternalVersion('20260914.2460'), /rolling version/i);
});
