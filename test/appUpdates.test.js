const test = require('node:test');
const assert = require('node:assert/strict');

let appUpdates = {};
try {
  appUpdates = require('../src/lib/appUpdates');
} catch (_error) {
  // RED: the implementation is introduced after these behavior tests.
}

test('display version prefers rolling build metadata over the package version', () => {
  assert.equal(typeof appUpdates.getDisplayVersion, 'function');
  assert.equal(
    appUpdates.getDisplayVersion({ buildDisplayVersion: '20260914.0818' }, '1.3.6'),
    '20260914.0818',
  );
  assert.equal(appUpdates.getDisplayVersion({}, '1.3.6'), '1.3.6');
});

test('rolling CalVer comparison upgrades legacy SemVer and orders later builds', () => {
  assert.equal(typeof appUpdates.isNewerRollingVersion, 'function');
  assert.equal(appUpdates.isNewerRollingVersion('20260914.0818', '1.3.6'), true);
  assert.equal(appUpdates.isNewerRollingVersion('20260914.0819', '20260914.0818'), true);
  assert.equal(appUpdates.isNewerRollingVersion('20260914.0818', '20260914.0818'), false);
  assert.equal(appUpdates.isNewerRollingVersion('20260913.2359', '20260914.0001'), false);
});

test('automatic update checks are due once every 24 hours', () => {
  assert.equal(typeof appUpdates.shouldCheckForUpdates, 'function');
  const now = Date.parse('2026-09-14T12:00:00Z');
  assert.equal(appUpdates.shouldCheckForUpdates(null, now), true);
  assert.equal(appUpdates.shouldCheckForUpdates(now - (23 * 60 * 60 * 1000), now), false);
  assert.equal(appUpdates.shouldCheckForUpdates(now - (24 * 60 * 60 * 1000), now), true);
});

test('update notification is deferred while a game selection is active', () => {
  assert.equal(typeof appUpdates.isGameActive, 'function');
  assert.equal(appUpdates.isGameActive({ source: 'inactive', matchedProcess: null }), false);
  assert.equal(appUpdates.isGameActive({ source: 'library', matchedProcess: 'r5apex.exe' }), true);
  assert.equal(appUpdates.isGameActive({ source: 'configured', matchedProcess: 'quake_live_x64.exe' }), true);
});

test('rolling release selects the exact CalVer Setup asset', () => {
  assert.equal(typeof appUpdates.selectSetupAsset, 'function');
  const release = {
    tag_name: '20260914.0818',
    assets: [
      { name: 'RELEASES', browser_download_url: 'releases' },
      { name: 'RazerAutoPollingRate-20260914.0818.Setup.exe', browser_download_url: 'setup' },
      { name: 'razerautopollingrate-2026.914.818-full.nupkg', browser_download_url: 'nupkg' },
    ],
  };

  assert.deepEqual(appUpdates.selectSetupAsset(release), release.assets[1]);
});

test('Scoop installations are detected from the executable path', () => {
  assert.equal(typeof appUpdates.isScoopInstallPath, 'function');
  assert.equal(
    appUpdates.isScoopInstallPath('C:\\Users\\marcm\\scoop\\apps\\razerautopollingrate\\current\\razerautopollingrate.exe'),
    true,
  );
  assert.equal(
    appUpdates.isScoopInstallPath('D:\\Apps\\apps\\razerautopollingrate\\current\\razerautopollingrate.exe'),
    true,
  );
  assert.equal(
    appUpdates.isScoopInstallPath('C:\\Users\\marcm\\AppData\\Local\\razerautopollingrate\\app-2026.914.900\\razerautopollingrate.exe'),
    false,
  );
});
