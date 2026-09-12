const assert = require('node:assert/strict');
const test = require('node:test');

const { acquireSingleInstanceLock } = require('../src/lib/singleInstance');

test('acquireSingleInstanceLock keeps the first app instance running', () => {
  let requests = 0;
  let quits = 0;
  const app = {
    requestSingleInstanceLock() {
      requests += 1;
      return true;
    },
    quit() {
      quits += 1;
    },
  };

  assert.equal(acquireSingleInstanceLock(app), true);
  assert.equal(requests, 1);
  assert.equal(quits, 0);
});

test('acquireSingleInstanceLock quits a second app instance', () => {
  let requests = 0;
  let quits = 0;
  const app = {
    requestSingleInstanceLock() {
      requests += 1;
      return false;
    },
    quit() {
      quits += 1;
    },
  };

  assert.equal(acquireSingleInstanceLock(app), false);
  assert.equal(requests, 1);
  assert.equal(quits, 1);
});
