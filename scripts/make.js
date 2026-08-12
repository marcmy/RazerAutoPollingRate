const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function downloadWithRetries(url, destination) {
  const partial = `${destination}.partial`;
  try {
    fs.rmSync(partial, { force: true });
    run('curl.exe', [
      '--fail',
      '--location',
      '--retry', '5',
      '--retry-all-errors',
      '--retry-delay', '2',
      '--connect-timeout', '30',
      '--output', partial,
      url,
    ]);
    fs.renameSync(partial, destination);
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

function prepareElectronZip() {
  if (process.platform !== 'win32' || !process.env.CI) {
    return null;
  }

  const electronVersion = require('electron/package.json').version;
  const fileName = `electron-v${electronVersion}-win32-x64.zip`;
  const cacheDir = path.join(os.tmpdir(), 'razer-auto-polling-rate', 'electron', electronVersion);
  const zipPath = path.join(cacheDir, fileName);
  const checksumsPath = path.join(cacheDir, 'SHASUMS256.txt');
  const releaseBase = `https://github.com/electron/electron/releases/download/v${electronVersion}`;

  fs.mkdirSync(cacheDir, { recursive: true });

  // Refresh the checksum list every run. Reuse the much larger ZIP only when its
  // published digest still matches.
  downloadWithRetries(`${releaseBase}/SHASUMS256.txt`, checksumsPath);
  const checksumLine = fs.readFileSync(checksumsPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(fileName));

  if (!checksumLine) {
    throw new Error(`Could not find ${fileName} in Electron SHASUMS256.txt`);
  }

  const expected = checksumLine.trim().split(/\s+/)[0].toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Invalid SHA256 entry for ${fileName}`);
  }

  let validCachedZip = false;
  if (fs.existsSync(zipPath)) {
    validCachedZip = sha256(zipPath) === expected;
    if (!validCachedZip) {
      fs.rmSync(zipPath, { force: true });
    }
  }

  if (!validCachedZip) {
    console.log(`Downloading Electron ${electronVersion} packaging ZIP...`);
    downloadWithRetries(`${releaseBase}/${fileName}`, zipPath);
  }

  const actual = sha256(zipPath);
  if (actual !== expected) {
    fs.rmSync(zipPath, { force: true });
    throw new Error(`SHA256 mismatch for ${fileName}: expected ${expected}, got ${actual}`);
  }

  console.log(`Verified ${fileName} (${actual})`);
  return cacheDir;
}

function runForgeMake(extraEnv = {}) {
  const forgePackagePath = require.resolve('@electron-forge/cli/package.json');
  const forgePackage = require(forgePackagePath);
  const forgeBinRelative = typeof forgePackage.bin === 'string'
    ? forgePackage.bin
    : forgePackage.bin['electron-forge'];

  if (!forgeBinRelative) {
    throw new Error('Could not locate the Electron Forge CLI entry point');
  }

  const forgeBin = path.resolve(path.dirname(forgePackagePath), forgeBinRelative);
  run(process.execPath, [forgeBin, 'make'], {
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

try {
  const electronZipDir = prepareElectronZip();
  runForgeMake(electronZipDir ? { ELECTRON_ZIP_DIR: electronZipDir } : {});
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
