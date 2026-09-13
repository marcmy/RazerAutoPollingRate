const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const bootstrapPath = path.join(__dirname, '..', 'src', 'bootstrap.js');

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
