const test = require('node:test');
const assert = require('node:assert/strict');
const { createMouseIdlePolicy, MOUSE_IDLE_MS } = require('../src/lib/mouseIdle');

function fixture() {
  let time = 1000;
  const policy = createMouseIdlePolicy({ now: () => time });
  const state = { mouse: { backend: 'pulsar', vendorId: 0x3710, productId: 0x5406 }, connectionToken: 'receiver:1', monitorReady: true, lastInput: 1000, targetRate: 125, turboTarget: false, enabled: true };
  return { policy, state, time: (value) => { time = value; } };
}

test('verified wireless CrazyLight settings can remain quiet for hours and resume on real input', () => {
  const { policy, state, time } = fixture();
  const initial = policy.decide(state);
  assert.equal(initial.pause, false);
  policy.markVerified(initial.signature);
  time(1000 + MOUSE_IDLE_MS);
  assert.equal(policy.decide(state).enteredIdle, true);
  for (let value = 12500; value < 7200000; value += 1500) {
    time(value);
    const idle = policy.decide(state);
    assert.equal(idle.pause, true);
    assert.equal(idle.enteredIdle, false);
  }
  assert.equal(policy.decide({ ...state, lastInput: 7200000 }).resumed, true);
});

test('continuous real-input heartbeats prevent a moving mouse from being treated as idle', () => {
  const { policy, state, time } = fixture();
  for (let value = 1000; value <= 60000; value += 1500) {
    time(value);
    const result = policy.decide({ ...state, lastInput: value - 1000 });
    assert.equal(result.pause, false);
    policy.markVerified(result.signature);
  }
});

test('rate, Turbo, enabled state, receiver generation and selected identity changes always force verification', () => {
  for (const change of [
    { targetRate: 4000 }, { turboTarget: true }, { enabled: false }, { connectionToken: 'receiver:2' },
    { mouse: { backend: 'pulsar', vendorId: 0x3710, productId: 0x5406, serialNumber: 'other' } },
  ]) {
    const { policy, state, time } = fixture();
    policy.markVerified(policy.decide(state).signature);
    time(20000);
    assert.equal(policy.decide(state).pause, true);
    const result = policy.decide({ ...state, ...change });
    assert.equal(result.pause, false);
    assert.equal(result.resumed, true);
    assert.equal(policy.decide({ ...state, ...change }).pause, false, 'changed state must succeed first');
  }
});

test('Razer, wired and unknown mice, missing receivers and unavailable input monitors keep normal checking', () => {
  const states = [
    { mouse: { backend: 'razer', vendorId: 0x1532, productId: 0x00e5 } },
    { mouse: { backend: 'pulsar', vendorId: 0x3710, productId: 0x3414 } },
    { mouse: { backend: 'pulsar', vendorId: 0x3710, productId: 0x3524 } },
    { mouse: { backend: 'pulsar', vendorId: 0x3710, productId: 0x9999 } },
    { monitorReady: false }, { connectionToken: null },
  ];
  for (const change of states) {
    const { policy, state, time } = fixture();
    const input = { ...state, ...change };
    policy.markVerified(policy.decide(input).signature);
    time(20000);
    assert.equal(policy.decide(input).pause, false);
  }
});

test('failed checks, disconnects and explicit reset cannot reuse previously verified settings', () => {
  const { policy, state, time } = fixture();
  policy.markVerified(policy.decide(state).signature);
  time(2000);
  policy.decide(state); // Attempt failed: do not mark it verified.
  time(20000);
  assert.equal(policy.decide(state).pause, false);
  policy.markVerified(policy.decide(state).signature);
  assert.equal(policy.decide(state).pause, true);
  assert.equal(policy.decide({ ...state, connectionToken: null }).resumed, true);
  assert.equal(policy.decide(state).pause, false);
  policy.markVerified(policy.decide(state).signature);
  policy.reset();
  assert.equal(policy.decide(state).pause, false);
});
