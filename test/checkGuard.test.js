const test = require('node:test');
const assert = require('node:assert/strict');

const { createCheckGuard, requestLatestCheck } = require('../src/lib/checkGuard');

function nextImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('polling check lock prevents overlapping checks', async () => {
  const guard = createCheckGuard();
  let release;
  const first = guard.run(async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
    return 'done';
  });

  const second = await guard.run(async () => 'overlap');
  assert.deepEqual(second, { skipped: true });

  release();
  assert.deepEqual(await first, { skipped: false, result: 'done' });
  assert.equal(guard.isRunning(), false);
});

test('activity can request an immediate rerun of the latest polling check', async () => {
  const guard = createCheckGuard();
  let calls = 0;

  await guard.run(async () => {
    calls += 1;
  });
  assert.equal(calls, 1);

  assert.equal(requestLatestCheck(), true);
  await nextImmediate();
  await nextImmediate();

  assert.equal(calls, 2);
});

test('activity during a running check queues exactly one follow-up check', async () => {
  const guard = createCheckGuard();
  let calls = 0;
  let release;

  const first = guard.run(async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => {
        release = resolve;
      });
    }
  });

  assert.equal(guard.requestRerun(), true);
  assert.equal(guard.requestRerun(), true);
  assert.equal(calls, 1);

  release();
  await first;
  await nextImmediate();
  await nextImmediate();

  assert.equal(calls, 2);
});
