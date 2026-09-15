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

test('in-app release notes remove package-manager-specific sections and formatting noise', () => {
  assert.equal(typeof appUpdates.releaseNotesToPlainText, 'function');
  const notes = appUpdates.releaseNotesToPlainText([
    '## Highlights',
    '- **Faster** device detection',
    '',
    '## Scoop',
    '- Manifest refreshed',
    '- scoop update example',
    '',
    '## Fixes',
    '- Fixed `startup` handling',
  ].join('\n'));

  assert.equal(notes.includes('Scoop'), false);
  assert.equal(notes.includes('scoop'), false);
  assert.match(notes, /Highlights/);
  assert.match(notes, /Faster device detection/);
  assert.match(notes, /Fixes/);
  assert.match(notes, /Fixed startup handling/);
  assert.equal(notes.includes('Manifest refreshed'), false);
});

test('post-update changelog is shown only after the target build is actually running', () => {
  assert.equal(typeof appUpdates.shouldShowInstalledChangelog, 'function');
  const pending = { tag_name: '20260915.1830' };
  assert.equal(appUpdates.shouldShowInstalledChangelog(pending, '20260915.1830'), true);
  assert.equal(appUpdates.shouldShowInstalledChangelog(pending, '20260915.1829'), false);
  assert.equal(appUpdates.shouldShowInstalledChangelog(null, '20260915.1830'), false);
});
