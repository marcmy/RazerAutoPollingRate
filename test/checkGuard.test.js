const test = require('node:test');
const assert = require('node:assert/strict');

const { createCheckGuard } = require('../src/lib/checkGuard');

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
