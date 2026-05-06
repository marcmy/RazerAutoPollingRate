const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getForegroundProcess,
  parseForegroundProcessOutput,
} = require('../src/lib/processDiscovery');

test('foreground process lookup failure returns null', () => {
  const foregroundProcess = getForegroundProcess(() => {
    throw new Error('access denied');
  });

  assert.equal(foregroundProcess, null);
});

test('foreground process with missing executable path still returns process name', () => {
  const foregroundProcess = parseForegroundProcessOutput('{"Name":"R5APEX_DX12.exe","ExecutablePath":null}');

  assert.deepEqual(foregroundProcess, {
    processName: 'R5APEX_DX12.exe',
    executablePath: null,
  });
});
