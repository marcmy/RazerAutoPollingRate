const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const ciPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
const scoopBridgePath = path.join(__dirname, '..', '.github', 'workflows', 'scoop-excavator.yml');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main exposes the rolling display version and user-driven update command', () => {
  const main = source(mainPath);
  assert.match(main, /getDisplayVersion\(packageMetadata, app\.getVersion\(\)\)/);
  assert.match(main, /appVersion:\s*appDisplayVersion/);
  assert.match(main, /Check for Updates/);
  assert.match(main, /handleCheckForUpdates/);
  assert.match(main, /scheduleUpdateChecks\(\)/);
  assert.match(main, /while \(Get-Process -Id \$parentId -ErrorAction SilentlyContinue\)/);
  assert.match(main, /async function notifyUpdateAvailable\(release, canProceed\)/);
  assert.match(main, /if \(!canProceed\(\)\) \{[\s\S]{0,120}return false;/);
  assert.match(main, /result\.response !== 0[\s\S]{0,220}!canProceed\(\)[\s\S]{0,220}downloadAndInstallUpdate\(release\)/);
});

test('runtime transitions give the updater a chance to notify only after game detection updates', () => {
  const main = source(mainPath);
  assert.match(
    main,
    /updateRuntimeSelection\(selected, foregroundProcess, requestedTarget\);[\s\S]{0,300}updateCoordinator\.runtimeChanged\(\)/,
  );
});

test('rolling CI stamps the packaged app and names Scoop and Setup artifacts with one CalVer', () => {
  const ci = source(ciPath);
  assert.match(ci, /cancel-in-progress:\s*false/);
  assert.match(ci, /rolling_version:\s*\$\{\{ steps\.rolling\.outputs\.rolling_version \}\}/);
  assert.match(ci, /git show -s --format=%cI \$env:GITHUB_SHA/);
  assert.match(ci, /git\/matching-refs\/tags/);
  assert.match(ci, /AddMinutes\(1\)/);
  assert.match(ci, /node scripts\/stamp-rolling-build\.js/);
  assert.match(ci, /RazerAutoPollingRate-Scoop-main-\$\{\{ steps\.rolling\.outputs\.rolling_version \}\}-\$\{\{ github\.sha \}\}/);
  assert.match(ci, /RazerAutoPollingRate-\$env:ROLLING_VERSION\.Setup\.exe/);
});

test('Scoop bridge recognizes the versioned rolling artifact name', () => {
  const bridge = source(scoopBridgePath);
  assert.match(bridge, /RazerAutoPollingRate-Scoop-main-\\d\{8\}\\\.\\d\{4\}/);
});
