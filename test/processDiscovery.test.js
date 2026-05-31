const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FOREGROUND_MISS_GRACE_MS,
  getLatestForegroundProcess,
  getForegroundProcessSnapshot,
  getForegroundWatcherCommand,
  handleForegroundWatcherLine,
  parseForegroundProcessOutput,
  resetForegroundProcessCache,
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
  const command = getForegroundWatcherCommand();

  assert.match(command, /while \(\$true\)/);
  assert.match(command, /Start-Sleep -Milliseconds 1000/);
  assert.match(command, /tasklist \/FI "PID eq \$processId"/);
});

test('foreground watcher caches process details by foreground pid', () => {
  const command = getForegroundWatcherCommand();

  assert.match(command, /\$lastProcessId = -1/);
  assert.match(command, /\$processId -ne \$lastProcessId/);
  assert.match(command, /Get-ProcessJsonById \$processId/);
});

test('foreground cache keeps last process during brief lookup miss', () => {
  resetForegroundProcessCache();
  handleForegroundWatcherLine('{"Name":"Game.exe","ExecutablePath":null}', 1000);
  handleForegroundWatcherLine('{}', 2000);

  assert.deepEqual(getLatestForegroundProcess(2000 + FOREGROUND_MISS_GRACE_MS - 1), {
    processName: 'Game.exe',
    executablePath: null,
  });

  resetForegroundProcessCache();
});

test('foreground cache clears stale process after lookup miss grace', () => {
  resetForegroundProcessCache();
  handleForegroundWatcherLine('{"Name":"Game.exe","ExecutablePath":null}', 1000);
  handleForegroundWatcherLine('{}', 2000);

  assert.equal(getLatestForegroundProcess(2000 + FOREGROUND_MISS_GRACE_MS), null);

  resetForegroundProcessCache();
});

test('foreground cache replaces missed process when a new process is found', () => {
  resetForegroundProcessCache();
  handleForegroundWatcherLine('{"Name":"Game.exe","ExecutablePath":null}', 1000);
  handleForegroundWatcherLine('{}', 2000);
  handleForegroundWatcherLine('{"Name":"Notepad.exe","ExecutablePath":null}', 2500);

  assert.deepEqual(getLatestForegroundProcess(2500), {
    processName: 'Notepad.exe',
    executablePath: null,
  });

  resetForegroundProcessCache();
});
