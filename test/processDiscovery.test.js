const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const {
  FOREGROUND_MISS_GRACE_MS,
  getLatestForegroundProcess,
  getForegroundProcessSnapshot,
  getForegroundWatcherCommand,
  getRunningProcesses,
  getWindowsProcessHelpersCommand,
  handleForegroundWatcherLine,
  parseForegroundProcessOutput,
  resetForegroundProcessCache,
} = require('../src/lib/processDiscovery');

test('Windows native lookup recovers a path when CIM exposes only the name and handles missing processes', {
  skip: process.platform !== 'win32',
}, () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', `
${getWindowsProcessHelpersCommand()}
$ErrorActionPreference = 'Stop'
function Get-CimInstance { [pscustomobject]@{ Name = 'HiddenGame.exe'; ExecutablePath = $null } }
Get-ProcessJsonById $PID
Get-ProcessJsonById ([uint32]::MaxValue)
function Get-CimInstance { [pscustomobject]@{ Name = 'KnownGame.exe'; ExecutablePath = 'D:\\Games\\KnownGame.exe' } }
Get-ProcessJsonById ([uint32]::MaxValue)
`], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const [recovered, missing, known] = output.trim().split(/\r?\n/).map(parseForegroundProcessOutput);
  assert.equal(recovered.processName, 'HiddenGame.exe');
  assert.match(recovered.executablePath, /^[a-z]:\\.*\\powershell\.exe$/i);
  assert.deepEqual(missing, { processName: 'HiddenGame.exe', executablePath: null });
  assert.deepEqual(known, { processName: 'KnownGame.exe', executablePath: 'D:\\Games\\KnownGame.exe' });
});

test('running-process lookup uses the same native fallback and preserves name-only tasklist recovery', {
  skip: process.platform !== 'win32',
}, () => {
  const running = getRunningProcesses((command, args, options) => {
    // Simulate a game whose CIM image path is hidden, using this PowerShell process as the native query target.
    const script = `function Get-CimInstance { [pscustomobject]@{ Name = 'HiddenGame.exe'; ProcessId = $PID; ExecutablePath = $null } }\n${args[4]}`;
    return execFileSync(command, [...args.slice(0, 4), script], { ...options, timeout: 30000 });
  });
  assert.equal(running.length, 1);
  assert.match(running[0].executablePath, /^[a-z]:\\.*\\powershell\.exe$/i);
  assert.equal(running[0].processName, 'HiddenGame.exe');

  const nameOnly = getRunningProcesses((command) => {
    if (command === 'powershell.exe') throw new Error('CIM unavailable');
    return '"HiddenGame.exe","123","Console","1","1024 K"';
  });
  assert.deepEqual(nameOnly, [{ processName: 'hiddengame.exe', executablePath: null }]);
});

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
