const { parsePollingRate, VALID_POLLING_RATES } = require('./rates');

function normalizeProcessName(value) {
  return String(value || '').trim().toLowerCase();
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

    const parts = withoutComment.split(/\s+/);
    if (parts.length !== 2) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: expected "process.exe pollingRate".`;
      warnings.push(message);
      warn(message);
      return;
    }

    const [processName, rateValue] = parts;
    const normalizedName = normalizeProcessName(processName);

    if (!/^[^\\/:*?"<>|]+\.exe$/i.test(processName)) {
      const message = `Ignoring processlist.cfg line ${lineNumber}: "${processName}" is not an executable name ending in .exe.`;
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
      pollingRate,
      lineNumber,
      rawProcessName: processName,
    });
  });

  return { entries, warnings };
}

module.exports = {
  normalizeProcessName,
  parseProcessConfig,
};
