const { parsePollingRate, VALID_POLLING_RATES } = require('./rates');

function normalizeProcessName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeExecutablePath(value) {
  return String(value || '').trim().replace(/\//g, '\\').toLowerCase();
}

function isFullExecutablePath(value) {
  return /^[a-z]:\\.+\.exe$/i.test(String(value || '').trim());
}

function parseRuleLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('"')) {
    const closingQuoteIndex = trimmed.indexOf('"', 1);
    if (closingQuoteIndex === -1) {
      return null;
    }

    const target = trimmed.slice(1, closingQuoteIndex);
    const remainder = trimmed.slice(closingQuoteIndex + 1).trim();
    if (!remainder) {
      return null;
    }

    const parts = remainder.split(/\s+/);
    if (parts.length !== 1) {
      return null;
    }

    return { target, rateValue: parts[0], wasQuoted: true };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) {
    return null;
  }

  return { target: parts[0], rateValue: parts[1], wasQuoted: false };
}

function parseProcessConfig(contents, options = {}) {
  const warnings = [];
  const entries = [];
  const warn = typeof options.warn === 'function' ? options.warn : () => {};

  String(contents || '').split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutComment = rawLine.replace(/\s+#.*$/, '').trim();

    if (!withoutComment || withoutComment.startsWith('#')) {
      return;
    }

    const parsedLine = parseRuleLine(withoutComment);
    if (!parsedLine) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: expected "process.exe pollingRate" or "\\"C:\\path\\process.exe\\" pollingRate".`;
      warnings.push(message);
      warn(message);
      return;
    }

    const { target, rateValue, wasQuoted } = parsedLine;
    const isPath = isFullExecutablePath(target);
    const normalizedName = normalizeProcessName(isPath ? target.split(/[\\/]/).pop() : target);
    const normalizedPath = isPath ? normalizeExecutablePath(target) : null;

    if (/\s/.test(target) && !wasQuoted) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: paths with spaces must be quoted.`;
      warnings.push(message);
      warn(message);
      return;
    }

    if (isPath && !wasQuoted && /\s/.test(target)) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: paths with spaces must be quoted.`;
      warnings.push(message);
      warn(message);
      return;
    }

    if (!isPath && !/^[^\\/:*?"<>|]+\.exe$/i.test(target)) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: "${target}" is not an executable name ending in .exe or a quoted full .exe path.`;
      warnings.push(message);
      warn(message);
      return;
    }

    const pollingRate = parsePollingRate(rateValue);
    if (pollingRate === null) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: "${rateValue}" is not a valid polling rate (${VALID_POLLING_RATES.join(', ')}).`;
      warnings.push(message);
      warn(message);
      return;
    }

    entries.push({
      processName: normalizedName,
      executablePath: normalizedPath,
      isPathRule: isPath,
      pollingRate,
      lineNumber,
      rawTarget: target,
      rawProcessName: isPath ? target.split(/[\\/]/).pop() : target,
    });
  });

  return { entries, warnings };
}

function formatRuleTarget(target) {
  const value = String(target || '').trim();
  if (isFullExecutablePath(value) || /\s/.test(value)) {
    return `"${value.replace(/"/g, '')}"`;
  }

  return value;
}

function serializeProcessConfig(entries) {
  return entries
    .map((entry) => `${formatRuleTarget(entry.rawTarget || entry.executablePath || entry.processName)} ${entry.pollingRate}`)
    .join('\n');
}

module.exports = {
  formatRuleTarget,
  isFullExecutablePath,
  normalizeExecutablePath,
  normalizeProcessName,
  parseProcessConfig,
  serializeProcessConfig,
};
