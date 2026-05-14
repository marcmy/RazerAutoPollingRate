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

test('foreground process lookup includes tasklist fallback by pid', () => {
  const foregroundProcess = getForegroundProcess((_command, args) => {
    const script = args[4];
    assert.match(script, /tasklist \/FI "PID eq \$processId"/);
    assert.match(script, /ConvertFrom-Csv/);
    return '{"Name":"ElevatedGame.exe","ExecutablePath":null}';
  });

  assert.equal(foregroundProcess.processName, 'ElevatedGame.exe');
  assert.equal(foregroundProcess.executablePath, null);
});
