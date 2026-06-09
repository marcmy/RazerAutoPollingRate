const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_LOG_FILES = 10;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLogDate(date = new Date()) {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${date.getFullYear()}`;
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function sanitizeLogName(value) {
  return String(value || 'unknown')
    .replace(/^"+|"+$/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'unknown';
}

function formatDetails(details = {}) {
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
}

function createInactiveSelection() {
  return {
    matchedProcess: null,
    targetRate: null,
  };
}

class DiagnosticLogger {
  constructor(options = {}) {
    this.logDirectory = options.logDirectory;
    this.maxLogFiles = options.maxLogFiles || DEFAULT_MAX_LOG_FILES;
    this.activeProgram = null;
    this.activeFilePath = null;
    this.verbose = false;
    this.lastKeys = new Map();
  }

  updateSession(options = {}) {
    const enabled = Boolean(options.enabled);
    this.verbose = Boolean(options.verbose);
    const runningSelection = options.runningSelection || createInactiveSelection();
    const matchedProcess = runningSelection.matchedProcess || null;
    const now = options.now || new Date();

    if (!enabled || !matchedProcess) {
      this.stop(now, enabled ? 'configured process no longer running' : 'logging disabled');
      return;
    }

    if (this.activeProgram !== matchedProcess) {
      this.stop(now, `switching to ${matchedProcess}`);
      this.start(matchedProcess, now);
    }
  }

  start(program, now = new Date()) {
    this.activeProgram = program;
    this.activeFilePath = this.getLogPath(program, now);
    this.lastKeys.clear();
    fs.mkdirSync(path.dirname(this.activeFilePath), { recursive: true });
    this.write('session_start', {
      program,
    }, { now });
    this.pruneLogs();
  }

  stop(now = new Date(), reason = 'stopped') {
    if (!this.activeFilePath) {
      return;
    }

    this.write('session_end', {
      program: this.activeProgram,
      reason,
    }, { now });
    this.activeProgram = null;
    this.activeFilePath = null;
    this.lastKeys.clear();
  }

  record(eventName, details = {}, options = {}) {
    if (!this.activeFilePath) {
      return;
    }

    if (options.verbose && !this.verbose) {
      return;
    }

    if (options.key) {
      const previous = this.lastKeys.get(eventName);
      if (previous === options.key) {
        return;
      }
      this.lastKeys.set(eventName, options.key);
    }

    this.write(eventName, details, options);
  }

  write(eventName, details = {}, options = {}) {
    if (!this.activeFilePath) {
      return;
    }

    const detailText = formatDetails(details);
    const line = `[${formatTimestamp(options.now || new Date())}] ${eventName}${detailText ? ` ${detailText}` : ''}\n`;
    fs.appendFileSync(this.activeFilePath, line, 'utf8');
  }

  getLogPath(program, now = new Date()) {
    return path.join(this.logDirectory, `${formatLogDate(now)}-${sanitizeLogName(program)}.txt`);
  }

  pruneLogs() {
    if (!fs.existsSync(this.logDirectory)) {
      return;
    }

    const files = fs.readdirSync(this.logDirectory)
      .filter((file) => file.toLowerCase().endsWith('.txt'))
      .map((file) => {
        const filePath = path.join(this.logDirectory, file);
        return {
          filePath,
          mtimeMs: fs.statSync(filePath).mtimeMs,
        };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs);

    while (files.length > this.maxLogFiles) {
      const oldest = files.shift();
      fs.unlinkSync(oldest.filePath);
    }
  }
}

module.exports = {
  DEFAULT_MAX_LOG_FILES,
  DiagnosticLogger,
  formatLogDate,
  formatTimestamp,
  sanitizeLogName,
};
