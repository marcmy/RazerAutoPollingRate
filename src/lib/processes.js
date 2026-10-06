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

function resolveRulePollingRate(entry, options = {}) {
  return entry.usesDefaultPollingRate || entry.pollingRate === null
    ? (options.defaultGamePollingRate || options.inactivePollingRate)
    : entry.pollingRate;
}

function canSafelyFallbackPathRuleByName(entries, entry, processInfo, options = {}) {
  if (!entry || !entry.executablePath) {
    return false;
  }

  const process = normalizeProcessInfo(processInfo);
  if (process.executablePath || !process.processName || entry.processName !== process.processName) {
    return false;
  }

  const matchingPathRules = entries.filter((candidate) => candidate.executablePath
    && candidate.processName === process.processName);

  // Windows can hide protected games' paths. Multiple installs are safe to
  // share a polling-rate match when rate and detection agree. Resolve an
  // ambiguous optional Turbo setting separately instead of losing that match.
  return matchingPathRules.length > 0 && matchingPathRules.every((candidate) =>
    resolveRulePollingRate(candidate, options) === resolveRulePollingRate(entry, options)
    && getRuleDetectionMode(candidate, options.defaultDetectionMode)
      === getRuleDetectionMode(entry, options.defaultDetectionMode));
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
    const targetRate = resolveRulePollingRate(match, { ...details, inactivePollingRate });
    return {
      targetRate,
      matchedProcess: match.rawTarget || match.rawProcessName || match.processName,
      matchedRule: match,
      matchedDetectionMode: details.matchedDetectionMode || null,
      source: details.source || 'rule',
      turboModeAmbiguous: details.turboModeAmbiguous === true,
      matchedProcessInfo: details.matchedProcessInfo || null,
    };
  }

  return {
    targetRate: inactivePollingRate,
    matchedProcess: null,
    matchedRule: null,
    matchedDetectionMode: null,
    source: 'inactive',
    turboModeAmbiguous: false,
    matchedProcessInfo: null,
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

  // Check every exact path before accepting any name fallback. In running
  // mode, a pathless process must not hide another copy's known exact path.
  for (const matchKind of ['exact-path', 'path-name', 'name']) {
    for (const entry of entries) {
      if (Boolean(entry.executablePath) !== (matchKind !== 'name')) {
        continue;
      }

      const mode = getRuleDetectionMode(entry, defaultDetectionMode);
      const candidates = mode === 'running'
        ? runningProcesses
        : (foregroundProcess ? [foregroundProcess] : []);

      const matched = candidates.find((candidate) => {
        if (matchKind === 'path-name') {
          return canSafelyFallbackPathRuleByName(entries, entry, candidate, options)
            && entryMatchesProcess(entry, candidate, { allowPathNameFallback: true });
        }
        return entryMatchesProcess(entry, candidate);
      });
      if (matched) {
        return {
          entry,
          detectionMode: mode,
          matchedProcessInfo: normalizeProcessInfo(matched),
          turboModeAmbiguous: matchKind === 'path-name' && entries.some((candidate) =>
            candidate.executablePath && candidate.processName === entry.processName
            && (candidate.turboMode === true) !== (entry.turboMode === true)),
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
    turboModeAmbiguous: match.turboModeAmbiguous,
    matchedProcessInfo: match.matchedProcessInfo,
  });
}

module.exports = {
  canSafelyFallbackPathRuleByName,
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
