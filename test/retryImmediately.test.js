const test = require('node:test');
const assert = require('node:assert/strict');

const { retryImmediately } = require('../src/lib/retryImmediately');

test('returns immediately when the first attempt succeeds', async () => {
  let calls = 0;
  const result = await retryImmediately(async () => {
    calls += 1;
    return 8000;
  });

  assert.equal(result, 8000);
  assert.equal(calls, 1);
});

test('retries immediately until an attempt succeeds', async () => {
  const failures = [];
  let calls = 0;
  const result = await retryImmediately(async () => {
    calls += 1;
    if (calls < 3) {
      throw new Error(`transient ${calls}`);
    }
    return 4000;
  }, {
    attempts: 3,
    onFailure: (error, attempt, attempts) => {
      failures.push({ message: error.message, attempt, attempts });
    },
  });

  assert.equal(result, 4000);
  assert.equal(calls, 3);
  assert.deepEqual(failures, [
    { message: 'transient 1', attempt: 1, attempts: 3 },
    { message: 'transient 2', attempt: 2, attempts: 3 },
  ]);
});

test('throws the final error after every attempt fails', async () => {
  let calls = 0;
  await assert.rejects(
    retryImmediately(async () => {
      calls += 1;
      throw new Error(`failure ${calls}`);
    }, { attempts: 3 }),
    /failure 3/,
  );
  assert.equal(calls, 3);
});
