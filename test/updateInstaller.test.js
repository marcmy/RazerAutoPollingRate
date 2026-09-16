const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildInPlaceInstallScript,
  buildSquirrelInstallScript,
  isSquirrelInstall,
  validateStagedAppPackage,
} = require('../src/lib/updateInstaller');

test('installer handoff waits for the app, installs silently, then relaunches through Squirrel', () => {
  const script = buildSquirrelInstallScript({
    parentPid: 1234,
    installerPath: "C:\\Temp\\RazerAutoPollingRate-20260915.1830.Setup.exe",
    localAppData: 'C:\\Users\\marcm\\AppData\\Local',
    packageName: 'razerautopollingrate',
    executableName: 'razerautopollingrate.exe',
  });

  assert.match(script, /Get-Process -Id \$parentId/);
  assert.match(script, /-ArgumentList '--silent' -Wait -PassThru/);
  assert.match(script, /ExitCode -ne 0/);
  assert.match(script, /razerautopollingrate\\Update\.exe/);
  assert.match(script, /--processStart/);
  assert.match(script, /razerautopollingrate\.exe/);
});
test('Squirrel install detection requires an app-version directory with a parent Update.exe', () => {
  const squirrelExe = 'C:\\Users\\marcm\\AppData\\Local\\razerautopollingrate\\app-2026.916.17\\razerautopollingrate.exe';
  const portableExe = 'C:\\Users\\marcm\\scoop\\fixed\\razerautopollingrate\\razerautopollingrate.exe';
  const exists = (candidate) => candidate.endsWith('\\Update.exe');

  assert.equal(isSquirrelInstall(squirrelExe, exists), true);
  assert.equal(isSquirrelInstall(portableExe, exists), false);
});

test('in-place updater waits for exit, replaces the current app payload, and relaunches the same executable', () => {
  const script = buildInPlaceInstallScript({
    parentPid: 1234,
    stagedAppDirectory: 'C:\\Temp\\RAPR\\stage\\lib\\net45',
    installDirectory: 'C:\\Users\\marcm\\scoop\\fixed\\razerautopollingrate',
    executablePath: 'C:\\Users\\marcm\\scoop\\fixed\\razerautopollingrate\\razerautopollingrate.exe',
    logPath: 'C:\\Temp\\RAPR\\updater.log',
  });

  assert.match(script, /Get-Process -Id \$parentId/);
  assert.match(script, /stagedAppDirectory/);
  assert.match(script, /installDirectory/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /Start-Process -FilePath \$executablePath/);
  assert.doesNotMatch(script, /--processStart|Update\.exe/);
});
test('staged in-place package must match the target CalVer and contain the executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-stage-test-'));
  const staged = path.join(root, 'lib', 'net45');
  fs.mkdirSync(path.join(staged, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'razerautopollingrate.exe'), 'fake');
  fs.writeFileSync(
    path.join(staged, 'resources', 'app', 'package.json'),
    JSON.stringify({ buildDisplayVersion: '20260916.0017' }),
  );

  assert.doesNotThrow(() => validateStagedAppPackage(staged, '20260916.0017', 'razerautopollingrate.exe'));
  assert.throws(
    () => validateStagedAppPackage(staged, '20260916.0018', 'razerautopollingrate.exe'),
    /version/i,
  );

  fs.rmSync(root, { recursive: true, force: true });
});
