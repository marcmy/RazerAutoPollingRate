const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const bootstrapPath = path.join(__dirname, '..', 'src', 'bootstrap.js');
const probeScriptPath = path.join(__dirname, '..', 'scripts', 'probe-crazylight.js');
const writeValidationScriptPath = path.join(__dirname, '..', 'scripts', 'validate-crazylight-write.js');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main delegates mouse transport lifecycle to the preferred backend', () => {
  const main = source(mainPath);

  assert.match(main, /createPreferredMouseBackend/);
  assert.match(main, /backend\.discover\(\)/);
  assert.match(main, /backend\.open\(\)/);
  assert.match(main, /backend\.getPollingRate\(\)/);
  assert.match(main, /backend\.setPollingRate\(targetRate\)/);
  assert.match(main, /backend\.close\(\)/);

  assert.doesNotMatch(main, /new WebUSB\s*\(/);
  assert.doesNotMatch(main, /async function getDongle\s*\(/);
  assert.doesNotMatch(main, /getRazerReport\s*\(/);
});

test('main initializes electron-store v11 before consuming saved settings', () => {
  const main = source(mainPath);
  assert.doesNotMatch(main, /require\(['"]electron-store['"]\)/);
  assert.match(main, /app\.whenReady\(\)\.then\(async\s*\(\)\s*=>\s*\{[\s\S]*?legacyStore\s*=\s*await loadLegacyStore\(\);[\s\S]*?loadConfig\(/);
  assert.match(main, /Unable to initialize persisted settings/);
});

test('bootstrap no longer launches an independent CrazyLight startup probe', () => {
  const bootstrap = source(bootstrapPath);

  assert.doesNotMatch(bootstrap, /runCrazyLightProbe/);
  assert.doesNotMatch(bootstrap, /pulsar-probe\.log/);
  assert.match(bootstrap, /require\(['"]\.\/main['"]\)/);
});

test('CrazyLight one-shot scripts close the persistent Windows HID bridge before exit', () => {
  const probe = source(probeScriptPath);
  const writeValidation = source(writeValidationScriptPath);

  assert.match(probe, /closeAllWindowsHidOutputBridges/);
  assert.match(probe, /finally\s*\{[\s\S]*await closeAllWindowsHidOutputBridges\(\)/);
  assert.match(writeValidation, /closeAllWindowsHidOutputBridges/);
  assert.match(writeValidation, /finally\s*\{[\s\S]*await closeAllWindowsHidOutputBridges\(\)/);
});

test('main closes persistent Windows HID bridges before quitting', () => {
  const main = source(mainPath);

  assert.match(main, /closeAllWindowsHidOutputBridges/);
  assert.match(main, /async function quit\(\)[\s\S]*await closeAllWindowsHidOutputBridges\(\)[\s\S]*app\.quit\(\)/);
});

test('error.log rotates at its size cap instead of growing without bound', () => {
  const vm = require('node:vm');
  const os = require('node:os');
  const main = source(mainPath);
  const start = main.indexOf('const ERROR_LOG_MAX_BYTES');
  const end = main.indexOf('function getConfigDirectory');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-log-'));
  try {
    const context = vm.createContext({ fs, path, app: { getPath: () => userData } });
    vm.runInContext(`${main.slice(start, end)}\nthis.log = log; this.max = ERROR_LOG_MAX_BYTES;`, context);
    const logPath = path.join(userData, 'error.log');
    fs.writeFileSync(logPath, 'x'.repeat(context.max));
    context.log('after cap', true);
    assert.match(fs.readFileSync(logPath, 'utf8'), /^\[ .+ \] ERROR: after cap\n$/);
    assert.equal(fs.statSync(`${logPath}.old`).size, context.max);
    context.log('below cap');
    assert.equal(fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length, 2);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('overlapping polling checks are diagnostic events, not error.log writes', () => {
  const main = source(mainPath);
  const guarded = main.slice(main.indexOf('async function guardedCheckPollingRate'));
  assert.doesNotMatch(guarded.slice(0, guarded.indexOf('\n}\n')), /\blog\(/);
});
