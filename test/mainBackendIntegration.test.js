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
