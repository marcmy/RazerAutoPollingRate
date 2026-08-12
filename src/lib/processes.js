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

  if (!processInfo) {
    return {
      processName: '',
      executablePath: null,
    };
  }

  return {
    processName: normalizeProcessName(processInfo.processName || processInfo.name),
    executablePath: processInfo.executablePath ? normalizeExecutablePath(processInfo.executablePath) : null,
  };
}

function entryMatchesProcess(entry, processInfo, options = {}) {
  const process = normalizeProcessInfo(processInfo);

  if (entry.executablePath) {
    if (process.executablePath) {
      return entry.executablePath === process.executablePath;
    }

    return Boolean(options.allowPathNameFallback)
      && Boolean(process.processName)
      && entry.processName === process.processName;
  }

  return Boolean(process.processName) && entry.processName === process.processName;
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

function buildSelection(match, inactivePollingRate, details = {}) {
  if (match) {
    const targetRate = match.usesDefaultPollingRate || match.pollingRate === null
      ? (details.defaultGamePollingRate || inactivePollingRate)
      : match.pollingRate;
    return {
      targetRate,
      matchedProcess: match.rawTarget || match.rawProcessName || match.processName,
      matchedRule: match,
      matchedDetectionMode: details.matchedDetectionMode || null,
      source: details.source || 'rule',
    };
  }

  return {
    targetRate: inactivePollingRate,
    matchedProcess: null,
    matchedRule: null,
    matchedDetectionMode: null,
    source: 'inactive',
  };
}

function selectTargetPollingRate(entries, runningProcessNames, inactivePollingRate, defaultGamePollingRate = null) {
  return buildSelection(findBestMatchingProcess(entries, runningProcessNames), inactivePollingRate, {
    matchedDetectionMode: 'running',
    defaultGamePollingRate,
  });
}

function selectForegroundPollingRate(entries, foregroundProcess, inactivePollingRate, defaultGamePollingRate = null) {
  if (!foregroundProcess) {
    return buildSelection(null, inactivePollingRate);
  }

  return buildSelection(findBestMatchingProcess(entries, [foregroundProcess]), inactivePollingRate, {
    matchedDetectionMode: 'foreground',
    defaultGamePollingRate,
  });
}

function getRuleDetectionMode(entry, defaultDetectionMode = 'foreground') {
  if (entry && (entry.detectionMode === 'foreground' || entry.detectionMode === 'running')) {
    return entry.detectionMode;
  }

  return defaultDetectionMode === 'running' ? 'running' : 'foreground';
}

function ruleNeedsRunningProcesses(entry, defaultDetectionMode = 'foreground') {
  return getRuleDetectionMode(entry, defaultDetectionMode) === 'running';
}

function findConfiguredMatch(entries, options = {}) {
  const foregroundProcess = options.foregroundProcess || null;
  const runningProcesses = Array.isArray(options.runningProcesses) ? options.runningProcesses : [];
  const defaultDetectionMode = options.defaultDetectionMode === 'running' ? 'running' : 'foreground';

  for (const wantsPath of [true, false]) {
    for (const entry of entries) {
      if (Boolean(entry.executablePath) !== wantsPath) {
        continue;
      }

      const mode = getRuleDetectionMode(entry, defaultDetectionMode);
      const candidates = mode === 'running'
        ? runningProcesses
        : (foregroundProcess ? [foregroundProcess] : []);
      const allowPathNameFallback = mode === 'running';

      if (candidates.some((candidate) => entryMatchesProcess(entry, candidate, { allowPathNameFallback }))) {
        return {
          entry,
          detectionMode: mode,
        };
      }
    }
  }

  return null;
}

function selectConfiguredPollingRate(entries, options = {}) {
  const inactivePollingRate = options.inactivePollingRate;
  const match = findConfiguredMatch(entries, options);
  if (!match) {
    return buildSelection(null, inactivePollingRate);
  }

  return buildSelection(match.entry, inactivePollingRate, {
    matchedDetectionMode: match.detectionMode,
    source: 'rule',
    defaultGamePollingRate: options.defaultGamePollingRate,
  });
}

module.exports = {
  entryMatchesProcess,
  findBestMatchingProcess,
  findConfiguredMatch,
  findFirstMatchingProcess,
  getRuleDetectionMode,
  normalizeProcessInfo,
  parseTasklistCsv,
  ruleNeedsRunningProcesses,
  selectConfiguredPollingRate,
  selectForegroundPollingRate,
  selectTargetPollingRate,
};
