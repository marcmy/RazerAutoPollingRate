const { parsePollingRate, VALID_POLLING_RATES } = require('./rates');

const VALID_DETECTION_MODES = ['default', 'foreground', 'running'];

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
  const rawParts = trimmed.split(/\s+/);
  if (!trimmed.startsWith('"')
    && /^[a-z]:\\/i.test(trimmed)
    && rawParts.length > 2
    && !/\.exe$/i.test(rawParts[0])) {
    return null;
  }

  let target;
  let remainder;
  let wasQuoted = false;

  if (trimmed.startsWith('"')) {
    const closingQuoteIndex = trimmed.indexOf('"', 1);
    if (closingQuoteIndex === -1) {
      return null;
    }

    target = trimmed.slice(1, closingQuoteIndex);
    remainder = trimmed.slice(closingQuoteIndex + 1).trim();
    wasQuoted = true;
  } else {
    const parts = trimmed.split(/\s+/);
    target = parts.shift();
    remainder = parts.join(' ');
  }

  if (!target || !remainder) {
    return null;
  }

  const parts = remainder.split(/\s+/);
  if (parts.length < 1 || parts.length > 2) {
    return null;
  }

  return {
    target,
    rateValue: parts[0],
    detectionMode: parts[1] || 'default',
    wasQuoted,
  };
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
      const message = `Ignoring config rule line ${lineNumber}: expected "process.exe pollingRate [default|foreground|running]" or "\\"C:\\path\\process.exe\\" pollingRate [mode]".`;
      warnings.push(message);
      warn(message);
      return;
    }

    const {
      target,
      rateValue,
      detectionMode,
      wasQuoted,
    } = parsedLine;
    const isPath = isFullExecutablePath(target);
    const normalizedName = normalizeProcessName(isPath ? target.split(/[\\/]/).pop() : target);
    const normalizedPath = isPath ? normalizeExecutablePath(target) : null;

    if (/\s/.test(target) && !wasQuoted) {
      const message = `Ignoring config rule line ${lineNumber}: paths with spaces must be quoted.`;
      warnings.push(message);
      warn(message);
      return;
    }

    if (!isPath && !/^[^\\/:*?"<>|]+\.exe$/i.test(target)) {
      const message = `Ignoring config rule line ${lineNumber}: "${target}" is not an executable name ending in .exe or a quoted full .exe path.`;
      warnings.push(message);
      warn(message);
      return;
    }

    const usesDefaultPollingRate = String(rateValue).toLowerCase() === 'default';
    const pollingRate = usesDefaultPollingRate ? null : parsePollingRate(rateValue);
    if (!usesDefaultPollingRate && pollingRate === null) {
      const message = `Ignoring config rule line ${lineNumber}: "${rateValue}" is not a valid polling rate (default, ${VALID_POLLING_RATES.join(', ')}).`;
      warnings.push(message);
      warn(message);
      return;
    }

    const normalizedDetectionMode = String(detectionMode || 'default').toLowerCase();
    if (!VALID_DETECTION_MODES.includes(normalizedDetectionMode)) {
      const message = `Ignoring config rule line ${lineNumber}: "${detectionMode}" is not a valid detection mode (default, foreground, running).`;
      warnings.push(message);
      warn(message);
      return;
    }

    entries.push({
      processName: normalizedName,
      executablePath: normalizedPath,
      isPathRule: isPath,
      pollingRate,
      usesDefaultPollingRate,
      detectionMode: normalizedDetectionMode,
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
    .map((entry) => {
      const target = formatRuleTarget(entry.rawTarget || entry.executablePath || entry.processName);
      const mode = VALID_DETECTION_MODES.includes(entry.detectionMode)
        ? entry.detectionMode
        : 'default';
      const rate = entry.usesDefaultPollingRate || entry.pollingRate === null ? 'default' : entry.pollingRate;
      return `${target} ${rate}${mode === 'default' ? '' : ` ${mode}`}`;
    })
    .join('\n');
}

module.exports = {
  VALID_DETECTION_MODES,
  formatRuleTarget,
  isFullExecutablePath,
  normalizeExecutablePath,
  normalizeProcessName,
  parseProcessConfig,
  serializeProcessConfig,
};
