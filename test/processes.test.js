const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProcessConfig } = require('../src/lib/config');
const {
  findFirstMatchingProcess,
  parseTasklistCsv,
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

test('same specificity uses config order priority', () => {
  const { entries } = parseProcessConfig([
    '"C:\\Games\\Apex\\r5apex_dx12.exe" 2000',
    '"D:\\Games\\Apex\\r5apex_dx12.exe" 4000',
  ].join('\n'));

  const selected = selectTargetPollingRate(entries, [
    { processName: 'r5apex_dx12.exe', executablePath: 'D:\\Games\\Apex\\r5apex_dx12.exe' },
    { processName: 'r5apex_dx12.exe', executablePath: 'C:\\Games\\Apex\\r5apex_dx12.exe' },
  ], 500);

  assert.equal(selected.targetRate, 2000);
});

test('full executable path matching is case-insensitive on Windows paths', () => {
  const { entries } = parseProcessConfig('"C:\\Games\\Apex\\r5apex_dx12.exe" 4000');
  const selected = selectTargetPollingRate(entries, [{
    processName: 'R5APEX_DX12.EXE',
    executablePath: 'c:\\games\\apex\\R5APEX_DX12.EXE',
  }], 500);

  assert.equal(selected.targetRate, 4000);
});

test('foreground mode switches to inactive rate when focused process does not match', () => {
  const { entries } = parseProcessConfig('r5apex_dx12.exe 4000');
  const selected = selectForegroundPollingRate(entries, {
    processName: 'notepad.exe',
    executablePath: 'C:\\Windows\\System32\\notepad.exe',
  }, 500);

  assert.equal(selected.targetRate, 500);
  assert.equal(selected.matchedProcess, null);
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
