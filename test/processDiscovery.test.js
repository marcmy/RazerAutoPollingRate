const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getForegroundProcessSnapshot,
  getForegroundWatcherCommand,
  parseForegroundProcessOutput,
} = require('../src/lib/processDiscovery');

test('foreground process lookup failure returns null', () => {
  const foregroundProcess = getForegroundProcessSnapshot(() => {
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
  const foregroundProcess = getForegroundProcessSnapshot(() => '{"Name":"ElevatedGame.exe"}');

  assert.deepEqual(foregroundProcess, {
    processName: 'ElevatedGame.exe',
    executablePath: null,
  });
});

test('foreground process lookup includes tasklist fallback by pid', () => {
  const foregroundProcess = getForegroundProcessSnapshot((_command, args) => {
    const script = args[4];
    assert.match(script, /tasklist \/FI "PID eq \$processId"/);
    assert.match(script, /ConvertFrom-Csv/);
    return '{"Name":"ElevatedGame.exe","ExecutablePath":null}';
  });

  assert.equal(foregroundProcess.processName, 'ElevatedGame.exe');
  assert.equal(foregroundProcess.executablePath, null);
});

test('foreground watcher uses one persistent polling command', () => {
  const command = getForegroundWatcherCommand(500);

  assert.match(command, /while \(\$true\)/);
  assert.match(command, /Start-Sleep -Milliseconds 500/);
  assert.match(command, /tasklist \/FI "PID eq \$processId"/);
});
