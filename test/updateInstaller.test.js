const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildInPlaceInstallScript,
  buildSquirrelInstallScript,
  isSquirrelInstall,
  stageUpdatePackage,
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
test('Squirrel install detection distinguishes normal installer, Scoop, and standalone layouts', () => {
  const squirrelExe = 'C:\\Users\\marcm\\AppData\\Local\\razerautopollingrate\\app-2026.916.17\\razerautopollingrate.exe';
  const scoopExe = 'C:\\Users\\marcm\\scoop\\fixed\\razerautopollingrate\\razerautopollingrate.exe';
  const portableExe = 'D:\\Apps\\RazerAutoPollingRate\\razerautopollingrate.exe';
  const standaloneLocalExe = 'C:\\Users\\marcm\\AppData\\Local\\Programs\\RazerAutoPollingRate\\razerautopollingrate.exe';
  const exists = (candidate) => candidate.endsWith('\\Update.exe');

  assert.equal(isSquirrelInstall(squirrelExe, exists), true);
  assert.equal(isSquirrelInstall(scoopExe, exists), false);
  assert.equal(isSquirrelInstall(portableExe, exists), false);
  assert.equal(isSquirrelInstall(standaloneLocalExe, exists), false);
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

function stageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr extraction test '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagePath = path.join(root, 'update package.nupkg');
  fs.writeFileSync(packagePath, 'fixture');
  return {
    packagePath,
    updateDirectory: root,
    expectedVersion: '20261123.2359',
    executableName: 'razerautopollingrate.exe',
    tarExecutable: 'test-tar.exe',
  };
}

test('staging calls native tar directly on the package and validates the extracted payload', async (t) => {
  const options = stageFixture(t);
  const result = await stageUpdatePackage({
    ...options,
    execFileImpl: (file, args, config, callback) => {
      assert.equal(file, 'test-tar.exe');
      assert.deepEqual(args, ['-xf', options.packagePath, '-C', path.join(options.updateDirectory, 'stage')]);
      assert.equal(config.windowsHide, true);
      const app = path.join(args[3], 'lib', 'net45');
      fs.mkdirSync(path.join(app, 'resources', 'app'), { recursive: true });
      fs.writeFileSync(path.join(app, options.executableName), 'fixture');
      fs.writeFileSync(path.join(app, 'resources', 'app', 'package.json'), JSON.stringify({
        buildDisplayVersion: options.expectedVersion,
      }));
      callback(null, '', '');
    },
  });
  assert.equal(result, path.join(options.updateDirectory, 'stage', 'lib', 'net45'));
  assert.equal(fs.existsSync(path.join(options.updateDirectory, 'package.zip')), false);
  const log = fs.readFileSync(path.join(options.updateDirectory, 'updater-extraction.log'), 'utf8');
  assert.match(log, /Extraction exit code: 0/);
  assert.match(log, /Validated application payload/);
});

test('staging reports extractor exit code and stderr, even if nothing was extracted', async (t) => {
  const options = stageFixture(t);
  await assert.rejects(stageUpdatePackage({
    ...options,
    execFileImpl: (_file, _args, _config, callback) => {
      callback(Object.assign(new Error('tar failed'), { code: 2 }), '', 'archive read error');
    },
  }), /code 2.*archive read error/);
  const log = fs.readFileSync(path.join(options.updateDirectory, 'updater-extraction.log'), 'utf8');
  assert.match(log, /Extraction exit code: 2/);
  assert.match(log, /stderr: archive read error/);
});

test('staging rejects empty extraction even when the extractor exits successfully', async (t) => {
  const options = stageFixture(t);
  await assert.rejects(stageUpdatePackage({
    ...options,
    execFileImpl: (_file, _args, _config, callback) => callback(null, '', ''),
  }), /missing its packaged application metadata/);
  const log = fs.readFileSync(path.join(options.updateDirectory, 'updater-extraction.log'), 'utf8');
  assert.match(log, /Extraction exit code: 0/);
  assert.match(log, /Staging failed/);
});

test('staging preserves strict rolling version validation when only a package version exists', async (t) => {
  const options = stageFixture(t);
  const execFileImpl = (_file, args, _config, callback) => {
    const app = path.join(args[3], 'lib', 'net45');
    fs.mkdirSync(path.join(app, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(app, options.executableName), 'fixture');
    fs.writeFileSync(path.join(app, 'resources', 'app', 'package.json'), JSON.stringify({ version: '1.3.6' }));
    callback(null, '', '');
  };
  await assert.rejects(stageUpdatePackage({ ...options, execFileImpl }), /version unknown/);
  await assert.doesNotReject(stageUpdatePackage({
    ...options, execFileImpl, expectedVersion: '1.3.6', versionField: 'version',
  }));
});
