const { normalizeExecutablePath, normalizeProcessName } = require('./config');

function parseTasklistCsv(output) {
  const processes = [];

  String(output || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const match = trimmed.match(/^"((?:[^"]|"")*)"/);
    if (!match) {
      return;
    }

    const name = match[1].replace(/""/g, '"');
    processes.push({
      processName: normalizeProcessName(name),
      executablePath: null,
    });
  });

  return processes;
}

function normalizeProcessInfo(processInfo) {
  if (typeof processInfo === 'string') {
    return {
      processName: normalizeProcessName(processInfo),
      executablePath: null,
    };
  }

  return {
    processName: normalizeProcessName(processInfo.processName || processInfo.name),
    executablePath: processInfo.executablePath ? normalizeExecutablePath(processInfo.executablePath) : null,
  };
}

function findBestMatchingProcess(entries, processInfos) {
  const processes = processInfos.map(normalizeProcessInfo);
  const runningPaths = new Set(processes.map((processInfo) => processInfo.executablePath).filter(Boolean));
  const runningNames = new Set(processes.map((processInfo) => processInfo.processName).filter(Boolean));

  const pathMatch = entries.find((entry) => entry.executablePath && runningPaths.has(entry.executablePath));
  if (pathMatch) {
    return pathMatch;
  }

  return entries.find((entry) => !entry.executablePath && runningNames.has(entry.processName)) || null;
}

function findFirstMatchingProcess(entries, runningProcessNames) {
  return findBestMatchingProcess(entries, runningProcessNames);
}

function buildSelection(match, inactivePollingRate) {
  if (match) {
    return {
      targetRate: match.pollingRate,
      matchedProcess: match.rawTarget || match.rawProcessName || match.processName,
      matchedRule: match,
    };
  }

  return {
    targetRate: inactivePollingRate,
    matchedProcess: null,
    matchedRule: null,
  };
}

function selectTargetPollingRate(entries, runningProcessNames, inactivePollingRate) {
  return buildSelection(findBestMatchingProcess(entries, runningProcessNames), inactivePollingRate);
}

function selectForegroundPollingRate(entries, foregroundProcess, inactivePollingRate) {
  if (!foregroundProcess) {
    return buildSelection(null, inactivePollingRate);
  }

  return buildSelection(findBestMatchingProcess(entries, [foregroundProcess]), inactivePollingRate);
}

module.exports = {
  findBestMatchingProcess,
  findFirstMatchingProcess,
  parseTasklistCsv,
  selectForegroundPollingRate,
  selectTargetPollingRate,
};
