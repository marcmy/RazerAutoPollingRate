const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProcessConfig } = require('../src/lib/config');
const {
  findFirstMatchingProcess,
  parseTasklistCsv,
  selectConfiguredPollingRate,
  selectForegroundPollingRate,
  selectTargetPollingRate,
} = require('../src/lib/processes');

test('duplicate process entries behave deterministically with first match winning', () => {
  const { entries } = parseProcessConfig('r5apex.exe 4000\nr5apex.exe 1000');
  const match = findFirstMatchingProcess(entries, ['r5apex.exe']);
  assert.equal(match.pollingRate, 4000);
});

test('first running configured process wins based on config order', () => {
  const { entries } = parseProcessConfig('quake_live_x64.exe 1000\nr5apex.exe 4000');
  const selected = selectTargetPollingRate(entries, ['r5apex.exe', 'quake_live_x64.exe'], 500);
  assert.equal(selected.targetRate, 1000);
  assert.equal(selected.matchedProcess, 'quake_live_x64.exe');
});

test('no running configured process returns inactive polling rate', () => {
  const { entries } = parseProcessConfig('r5apex.exe 4000');
  const selected = selectTargetPollingRate(entries, ['notepad.exe'], 500);
  assert.equal(selected.targetRate, 500);
  assert.equal(selected.matchedProcess, null);
});

test('tasklist matching is case-insensitive and exact by executable name', () => {
  const { entries } = parseProcessConfig('r5apex.exe 4000');
  const running = parseTasklistCsv('"R5APEX.EXE","1234","Console","1","1,024 K"\n"not-r5apex.exe","100","Console","1","1,024 K"');

  assert.equal(findFirstMatchingProcess(entries, running).processName, 'r5apex.exe');
  assert.equal(findFirstMatchingProcess(entries, ['not-r5apex.exe']), null);
});

test('full executable path match beats bare process-name match', () => {
  const { entries } = parseProcessConfig([
    'r5apex_dx12.exe 2000',
    '"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe" 4000',
  ].join('\n'));

  const selected = selectTargetPollingRate(entries, [{
    processName: 'r5apex_dx12.exe',
    executablePath: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe',
  }], 500);

  assert.equal(selected.targetRate, 4000);
});

test('foreground mode matches exact full executable path', () => {
  const { entries } = parseProcessConfig([
    'r5apex_dx12.exe 2000',
    '"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe" 4000',
  ].join('\n'));
  const selected = selectForegroundPollingRate(entries, {
    processName: 'r5apex_dx12.exe',
    executablePath: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe',
  }, 500);

  assert.equal(selected.targetRate, 4000);
});

test('foreground path rule falls back to a unique process name when Windows hides the path', () => {
  const { entries } = parseProcessConfig([
    '"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe" 4000',
  ].join('\n'));
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: { processName: 'R5APEX_DX12.EXE', executablePath: null },
    runningProcesses: [],
    defaultDetectionMode: 'foreground',
    inactivePollingRate: 125,
    defaultGamePollingRate: 1000,
  });

  assert.equal(selected.targetRate, 4000);
  assert.equal(selected.matchedDetectionMode, 'foreground');
  assert.equal(selected.matchedProcess, 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe');
});

test('foreground path-name fallback refuses ambiguous configured paths', () => {
  const { entries } = parseProcessConfig([
    '"C:\\Games\\Build A\\game.exe" 2000',
    '"D:\\Games\\Build B\\game.exe" 4000',
  ].join('\n'));
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: { processName: 'game.exe', executablePath: null },
    runningProcesses: [],
    defaultDetectionMode: 'foreground',
    inactivePollingRate: 125,
    defaultGamePollingRate: 1000,
  });

  assert.equal(selected.targetRate, 125);
  assert.equal(selected.matchedProcess, null);
});

test('per-game running mode overrides the global foreground default', () => {
  const { entries } = parseProcessConfig('admin-game.exe 4000 running');
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: { processName: 'notepad.exe', executablePath: 'C:\\Windows\\notepad.exe' },
    runningProcesses: [{ processName: 'admin-game.exe', executablePath: null }],
    defaultDetectionMode: 'foreground',
    inactivePollingRate: 500,
    defaultGamePollingRate: 1000,
  });

  assert.equal(selected.targetRate, 4000);
  assert.equal(selected.matchedDetectionMode, 'running');
  assert.equal(selected.matchedProcess, 'admin-game.exe');
});

test('per-game foreground mode overrides the global running default', () => {
  const { entries } = parseProcessConfig('game.exe 2000 foreground');
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: { processName: 'game.exe', executablePath: 'D:\\Games\\game.exe' },
    runningProcesses: [{ processName: 'other.exe', executablePath: 'D:\\Games\\other.exe' }],
    defaultDetectionMode: 'running',
    inactivePollingRate: 500,
    defaultGamePollingRate: 1000,
  });

  assert.equal(selected.targetRate, 2000);
  assert.equal(selected.matchedDetectionMode, 'foreground');
});

test('path rule in running mode falls back to process name when Windows hides the path', () => {
  const { entries } = parseProcessConfig('"D:\\Games\\Admin Game\\admin-game.exe" 4000 running');
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: null,
    runningProcesses: [{ processName: 'ADMIN-GAME.EXE', executablePath: null }],
    defaultDetectionMode: 'foreground',
    inactivePollingRate: 500,
    defaultGamePollingRate: 1000,
  });

  assert.equal(selected.targetRate, 4000);
});

test('game override can inherit the current default game polling rate', () => {
  const { entries } = parseProcessConfig('game.exe default running');
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: null,
    runningProcesses: [{ processName: 'game.exe', executablePath: null }],
    defaultDetectionMode: 'foreground',
    inactivePollingRate: 500,
    defaultGamePollingRate: 8000,
  });

  assert.equal(selected.targetRate, 8000);
});