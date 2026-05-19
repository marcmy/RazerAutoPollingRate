const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SETTINGS,
  readAppConfig,
  serializeAppConfig,
  writeAppConfig,
} = require('../src/lib/appConfig');
const { parseProcessConfig } = require('../src/lib/config');

test('config.ini serializes settings and ordered rules', () => {
  const { entries } = parseProcessConfig([
    'r5apex.exe 4000',
    '"C:\\Games\\Quake Live\\quake_live_x64.exe" 1000',
  ].join('\n'));
  const contents = serializeAppConfig({
    inactivePollingRate: 500,
    defaultGamePollingRate: 2000,
    detectionMode: 'running',
    autostart: false,
  }, entries);

  assert.match(contents, /\[settings\]/);
  assert.match(contents, /inactive_polling_rate=500/);
  assert.match(contents, /default_game_polling_rate=2000/);
  assert.match(contents, /detection_mode=running/);
  assert.match(contents, /autostart=false/);
  assert.match(contents, /\[rules\]/);
  assert.match(contents, /1=r5apex.exe 4000/);
  assert.match(contents, /2="C:\\Games\\Quake Live\\quake_live_x64.exe" 1000/);
});

test('config.ini reads settings and rules back', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const configPath = path.join(directory, 'config.ini');

  fs.writeFileSync(configPath, [
    '[settings]',
    'inactive_polling_rate=250',
    'default_game_polling_rate=8000',
    'detection_mode=foreground',
    'autostart=true',
    '',
    '[rules]',
    '2=quake_live_x64.exe 1000',
    '1=r5apex.exe 4000',
    '',
  ].join('\n'));

  const { settings, entries, warnings } = readAppConfig(configPath);

  assert.deepEqual(settings, {
    inactivePollingRate: 250,
    defaultGamePollingRate: 8000,
    detectionMode: 'foreground',
    autostart: true,
  });
  assert.deepEqual(entries.map((entry) => entry.rawTarget), ['r5apex.exe', 'quake_live_x64.exe']);
  assert.deepEqual(entries.map((entry) => entry.pollingRate), [4000, 1000]);
  assert.deepEqual(warnings, []);
});

test('missing config.ini uses default settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const { settings, entries } = readAppConfig(path.join(directory, 'config.ini'));

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(entries, []);
});

test('writeAppConfig writes a readable config.ini', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const configPath = path.join(directory, 'config.ini');
  const { entries } = parseProcessConfig('r5apex.exe 4000');

  writeAppConfig(configPath, {
    inactivePollingRate: 1000,
    defaultGamePollingRate: 1000,
    detectionMode: 'foreground',
    autostart: true,
  }, entries);

  const readBack = readAppConfig(configPath);

  assert.equal(readBack.settings.inactivePollingRate, 1000);
  assert.equal(readBack.entries[0].processName, 'r5apex.exe');
});
