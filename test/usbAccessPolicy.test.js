const test = require('node:test');
const assert = require('node:assert/strict');

const { createUsbAccessPolicy } = require('../src/lib/usbAccessPolicy');

test('USB access runs only for startup, target changes, and health checks', () => {
  const policy = createUsbAccessPolicy({ healthCheckIntervalMs: 1000 });
  assert.equal(policy.shouldAccess({ now: 0, targetRate: 125, enabled: true, firstRun: true }).reason, 'startup');
  policy.recordSuccess({ now: 0, targetRate: 125 });
  assert.deepEqual(policy.shouldAccess({ now: 500, targetRate: 125, enabled: true }), {
    access: false,
    reason: 'unchanged',
    targetChanged: false,
  });
  assert.equal(policy.shouldAccess({ now: 500, targetRate: 1000, enabled: true }).reason, 'target_changed');
  assert.equal(policy.shouldAccess({ now: 1000, targetRate: 125, enabled: true }).reason, 'health_check');
});

test('disabled mode performs no USB access and re-enabling forces one check', () => {
  const policy = createUsbAccessPolicy();
  policy.recordSuccess({ now: 100, targetRate: 125 });
  assert.equal(policy.shouldAccess({ now: 200, targetRate: 125, enabled: false }).reason, 'disabled');
  assert.equal(policy.shouldAccess({ now: 201, targetRate: 125, enabled: true }).reason, 'enabled');
});

test('USB errors use exponential backoff', () => {
  const policy = createUsbAccessPolicy({ errorBackoffBaseMs: 100, errorBackoffMaxMs: 250 });
  assert.equal(policy.recordFailure({ now: 0 }).backoffMs, 100);
  assert.equal(policy.shouldAccess({ now: 99, targetRate: 125, enabled: true }).reason, 'backoff');
  assert.equal(policy.shouldAccess({ now: 100, targetRate: 125, enabled: true }).reason, 'retry');
  assert.equal(policy.recordFailure({ now: 100 }).backoffMs, 200);
  assert.equal(policy.recordFailure({ now: 300 }).backoffMs, 250);
});
