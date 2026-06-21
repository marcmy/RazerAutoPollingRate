const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SETTINGS,
  parseIni,
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
    diagnosticLogging: true,
    verboseDiagnosticLogging: true,
  }, entries);

  assert.match(contents, /\[settings\]/);
  assert.match(contents, /inactive_polling_rate=500/);
  assert.match(contents, /default_game_polling_rate=2000/);
  assert.match(contents, /detection_mode=running/);
  assert.match(contents, /autostart=false/);
  assert.match(contents, /diagnostic_logging=true/);
  assert.match(contents, /verbose_diagnostic_logging=true/);
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
    'diagnostic_logging=true',
    'verbose_diagnostic_logging=false',
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
    diagnosticLogging: true,
    verboseDiagnosticLogging: false,
  });
  assert.deepEqual(entries.map((entry) => entry.rawTarget), ['r5apex.exe', 'quake_live_x64.exe']);
  assert.deepEqual(entries.map((entry) => entry.pollingRate), [4000, 1000]);
  assert.deepEqual(warnings, []);
});

test('config.ini ignores prototype-polluting section and property names', () => {
  const parsed = parseIni([
    '[__proto__]',
    'polluted=yes',
    '[constructor]',
    'polluted=yes',
    '[prototype]',
    'polluted=yes',
    '[settings]',
    '__proto__=polluted',
    'constructor=polluted',
    'prototype=polluted',
    'inactive_polling_rate=250',
  ].join('\n'));

  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(Object.hasOwn(parsed, '__proto__'), false);
  assert.equal(Object.hasOwn(parsed, 'constructor'), false);
  assert.equal(Object.hasOwn(parsed, 'prototype'), false);
  assert.equal(Object.getPrototypeOf(parsed.settings), null);
  assert.equal(Object.hasOwn(parsed.settings, '__proto__'), false);
  assert.equal(Object.hasOwn(parsed.settings, 'constructor'), false);
  assert.equal(Object.hasOwn(parsed.settings, 'prototype'), false);
  assert.equal(parsed.settings.inactive_polling_rate, '250');
  assert.equal({}.polluted, undefined);
});

test('missing config.ini uses default settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const { settings, entries } = readAppConfig(path.join(directory, 'config.ini'));

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(entries, []);
});

test('verbose diagnostic logging can stay selected while diagnostic logging is off', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const configPath = path.join(directory, 'config.ini');

  fs.writeFileSync(configPath, [
    '[settings]',
    'diagnostic_logging=false',
    'verbose_diagnostic_logging=true',
    '',
  ].join('\n'));

  const { settings } = readAppConfig(configPath);

  assert.equal(settings.diagnosticLogging, false);
  assert.equal(settings.verboseDiagnosticLogging, true);
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
    diagnosticLogging: false,
    verboseDiagnosticLogging: false,
  }, entries);

  const readBack = readAppConfig(configPath);

  assert.equal(readBack.settings.inactivePollingRate, 1000);
  assert.equal(readBack.entries[0].processName, 'r5apex.exe');
});
