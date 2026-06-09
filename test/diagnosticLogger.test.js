const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DiagnosticLogger,
  formatLogDate,
  sanitizeLogName,
} = require('../src/lib/diagnosticLogger');

function makeLogDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-logs-'));
}

test('diagnostic logger names logs by date and program', () => {
  const logDirectory = makeLogDirectory();
  const logger = new DiagnosticLogger({ logDirectory });
  const now = new Date('2026-06-09T05:04:03.000Z');

  logger.updateSession({
    enabled: true,
    runningSelection: { matchedProcess: 'r5apex.exe' },
    now,
  });

  assert.equal(formatLogDate(now), '06-09-2026');
  assert.equal(path.basename(logger.activeFilePath), '06-09-2026-r5apex.exe.txt');
  assert.match(fs.readFileSync(logger.activeFilePath, 'utf8'), /session_start/);
});

test('diagnostic logger sanitizes full path program names', () => {
  assert.equal(
    sanitizeLogName('"C:\\Program Files\\Game\\game.exe"'),
    'C__Program Files_Game_game.exe',
  );
});

test('diagnostic logger ignores verbose events unless enabled', () => {
  const logDirectory = makeLogDirectory();
  const logger = new DiagnosticLogger({ logDirectory });

  logger.updateSession({
    enabled: true,
    verbose: false,
    runningSelection: { matchedProcess: 'game.exe' },
    now: new Date('2026-06-09T05:04:03.000Z'),
  });
  logger.record('verbose_event', { value: 1 }, { verbose: true });

  assert.doesNotMatch(fs.readFileSync(logger.activeFilePath, 'utf8'), /verbose_event/);

  logger.updateSession({
    enabled: true,
    verbose: true,
    runningSelection: { matchedProcess: 'game.exe' },
    now: new Date('2026-06-09T05:04:04.000Z'),
  });
  logger.record('verbose_event', { value: 2 }, { verbose: true });

  assert.match(fs.readFileSync(logger.activeFilePath, 'utf8'), /verbose_event/);
});

test('diagnostic logger stops when configured process is no longer running', () => {
  const logDirectory = makeLogDirectory();
  const logger = new DiagnosticLogger({ logDirectory });

  logger.updateSession({
    enabled: true,
    runningSelection: { matchedProcess: 'game.exe' },
    now: new Date('2026-06-09T05:04:03.000Z'),
  });
  const filePath = logger.activeFilePath;

  logger.updateSession({
    enabled: true,
    runningSelection: { matchedProcess: null },
    now: new Date('2026-06-09T05:04:04.000Z'),
  });

  assert.equal(logger.activeFilePath, null);
  assert.match(fs.readFileSync(filePath, 'utf8'), /session_end/);
});

test('diagnostic logger prunes logs to the configured maximum', () => {
  const logDirectory = makeLogDirectory();
  const logger = new DiagnosticLogger({ logDirectory, maxLogFiles: 3 });

  for (let index = 0; index < 5; index += 1) {
    const filePath = path.join(logDirectory, `06-0${index + 1}-2026-game.exe.txt`);
    fs.writeFileSync(filePath, 'old log', 'utf8');
    fs.utimesSync(filePath, new Date(2026, 5, index + 1), new Date(2026, 5, index + 1));
  }

  logger.pruneLogs();

  const files = fs.readdirSync(logDirectory).sort();
  assert.deepEqual(files, [
    '06-03-2026-game.exe.txt',
    '06-04-2026-game.exe.txt',
    '06-05-2026-game.exe.txt',
  ]);
});
