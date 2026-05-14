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

test('foreground process command output can match by process name without path', () => {
  const foregroundProcess = getForegroundProcess(() => '{"Name":"ElevatedGame.exe"}');

  assert.deepEqual(foregroundProcess, {
    processName: 'ElevatedGame.exe',
    executablePath: null,
  });
});
