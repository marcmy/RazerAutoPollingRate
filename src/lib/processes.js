const { normalizeProcessName } = require('./config');

function parseTasklistCsv(output) {
  const names = [];

  String(output || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const match = trimmed.match(/^"((?:[^"]|"")*)"/);
    if (!match) {
      return;
    }

    names.push(normalizeProcessName(match[1].replace(/""/g, '"')));
  });

  return names;
}

function findFirstMatchingProcess(entries, runningProcessNames) {
  const running = new Set(runningProcessNames.map(normalizeProcessName));
  return entries.find((entry) => running.has(entry.processName)) || null;
}

function selectTargetPollingRate(entries, runningProcessNames, inactivePollingRate) {
  const match = findFirstMatchingProcess(entries, runningProcessNames);
  if (match) {
    return {
      targetRate: match.pollingRate,
      matchedProcess: match.rawProcessName || match.processName,
    };
  }

  return {
    targetRate: inactivePollingRate,
    matchedProcess: null,
  };
}

module.exports = {
  findFirstMatchingProcess,
  parseTasklistCsv,
  selectTargetPollingRate,
};
