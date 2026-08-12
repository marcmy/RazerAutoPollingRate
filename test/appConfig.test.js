const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SETTINGS,
  normalizePollingCheckIntervalMs,
  readAppConfig,
  serializeAppConfig,
  writeAppConfig,
} = require('../src/lib/appConfig');
const { parseProcessConfig } = require('../src/lib/config');

test('config.ini serializes settings, game folders and ordered rules', () => {
  const { entries } = parseProcessConfig([
    'r5apex.exe 4000 running',
    '"C:\\Games\\Quake Live\\quake_live_x64.exe" default',
  ].join('\n'));
  const contents = serializeAppConfig({
    inactivePollingRate: 500,
    defaultGamePollingRate: 2000,
    detectionMode: 'running',
    autoDetectGames: false,
    autostart: false,
    diagnosticLogging: true,
    verboseDiagnosticLogging: true,
    pollingCheckIntervalMs: 500,
  }, entries, ['D:\\Games', 'E:\\Portable Games']);

  assert.match(contents, /\[settings\]/);
  assert.match(contents, /inactive_polling_rate=500/);
  assert.match(contents, /default_game_polling_rate=2000/);
  assert.match(contents, /detection_mode=running/);
  assert.match(contents, /auto_detect_games=false/);
  assert.match(contents, /autostart=false/);
  assert.match(contents, /diagnostic_logging=true/);
  assert.match(contents, /verbose_diagnostic_logging=true/);
  assert.match(contents, /polling_check_interval_ms=500/);
  assert.match(contents, /\[game_folders\]/);
  assert.match(contents, /1=D:\\Games/);
  assert.match(contents, /2=E:\\Portable Games/);
  assert.match(contents, /\[rules\]/);
  assert.match(contents, /1=r5apex.exe 4000 running/);
  assert.match(contents, /2="C:\\Games\\Quake Live\\quake_live_x64.exe" default/);
});

test('config.ini reads settings, folders and rules back', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const configPath = path.join(directory, 'config.ini');

  fs.writeFileSync(configPath, [
    '[settings]',
    'inactive_polling_rate=250',
    'default_game_polling_rate=8000',
    'detection_mode=foreground',
    'auto_detect_games=true',
    'autostart=true',
    'diagnostic_logging=true',
    'verbose_diagnostic_logging=false',
    'polling_check_interval_ms=200',
    '',
    '[game_folders]',
    '2=E:\\Portable Games',
    '1=D:\\Games',
    '',
    '[rules]',
    '2=quake_live_x64.exe default running',
    '1=r5apex.exe 4000',
    '',
  ].join('\n'));

  const {
    settings,
    entries,
    gameFolders,
    warnings,
  } = readAppConfig(configPath);

  assert.deepEqual(settings, {
    inactivePollingRate: 250,
    defaultGamePollingRate: 8000,
    detectionMode: 'foreground',
    autoDetectGames: true,
    autostart: true,
    diagnosticLogging: true,
    verboseDiagnosticLogging: false,
    pollingCheckIntervalMs: 200,
  });
  assert.deepEqual(gameFolders, ['D:\\Games', 'E:\\Portable Games']);
  assert.deepEqual(entries.map((entry) => entry.rawTarget), ['r5apex.exe', 'quake_live_x64.exe']);
  assert.equal(entries[1].usesDefaultPollingRate, true);
  assert.equal(entries[1].detectionMode, 'running');
  assert.deepEqual(warnings, []);
});

test('missing config.ini uses default settings and no folders', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const { settings, entries, gameFolders } = readAppConfig(path.join(directory, 'config.ini'));

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(entries, []);
  assert.deepEqual(gameFolders, []);
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

test('debug polling interval accepts 200 ms and rejects invalid values', () => {
  assert.equal(normalizePollingCheckIntervalMs('200'), 200);
  assert.equal(normalizePollingCheckIntervalMs('500'), 500);
  assert.equal(normalizePollingCheckIntervalMs('199'), DEFAULT_SETTINGS.pollingCheckIntervalMs);
  assert.equal(normalizePollingCheckIntervalMs('not-a-number'), DEFAULT_SETTINGS.pollingCheckIntervalMs);
});

test('writeAppConfig writes a readable config.ini', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const configPath = path.join(directory, 'config.ini');
  const { entries } = parseProcessConfig('r5apex.exe 4000');

  writeAppConfig(configPath, {
    inactivePollingRate: 1000,
    defaultGamePollingRate: 1000,
    detectionMode: 'foreground',
    autoDetectGames: true,
    autostart: true,
    diagnosticLogging: false,
    verboseDiagnosticLogging: false,
  }, entries, ['D:\\Games']);

  const readBack = readAppConfig(configPath);
  assert.equal(readBack.settings.inactivePollingRate, 1000);
  assert.equal(readBack.entries[0].processName, 'r5apex.exe');
  assert.deepEqual(readBack.gameFolders, ['D:\\Games']);
});


test('config.ini persists custom game names and ignored games', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));
  const configPath = path.join(directory, 'config.ini');
  const { entries } = parseProcessConfig('r5apex.exe default');
  const metadata = [
    { id: 'manual:r5apex.exe', name: 'R5Reloaded', target: 'r5apex.exe' },
    { id: 'C:\\Games\\Hollow Knight', hidden: true, target: 'C:\\Games\\Hollow Knight\\hollow_knight.exe' },
  ];

  writeAppConfig(configPath, DEFAULT_SETTINGS, entries, ['C:\\Games'], metadata);
  const readBack = readAppConfig(configPath);

  assert.deepEqual(readBack.gameMetadata, [
    { id: 'manual:r5apex.exe', name: 'R5Reloaded', target: 'r5apex.exe' },
    { id: 'c:\\games\\hollow knight', hidden: true, target: 'c:\\games\\hollow knight\\hollow_knight.exe' },
  ]);
});
