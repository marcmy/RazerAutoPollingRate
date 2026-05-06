const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProcessConfig } = require('../src/lib/config');

test('valid config lines parse correctly', () => {
  const { entries, warnings } = parseProcessConfig('r5apex.exe 4000\nquake_live_x64.exe 1000');

  assert.deepEqual(entries.map((entry) => [entry.processName, entry.pollingRate]), [
    ['r5apex.exe', 4000],
    ['quake_live_x64.exe', 1000],
  ]);
  assert.deepEqual(warnings, []);
});

test('CRLF and LF line endings both parse', () => {
  const crlf = parseProcessConfig('r5apex.exe 4000\r\nquake_live_x64.exe 1000');
  const lf = parseProcessConfig('r5apex.exe 4000\nquake_live_x64.exe 1000');

  assert.deepEqual(crlf.entries, lf.entries);
});

test('blank lines and comments are ignored', () => {
  const { entries } = parseProcessConfig('\n# comment\n\nr5apex.exe 4000\n\t# another comment\n');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].processName, 'r5apex.exe');
});

test('extra whitespace is handled', () => {
  const { entries } = parseProcessConfig('  r5apex.exe\t\t4000  ');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].pollingRate, 4000);
});

test('invalid rates are rejected with warnings', () => {
  const { entries, warnings } = parseProcessConfig('r5apex.exe 3333');

  assert.equal(entries.length, 0);
  assert.match(warnings[0], /not a valid polling rate/);
});

test('missing rates are rejected with warnings', () => {
  const { entries, warnings } = parseProcessConfig('r5apex.exe');

  assert.equal(entries.length, 0);
  assert.match(warnings[0], /expected "process.exe pollingRate"/);
});

test('inline comments after entries are ignored', () => {
  const { entries } = parseProcessConfig('r5apex.exe 4000 # Apex Legends');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].pollingRate, 4000);
});
