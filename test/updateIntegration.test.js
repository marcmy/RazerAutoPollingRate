const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const settingsPath = path.join(__dirname, '..', 'src', 'settings.html');
const appUpdatesPath = path.join(__dirname, '..', 'src', 'lib', 'appUpdates.js');
const updateInstallerPath = path.join(__dirname, '..', 'src', 'lib', 'updateInstaller.js');
const updatePromptPath = path.join(__dirname, '..', 'src', 'updatePrompt.html');
const updatePromptPreloadPath = path.join(__dirname, '..', 'src', 'updatePromptPreload.js');
const updateChangelogPath = path.join(__dirname, '..', 'src', 'updateChangelog.html');
const updateChangelogPreloadPath = path.join(__dirname, '..', 'src', 'updateChangelogPreload.js');
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
  assert.match(main, /async function notifyUpdateAvailable\(release, canProceed\)/);
  assert.match(main, /if \(!canProceed\(\)\) \{[\s\S]{0,120}return false;/);
  assert.match(main, /result\.response !== 0[\s\S]{0,220}!canProceed\(\)[\s\S]{0,220}downloadAndInstallUpdate\(release\)/);
});

test('runtime updater is self-contained and hands the verified installer to Squirrel', () => {
  const runtime = `${source(mainPath)}\n${source(appUpdatesPath)}`;
  const settings = source(settingsPath);
  const installer = source(updateInstallerPath);
  const prompt = source(updatePromptPath);

  assert.doesNotMatch(runtime, /\bscoop\b/i);
  assert.match(prompt, /Download &amp; Install/);
  assert.match(runtime, /updates\.pendingChangelog/);
  assert.match(runtime, /createUpdateProgressWindow/);
  assert.match(runtime, /automaticUpdateChecks/);
  assert.match(settings, /auto-check-updates/);
  assert.match(installer, /--silent/);
  assert.match(installer, /while \(Get-Process -Id \$parentId -ErrorAction SilentlyContinue\)/);
  assert.match(installer, /--processStart/);
});


test('runtime updater preserves the current install directory outside Squirrel', () => {
  const main = source(mainPath);
  assert.match(main, /isSquirrelInstall\(process\.execPath\)/);
  assert.match(main, /selectFullPackageAsset\(release\)/);
  assert.match(main, /buildInPlaceInstallScript/);
  assert.match(main, /path\.dirname\(process\.execPath\)/);
  assert.match(main, /Expand-Archive/);
  assert.match(main, /validateStagedAppPackage/);
});
test('updater destroys its non-closable progress window before quitting the Electron app', () => {
  const main = source(mainPath);
  const start = main.indexOf('async function launchDetachedUpdate(command, updateDirectory)');
  const end = main.indexOf('async function stageInPlaceUpdatePackage', start);
  assert.ok(start >= 0 && end > start);
  const launch = main.slice(start, end);
  const readyMarker = launch.indexOf('updater.ready');
  const detach = launch.lastIndexOf('child.unref();');
  const closeProgress = launch.indexOf('closeUpdateProgressWindow();');
  const quit = launch.indexOf('app.quit();');
  assert.ok(readyMarker >= 0);
  assert.ok(detach > readyMarker);
  assert.ok(closeProgress > detach);
  assert.ok(quit > closeProgress);
});

test('Windows updater uses a cmd start trampoline instead of detached PowerShell', () => {
  const main = source(mainPath);
  const start = main.indexOf('async function launchDetachedUpdate(command, updateDirectory)');
  const end = main.indexOf('async function stageInPlaceUpdatePackage', start);
  assert.ok(start >= 0 && end > start);
  const launch = main.slice(start, end);

  assert.doesNotMatch(launch, /spawn\('powershell\.exe'[\s\S]{0,800}detached:\s*true/);
  assert.match(launch, /process\.env\.ComSpec\s*\|\|\s*'cmd\.exe'/);
  assert.match(launch, /'start',\s*'',\s*'\/b',\s*'powershell\.exe'/);
  assert.match(launch, /stdio:\s*'ignore'/);
});

test('manual update checks clear the checking state before showing an available-update prompt', () => {
  const main = source(mainPath);
  assert.match(main, /checkForAppUpdates\(\{ manual: true, notify: false \}\)/);
  assert.match(
    main,
    /finally \{[\s\S]{0,260}updateOperation = 'idle';[\s\S]{0,180}updateTrayMenu\(\);[\s\S]{0,900}updateCoordinator\.notifyPending\(\)/,
  );
});

test('available updates use a focused app-owned prompt instead of a parentless native dialog', () => {
  const main = source(mainPath);
  const prompt = source(updatePromptPath);
  const preload = source(updatePromptPreloadPath);
  assert.match(main, /function showUpdatePrompt\(release\)/);
  assert.match(main, /alwaysOnTop:\s*true/);
  assert.match(main, /updatePromptWindow\.moveTop\(\)/);
  assert.match(main, /updatePromptWindow\.focus\(\)/);
  assert.match(main, /const result = await showUpdatePrompt\(release\)/);
  assert.match(main, /ipcMain\.on\('update-prompt-action'/);
  assert.match(prompt, /Download &amp; Install/);
  assert.match(prompt, /window\.updatePrompt\.choose\('install'\)/);
  assert.match(preload, /ipcRenderer\.send\('update-prompt-action', action\)/);
});

test('runtime transitions give the updater a chance to notify only after game detection updates', () => {
  const main = source(mainPath);
  assert.match(
    main,
    /updateRuntimeSelection\(selected, foregroundProcess, requestedTarget\);[\s\S]{0,300}updateCoordinator\.runtimeChanged\(\)/,
  );
});

test('post-update changelog shows five recent releases and opens the full changelog through main process IPC', () => {
  const main = source(mainPath);
  const changelog = source(updateChangelogPath);
  const preload = source(updateChangelogPreloadPath);

  assert.match(main, /releases\?per_page=5/);
  assert.match(main, /buildRecentChangelogEntries/);
  assert.match(main, /preload:\s*path\.join\(__dirname, 'updateChangelogPreload\.js'\)/);
  assert.match(main, /ipcMain\.on\('update-changelog-open-full'/);
  assert.match(main, /shell\.openExternal\(FULL_CHANGELOG_URL\)/);
  assert.match(changelog, /id="releases"/);
  assert.match(changelog, /View full changelog/);
  assert.match(changelog, /window\.updateChangelog\.openFullChangelog\(\)/);
  assert.match(preload, /ipcRenderer\.send\('update-changelog-open-full'\)/);
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
  assert.doesNotMatch(ci, /"Scoop version: \$env:ROLLING_VERSION"/);
});

test('Scoop bridge recognizes the versioned rolling artifact name', () => {
  const bridge = source(scoopBridgePath);
  assert.match(bridge, /RazerAutoPollingRate-Scoop-main-\\d\{8\}\\\.\\d\{4\}/);
});
