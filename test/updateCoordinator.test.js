const test = require('node:test');
const assert = require('node:assert/strict');

let updateCoordinator = {};
try {
  updateCoordinator = require('../src/lib/updateCoordinator');
} catch (_error) {
  // RED: implementation follows these behavior tests.
}

test('automatic check discovers an update during a game without notifying', async () => {
  assert.equal(typeof updateCoordinator.createUpdateCoordinator, 'function');

  let runtime = { source: 'library', matchedProcess: 'r5apex.exe' };
  const notifications = [];
  const persisted = [];
  const coordinator = updateCoordinator.createUpdateCoordinator({
    currentVersion: '20260914.0818',
    getRuntimeStatus: () => runtime,
    getLastCheckedAt: () => 0,
    setLastCheckedAt: () => {},
    fetchLatestRelease: async () => ({
      tag_name: '20260914.0900',
      assets: [{ name: 'RazerAutoPollingRate-20260914.0900.Setup.exe' }],
    }),
    onPendingChange: (release) => persisted.push(release),
    onNotify: async (release) => notifications.push(release.tag_name),
  });

  const result = await coordinator.check({ now: Date.parse('2026-09-14T09:01:00Z') });
  assert.equal(result.status, 'available');
  assert.equal(notifications.length, 0);
  assert.equal(persisted.at(-1).tag_name, '20260914.0900');

  runtime = { source: 'inactive', matchedProcess: null };
  await coordinator.runtimeChanged();
  assert.deepEqual(notifications, ['20260914.0900']);
});

test('automatic check respects the 24 hour cadence while manual check bypasses it', async () => {
  assert.equal(typeof updateCoordinator.createUpdateCoordinator, 'function');
  const now = Date.parse('2026-09-14T12:00:00Z');
  let fetchCount = 0;
  const coordinator = updateCoordinator.createUpdateCoordinator({
    currentVersion: '20260914.0818',
    getRuntimeStatus: () => ({ source: 'inactive' }),
    getLastCheckedAt: () => now - (60 * 60 * 1000),
    setLastCheckedAt: () => {},
    fetchLatestRelease: async () => {
      fetchCount += 1;
      return { tag_name: '20260914.0818', assets: [] };
    },
    onPendingChange: () => {},
    onNotify: async () => {},
  });

  assert.equal((await coordinator.check({ now })).status, 'not-due');
  assert.equal(fetchCount, 0);
  assert.equal((await coordinator.check({ now, manual: true })).status, 'current');
  assert.equal(fetchCount, 1);
});

test('failed automatic checks still count as the daily attempt', async () => {
  assert.equal(typeof updateCoordinator.createUpdateCoordinator, 'function');
  const now = Date.parse('2026-09-14T12:00:00Z');
  let lastCheckedAt = 0;
  const coordinator = updateCoordinator.createUpdateCoordinator({
    currentVersion: '20260914.0818',
    getRuntimeStatus: () => ({ source: 'inactive' }),
    getLastCheckedAt: () => lastCheckedAt,
    setLastCheckedAt: (value) => { lastCheckedAt = value; },
    fetchLatestRelease: async () => { throw new Error('offline'); },
    onPendingChange: () => {},
    onNotify: async () => {},
  });

  await assert.rejects(() => coordinator.check({ now }), /offline/);
  assert.equal(lastCheckedAt, now);
  assert.equal((await coordinator.check({ now: now + 1000 })).status, 'not-due');
});

test('restored pending update notifies after startup only when idle', async () => {
  assert.equal(typeof updateCoordinator.createUpdateCoordinator, 'function');
  let runtime = { source: 'configured', matchedProcess: 'quake_live_x64.exe' };
  const notifications = [];
  const coordinator = updateCoordinator.createUpdateCoordinator({
    currentVersion: '20260914.0818',
    initialPendingRelease: {
      tag_name: '20260914.0900',
      assets: [{ name: 'RazerAutoPollingRate-20260914.0900.Setup.exe' }],
    },
    getRuntimeStatus: () => runtime,
    getLastCheckedAt: () => Date.now(),
    setLastCheckedAt: () => {},
    fetchLatestRelease: async () => { throw new Error('not expected'); },
    onPendingChange: () => {},
    onNotify: async (release) => notifications.push(release.tag_name),
  });

  await coordinator.runtimeChanged();
  assert.deepEqual(notifications, []);
  runtime = { source: 'inactive', matchedProcess: null };
  await coordinator.runtimeChanged();
  assert.deepEqual(notifications, ['20260914.0900']);
});

test('notification can defer itself when a game starts during the prompt', async () => {
  assert.equal(typeof updateCoordinator.createUpdateCoordinator, 'function');
  let runtime = { source: 'inactive', matchedProcess: null };
  let notifications = 0;
  const coordinator = updateCoordinator.createUpdateCoordinator({
    currentVersion: '20260914.0818',
    initialPendingRelease: {
      tag_name: '20260914.0900',
      assets: [{ name: 'RazerAutoPollingRate-20260914.0900.Setup.exe' }],
    },
    getRuntimeStatus: () => runtime,
    getLastCheckedAt: () => Date.now(),
    setLastCheckedAt: () => {},
    fetchLatestRelease: async () => { throw new Error('not expected'); },
    onPendingChange: () => {},
    onNotify: async (_release, canProceed) => {
      notifications += 1;
      runtime = { source: 'library', matchedProcess: 'r5apex.exe' };
      return canProceed() ? true : false;
    },
  });

  assert.equal(await coordinator.runtimeChanged(), false);
  assert.equal(notifications, 1);

  runtime = { source: 'inactive', matchedProcess: null };
  assert.equal(await coordinator.runtimeChanged(), false);
  assert.equal(notifications, 2);
});
