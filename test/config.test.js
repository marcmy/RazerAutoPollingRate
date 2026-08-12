const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProcessConfig, serializeProcessConfig } = require('../src/lib/config');

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

test('invalid rates are rejected with warnings', () => {
  const { entries, warnings } = parseProcessConfig('r5apex.exe 3333');
  assert.equal(entries.length, 0);
  assert.match(warnings[0], /not a valid polling rate/);
});

test('missing rates are rejected with warnings', () => {
  const { entries, warnings } = parseProcessConfig('r5apex.exe');
  assert.equal(entries.length, 0);
  assert.match(warnings[0], /expected "process.exe pollingRate/);
});

test('inline comments after entries are ignored', () => {
  const { entries } = parseProcessConfig('r5apex.exe 4000 # Apex Legends');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pollingRate, 4000);
});

test('quoted full executable paths with spaces parse correctly', () => {
  const { entries, warnings } = parseProcessConfig('"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe" 4000');

  assert.deepEqual(warnings, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].processName, 'r5apex_dx12.exe');
  assert.equal(entries[0].executablePath, 'c:\\program files (x86)\\steam\\steamapps\\common\\apex legends\\r5apex_dx12.exe');
  assert.equal(entries[0].isPathRule, true);
  assert.equal(entries[0].pollingRate, 4000);
  assert.equal(entries[0].detectionMode, 'default');
});

test('unquoted paths with spaces are rejected', () => {
  const { entries, warnings } = parseProcessConfig('C:\\Program Files\\Game\\game.exe 4000');
  assert.equal(entries.length, 0);
  assert.match(warnings[0], /expected "process.exe pollingRate/);
});

test('per-game detection mode is optional and serializes only when overridden', () => {
  const { entries, warnings } = parseProcessConfig([
    'game.exe 4000 running',
    '"C:\\Games\\Other Game\\other.exe" 2000 foreground',
  ].join('\n'));

  assert.deepEqual(warnings, []);
  assert.equal(entries[0].detectionMode, 'running');
  assert.equal(entries[1].detectionMode, 'foreground');
  assert.equal(
    serializeProcessConfig(entries),
    'game.exe 4000 running\n"C:\\Games\\Other Game\\other.exe" 2000 foreground',
  );
});

test('invalid per-game detection mode is rejected', () => {
  const { entries, warnings } = parseProcessConfig('game.exe 4000 magic');
  assert.equal(entries.length, 0);
  assert.match(warnings[0], /not a valid detection mode/);
});

test('game override may inherit the default polling rate', () => {
  const { entries, warnings } = parseProcessConfig('game.exe default running');
  assert.deepEqual(warnings, []);
  assert.equal(entries[0].pollingRate, null);
  assert.equal(entries[0].usesDefaultPollingRate, true);
  assert.equal(entries[0].detectionMode, 'running');
  assert.equal(serializeProcessConfig(entries), 'game.exe default running');
});

test('full executable paths serialize with quotes', () => {
  const { entries } = parseProcessConfig('"C:\\Program Files\\Game\\game.exe" 2000');
  assert.equal(serializeProcessConfig(entries), '"C:\\Program Files\\Game\\game.exe" 2000');
});
