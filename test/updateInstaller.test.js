const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSquirrelInstallScript } = require('../src/lib/updateInstaller');

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
