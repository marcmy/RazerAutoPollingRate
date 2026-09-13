const test = require('node:test');
const assert = require('node:assert/strict');

function loadValidator() {
  // Require inside the test so the RED phase is a test failure, not a file-load crash.
  // eslint-disable-next-line global-require
  return require('../src/lib/mouseBackends/pulsarWriteValidation');
}

function createFakeBackend(options = {}) {
  const calls = [];
  const profiles = [...(options.profiles || [1, 1, 1])];
  let setAttempt = 0;

  return {
    calls,
    async discover() {
      calls.push(['discover']);
    },
    async open() {
      calls.push(['open']);
    },
    async getActiveProfile() {
      calls.push(['getActiveProfile']);
      return profiles.length > 1 ? profiles.shift() : profiles[0] || 1;
    },
    async getPollingRate() {
      calls.push(['getPollingRate']);
      return options.originalRate || 8000;
    },
    async setPollingRate(rate) {
      calls.push(['setPollingRate', rate]);
      setAttempt += 1;
      if (setAttempt === 1 && options.failTarget) {
        throw new Error('target write failed after send');
      }
      if (setAttempt > 1 && options.failRestore) {
        throw new Error('restore write failed');
      }
      return rate;
    },
    async close() {
      calls.push(['close']);
    },
  };
}

test('write validator changes rate then restores the original rate and profile', async () => {
  const { validateCrazyLightPollingWrite } = loadValidator();
  const backend = createFakeBackend({ originalRate: 8000, profiles: [1, 1, 1] });

  const result = await validateCrazyLightPollingWrite({ backend });

  assert.equal(result.originalRate, 8000);
  assert.equal(result.targetRate, 1000);
  assert.equal(result.originalProfile, 1);
  assert.deepEqual(
    backend.calls.filter(([name]) => name === 'setPollingRate'),
    [['setPollingRate', 1000], ['setPollingRate', 8000]],
  );
  assert.equal(backend.calls.at(-1)[0], 'close');
});

test('write validator restores the original rate even when target validation throws', async () => {
  const { validateCrazyLightPollingWrite } = loadValidator();
  const backend = createFakeBackend({ originalRate: 8000, failTarget: true });

  await assert.rejects(
    () => validateCrazyLightPollingWrite({ backend }),
    /target write failed after send/i,
  );

  assert.deepEqual(
    backend.calls.filter(([name]) => name === 'setPollingRate'),
    [['setPollingRate', 1000], ['setPollingRate', 8000]],
  );
  assert.equal(backend.calls.at(-1)[0], 'close');
});

test('write validator aborts on profile drift but still restores the original rate', async () => {
  const { validateCrazyLightPollingWrite } = loadValidator();
  const backend = createFakeBackend({ originalRate: 1000, profiles: [1, 2, 1] });

  await assert.rejects(
    () => validateCrazyLightPollingWrite({ backend }),
    /profile.*changed.*1.*2/i,
  );

  assert.deepEqual(
    backend.calls.filter(([name]) => name === 'setPollingRate'),
    [['setPollingRate', 8000], ['setPollingRate', 1000]],
  );
  assert.equal(backend.calls.at(-1)[0], 'close');
});

test('write validator surfaces restoration failure with the original failure context', async () => {
  const { validateCrazyLightPollingWrite } = loadValidator();
  const backend = createFakeBackend({
    originalRate: 8000,
    failTarget: true,
    failRestore: true,
  });

  await assert.rejects(
    () => validateCrazyLightPollingWrite({ backend }),
    /target write failed after send.*restore write failed/is,
  );
  assert.equal(backend.calls.at(-1)[0], 'close');
});
