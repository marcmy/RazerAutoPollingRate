const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProcessConfig } = require('../src/lib/config');
const {
  findFirstMatchingProcess,
  parseTasklistCsv,
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
