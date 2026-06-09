if (require('electron-squirrel-startup')) return;

const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} = require('electron');

const { WebUSB } = require('usb');
const fs = require('fs');
const Store = require('electron-store');
const path = require('path');
const AutoLaunch = require('auto-launch');
const { execFile } = require('child_process');

const { createCheckGuard } = require('./lib/checkGuard');
const { DiagnosticLogger } = require('./lib/diagnosticLogger');
const {
  DEFAULT_SETTINGS,
  configExists,
  readAppConfig,
  writeAppConfig,
} = require('./lib/appConfig');
const {
  formatRuleTarget,
  normalizeExecutablePath,
  normalizeProcessName,
  parseProcessConfig,
} = require('./lib/config');
const {
  getForegroundProcess,
  getForegroundProcessSnapshot,
  getRunningProcesses,
  stopForegroundProcessWatcher,
} = require('./lib/processDiscovery');
const { selectForegroundPollingRate, selectTargetPollingRate } = require('./lib/processes');
const {
  getRateForReportByte,
  getReportByteForRate,
  parsePollingRate,
  resolveSupportedPollingRate,
} = require('./lib/rates');
const { getRazerReport } = require('./lib/razerReports');

const appPath = app.getAppPath();
const legacyStore = new Store();

function log(out, error = false) {
  const date = new Date().toLocaleTimeString('en-US', { hour12: false, hour: 'numeric', minute: 'numeric' });
  fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[ ${date} ] ${error ? 'ERROR: ' : 'LOG: '}${out}\n`);
}

const models = {
  None: 0,
  HyperPollingDongle: 1,
  ViperSE: 2,
  DockPro: 3,
};

const dongles = {
  0x009F: {
    model: models.ViperSE,
    is8kCompatible: true,
  },
  0x00B3: {
    model: models.HyperPollingDongle,
    is8kCompatible: true,
  },
  0x00C3: {
    model: models.HyperPollingDongle,
    is8kCompatible: true,
  },
  0x00A4: {
    model: models.DockPro,
    is8kCompatible: true,
  },
};

let tray;
let autostartEnabled;
let autolaunch;
let contextMenu;
let currentModel;
let setRate = [0, false];
let lowerRate = 500;
let defaultGamePollingRate = 1000;
let detectionMode = 'foreground';
let diagnosticLoggingEnabled = false;
let verboseDiagnosticLoggingEnabled = false;
let detectionEnabled = true;
let pickingWindow = false;
let hasStopped = false;
let stop = false;
let settingsWindow = null;
let diagnosticLogger = null;
const assetsFolder = 'src/assets/';
const checkGuard = createCheckGuard();

function getConfigDirectory() {
  return path.join(app.getPath('userData'), 'cfg');
}

function getConfigPath() {
  return path.join(getConfigDirectory(), 'config.ini');
}

function getLegacyProcessListPath() {
  return path.join(getConfigDirectory(), 'processlist.cfg');
}

function getDiagnosticLogDirectory() {
  return path.join(app.getPath('userData'), 'diagnostic-logs');
}

function ensureConfigFile() {
  fs.mkdirSync(getConfigDirectory(), { recursive: true });
  if (configExists(getConfigPath())) {
    return;
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    autostart: legacyStore.has('autostart') ? Boolean(legacyStore.get('autostart')) : DEFAULT_SETTINGS.autostart,
    detectionMode: legacyStore.get('detection_mode') === 'running' ? 'running' : DEFAULT_SETTINGS.detectionMode,
  };
  const storedLowerRate = legacyStore.has('lower_rate') ? parsePollingRate(legacyStore.get('lower_rate')) : null;
  if (storedLowerRate && storedLowerRate <= 1000) {
    settings.inactivePollingRate = storedLowerRate;
  }

  let entries = [];
  const legacyProcessListPath = getLegacyProcessListPath();
  if (fs.existsSync(legacyProcessListPath)) {
    entries = parseProcessConfig(fs.readFileSync(legacyProcessListPath, 'utf8'), {
      warn: (message) => log(message, true),
    }).entries;
  }

  writeAppConfig(getConfigPath(), settings, entries);
}

function is8kCompatible() {
  return Boolean(currentModel && currentModel.is8kCompatible);
}

function setTrayStatus(status) {
  if (!tray) {
    return;
  }

  const iconName = status.icon || 'loading.png';
  tray.setImage(nativeImage.createFromPath(path.join(appPath, assetsFolder + iconName)));
  tray.setToolTip(status.tooltip);
}

function getPollingRateIcon(pollingRate, isActive) {
  if (pollingRate === 8000) {
    return '8000a.png';
  }

  return `${pollingRate}${isActive ? 'a' : ''}.png`;
}

function getDetectionMode() {
  return detectionMode === 'foreground' ? 'foreground' : 'running';
}

function getDetectionModeLabel() {
  return getDetectionMode() === 'foreground' ? 'foreground window' : 'running processes';
}

function getCurrentSettings() {
  return {
    inactivePollingRate: lowerRate,
    defaultGamePollingRate,
    detectionMode: getDetectionMode(),
    autostart: Boolean(autostartEnabled),
    diagnosticLogging: Boolean(diagnosticLoggingEnabled),
    verboseDiagnosticLogging: Boolean(verboseDiagnosticLoggingEnabled),
  };
}

function applySettings(settings) {
  lowerRate = settings.inactivePollingRate;
  defaultGamePollingRate = settings.defaultGamePollingRate;
  detectionMode = settings.detectionMode === 'running' ? 'running' : 'foreground';
  autostartEnabled = Boolean(settings.autostart);
  diagnosticLoggingEnabled = Boolean(settings.diagnosticLogging);
  verboseDiagnosticLoggingEnabled = Boolean(settings.verboseDiagnosticLogging);
}

function loadConfig(warn = (message) => log(message, true)) {
  ensureConfigFile();
  return readAppConfig(getConfigPath(), { warn });
}

function saveConfig(settings, entries) {
  writeAppConfig(getConfigPath(), settings, entries);
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', type: 'normal', click: openSettingsWindow },
    {
      label: detectionEnabled ? 'Enabled' : 'Disabled',
      type: 'checkbox',
      checked: detectionEnabled,
      click: handleDetectionEnabled,
    },
    {
      label: pickingWindow ? 'Pick Window: press F3' : 'Pick Window (F3 in game)',
      type: 'normal',
      click: startPickWindow,
      enabled: !pickingWindow,
    },
    { label: 'Exit', type: 'normal', click: quit },
  ]);
  tray.setContextMenu(contextMenu);
}

function editorRulesFromEntries(entries) {
  return entries.map((entry) => ({
    target: entry.rawTarget || entry.executablePath || entry.rawProcessName || entry.processName,
    pollingRate: entry.pollingRate,
    isPathRule: Boolean(entry.executablePath),
  }));
}

function buildEditorConfigText(rules) {
  if (!Array.isArray(rules)) {
    throw new Error('Rules must be an array');
  }

  return rules.map((rule) => {
    const target = String(rule.target || '').trim();
    const pollingRate = String(rule.pollingRate || '').trim();
    if (!target || !pollingRate) {
      throw new Error('Each rule needs an executable and polling rate');
    }

    return `${formatRuleTarget(target)} ${pollingRate}`;
  }).join('\n');
}

function setupSettingsIpc() {
  ipcMain.handle('settings:load', () => {
    const { settings, entries, warnings } = loadConfig((message) => log(message, true));
    applySettings(settings);
    return {
      settings: getCurrentSettings(),
      rules: editorRulesFromEntries(entries),
      warnings,
    };
  });

  ipcMain.handle('settings:save', (_event, payload) => {
    try {
      const settings = {
        inactivePollingRate: parsePollingRate(payload.settings.inactivePollingRate) || DEFAULT_SETTINGS.inactivePollingRate,
        defaultGamePollingRate: parsePollingRate(payload.settings.defaultGamePollingRate) || DEFAULT_SETTINGS.defaultGamePollingRate,
        detectionMode: payload.settings.detectionMode === 'running' ? 'running' : 'foreground',
        autostart: Boolean(payload.settings.autostart),
        diagnosticLogging: Boolean(payload.settings.diagnosticLogging),
        verboseDiagnosticLogging: Boolean(payload.settings.verboseDiagnosticLogging),
      };
      if (settings.inactivePollingRate > 1000) {
        return { ok: false, warnings: ['Inactive polling rate must be 125, 250, 500, or 1000 Hz.'] };
      }

      const rules = Array.isArray(payload.rules) ? payload.rules : [];
      const text = buildEditorConfigText(rules);
      const { entries, warnings } = parseProcessConfig(text);
      if (warnings.length > 0 || entries.length !== rules.length) {
        return { ok: false, warnings };
      }

      const autostartChanged = settings.autostart !== autostartEnabled;
      applySettings(settings);
      saveConfig(getCurrentSettings(), entries);
      if (autostartChanged) {
        updateAutostart();
      }
      updateTrayMenu();
      guardedCheckPollingRate();
      return { ok: true, settings: getCurrentSettings(), rules: editorRulesFromEntries(entries), warnings: [] };
    } catch (error) {
      return { ok: false, warnings: [error.message] };
    }
  });

  ipcMain.handle('settings:browseExecutable', async () => {
    const options = {
      title: 'Choose executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe'] },
      ],
    };
    const result = settingsWindow
      ? await dialog.showOpenDialog(settingsWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('settings:openConfig', () => {
    ensureConfigFile();
    execFile('notepad.exe', [getConfigPath()], { windowsHide: false }, (error) => {
      if (error) {
        log(`failed to open config.ini: ${error.message}`, true);
      }
    });
  });

  ipcMain.handle('settings:openLogs', () => {
    fs.mkdirSync(getDiagnosticLogDirectory(), { recursive: true });
    execFile('explorer.exe', [getDiagnosticLogDirectory()], { windowsHide: false }, (error) => {
      if (error) {
        log(`failed to open diagnostic logs folder: ${error.message}`, true);
      }
    });
  });
}

app.whenReady().then(() => {
  autolaunch = new AutoLaunch({
    name: 'Razer Auto Polling Rate',
  });

  const { settings } = loadConfig((message) => log(message, true));
  applySettings(settings);
  updateAutostart();
  diagnosticLogger = new DiagnosticLogger({ logDirectory: getDiagnosticLogDirectory() });

  tray = new Tray(nativeImage.createFromPath(path.join(appPath, assetsFolder + 'loading.png')));

  tray.on('click', () => {
    tray.popUpContextMenu();
  });

  tray.setToolTip('Searching for Razer HyperPolling dongle');
  tray.setTitle('Razer auto polling rate');
  updateTrayMenu();

  runLoop();
});

setupSettingsIpc();

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregister('F3');
  stopForegroundProcessWatcher();
  if (diagnosticLogger) {
    diagnosticLogger.stop(new Date(), 'app quitting');
  }
});

async function runLoop() {
  await guardedCheckPollingRate(true);

  while (true) {
    await new Promise((res) => setTimeout(res, 1500));
    if (stop) {
      break;
    }

    await guardedCheckPollingRate();
  }

  hasStopped = true;
}

async function quit() {
  stop = true;
  while (!hasStopped) {
    await new Promise((res) => setTimeout(res, 500));
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
}

function openSettingsWindow() {
  ensureConfigFile();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 680,
    title: 'Razer Auto Polling Rate Settings',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settingsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.setMenu(null);

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
}

function updateAutostart() {
  autolaunch.isEnabled().then((enabled) => {
    if (!enabled && autostartEnabled) {
      return autolaunch.enable().then(() => setStartupApprovedEnabled(true));
    }

    if (enabled && !autostartEnabled) {
      return autolaunch.disable().then(() => setStartupApprovedEnabled(false));
    }

    if (autostartEnabled) {
      return setStartupApprovedEnabled(true);
    }

    return Promise.resolve();
  }).then(() => {
    if (autostartEnabled) {
      log('enabled autostart');
    } else {
      log('disabled autostart');
    }
  }).catch((error) => {
    log(`autostart update failed: ${error.message}`, true);
  });
}

function setStartupApprovedEnabled(enabled) {
  return new Promise((resolve, reject) => {
    const value = enabled
      ? '@(2,0,0,0,0,0,0,0,0,0,0,0)'
      : '@(3,0,0,0,0,0,0,0,0,0,0,0)';
    const command = [
      "$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'",
      'New-Item -Path $path -Force | Out-Null',
      `$bytes = [byte[]]${value}`,
      "New-ItemProperty -Path $path -Name 'Razer Auto Polling Rate.lnk' -PropertyType Binary -Value $bytes -Force | Out-Null",
    ].join('; ');

    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function handleDetectionEnabled(menuItem) {
  detectionEnabled = Boolean(menuItem.checked);
  updateTrayMenu();
  guardedCheckPollingRate();
}

function stopPickWindow() {
  pickingWindow = false;
  globalShortcut.unregister('F3');
  updateTrayMenu();
}

function startPickWindow() {
  pickingWindow = true;
  const registered = globalShortcut.register('F3', handlePickWindowShortcut);
  if (!registered) {
    pickingWindow = false;
    setTrayStatus({
      icon: 'loading.png',
      tooltip: 'Could not register F3 for window picking',
    });
    log('failed to register F3 for window picking', true);
    updateTrayMenu();
    return;
  }

  setTrayStatus({
    icon: 'loading.png',
    tooltip: `Focus the app or game, then press F3 to add it at ${defaultGamePollingRate} Hz`,
  });
  updateTrayMenu();
}

function isSameRuleTarget(left, right) {
  if (left.executablePath && right.executablePath) {
    return normalizeExecutablePath(left.executablePath) === normalizeExecutablePath(right.executablePath);
  }

  if (!left.executablePath && !right.executablePath) {
    return normalizeProcessName(left.processName) === normalizeProcessName(right.processName);
  }

  return false;
}

function createRuleEntry(target, pollingRate) {
  const text = `${formatRuleTarget(target)} ${pollingRate}`;
  const { entries, warnings } = parseProcessConfig(text);
  if (warnings.length > 0 || entries.length !== 1) {
    throw new Error(warnings[0] || `Could not add ${target}`);
  }

  return entries[0];
}

function upsertPickedRule(entries, newEntry) {
  const existingIndex = entries.findIndex((entry) => isSameRuleTarget(entry, newEntry));
  if (existingIndex === -1) {
    return [...entries, newEntry];
  }

  const updated = entries.slice();
  updated[existingIndex] = newEntry;
  return updated;
}

async function handlePickWindowShortcut() {
  if (!pickingWindow) {
    return;
  }

  try {
    const foregroundProcess = getForegroundProcessSnapshot();
    if (!foregroundProcess || !foregroundProcess.processName) {
      throw new Error('Could not identify the focused process');
    }

    const target = foregroundProcess.executablePath || foregroundProcess.processName;
    const { settings, entries } = loadConfig((message) => log(message, true));
    applySettings(settings);
    const newEntry = createRuleEntry(target, defaultGamePollingRate);
    const updatedEntries = upsertPickedRule(entries, newEntry);
    saveConfig(getCurrentSettings(), updatedEntries);
    setTrayStatus({
      icon: 'loading.png',
      tooltip: `Added ${target} at ${defaultGamePollingRate} Hz`,
    });
    stopPickWindow();
    await guardedCheckPollingRate();
  } catch (error) {
    setTrayStatus({
      icon: 'loading.png',
      tooltip: `Pick Window failed: ${error.message}`,
    });
    log(`Pick Window failed: ${error.message}`, true);
    stopPickWindow();
  }
}

async function getDongle() {
  const webUsb = new WebUSB({
    devicesFound: (devices) => devices.find((device) => device.vendorId === 0x1532 && dongles[device.productId] !== undefined),
  });

  try {
    const device = await webUsb.requestDevice({ filters: [{}] });
    if (!device) {
      throw new Error('No compatible Razer HyperPolling dongle found');
    }

    currentModel = dongles[device.productId];
    if (!currentModel) {
      throw new Error('No compatible Razer HyperPolling dongle found');
    }

    return device;
  } catch (error) {
    if (error.name === 'NotFoundError') {
      throw new Error('No compatible Razer HyperPolling dongle found');
    }

    throw error;
  }
}

async function prepareDongle(dongle) {
  await dongle.open();
  if (dongle.configuration === null) {
    await dongle.selectConfiguration(1);
  }

  const firstInterface = dongle.configuration.interfaces[0];
  await dongle.claimInterface(firstInterface.interfaceNumber);
  return firstInterface.interfaceNumber;
}

async function cleanupDongle(dongle, claimedInterfaceNumber) {
  if (!dongle) {
    return;
  }

  if (claimedInterfaceNumber !== null && claimedInterfaceNumber !== undefined) {
    try {
      await dongle.releaseInterface(claimedInterfaceNumber);
    } catch (error) {
      log(`releaseInterface failed: ${error.message}`, true);
    }
  }

  try {
    await dongle.close();
  } catch (error) {
    log(`close failed: ${error.message}`, true);
  }
}

async function getPollingRate(dongle) {
  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: 0x00,
  }, getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));

  await new Promise((res) => setTimeout(res, 100));

  const reply = await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: 0x00,
  }, 90);

  const pollingRate = getRateForReportByte(reply.data.getInt8(9));
  if (!pollingRate) {
    throw new Error('Dongle returned an unknown polling-rate response');
  }

  return pollingRate;
}

async function setPollingRate(dongle, pollingRate) {
  const resolved = resolveSupportedPollingRate(pollingRate, { is8kCompatible: is8kCompatible() });
  if (!resolved.rate) {
    throw new Error(resolved.warning);
  }

  if (resolved.warning) {
    log(resolved.warning, true);
  }

  const rate = getReportByteForRate(resolved.rate);

  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: 0x00,
  }, getRazerReport(0x1F, 0x00, 0x40, 0x02, 0x00, rate));

  await new Promise((res) => setTimeout(res, 100));

  await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: 0x00,
  }, 90);

  await new Promise((res) => setTimeout(res, 100));

  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: 0x00,
  }, getRazerReport(is8kCompatible() ? 0x1F : 0xFF, 0x00, 0x40, 0x02, 0x01, rate));

  await new Promise((res) => setTimeout(res, 100));

  await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: 0x00,
  }, 90);

  await new Promise((res) => setTimeout(res, 100));

  return getPollingRate(dongle);
}

async function guardedCheckPollingRate(firstRun) {
  const result = await checkGuard.run(() => checkPollingRate(firstRun));
  if (result.skipped) {
    log('polling check skipped because the previous check is still running');
    recordDiagnosticEvent('polling_check_skipped', {
      reason: 'previous check still running',
    }, { verbose: true });
  }
}

function describeDiscoveredProcess(processInfo) {
  if (!processInfo) {
    return null;
  }

  return processInfo.executablePath
    ? `${processInfo.processName} (${processInfo.executablePath})`
    : processInfo.processName;
}

function createInactiveSelection() {
  return {
    targetRate: lowerRate,
    matchedProcess: null,
    matchedRule: null,
  };
}

function recordDiagnosticEvent(eventName, details = {}, options = {}) {
  if (!diagnosticLogger) {
    return;
  }

  diagnosticLogger.record(eventName, details, options);
}

function updateDiagnosticSession(entries, runningProcesses, lookupError) {
  if (!diagnosticLogger) {
    return null;
  }

  if (!diagnosticLoggingEnabled) {
    diagnosticLogger.updateSession({ enabled: false });
    return null;
  }

  if (!runningProcesses) {
    recordDiagnosticEvent('running_process_lookup_failed', {
      error: lookupError ? lookupError.message : 'unknown error',
    }, {
      verbose: true,
      key: lookupError ? lookupError.message : 'unknown error',
    });
    return null;
  }

  const runningSelection = selectTargetPollingRate(entries, runningProcesses, lowerRate);
  diagnosticLogger.updateSession({
    enabled: true,
    verbose: diagnosticLoggingEnabled && verboseDiagnosticLoggingEnabled,
    runningSelection,
  });
  recordDiagnosticEvent('running_process_detection', {
    matchedProcess: runningSelection.matchedProcess || 'none',
    targetRate: runningSelection.targetRate,
  }, {
    key: `${runningSelection.matchedProcess || 'none'}:${runningSelection.targetRate}`,
  });
  recordDiagnosticEvent('running_process_scan', {
    processCount: runningProcesses.length,
  }, {
    verbose: true,
    key: String(runningProcesses.length),
  });

  return runningSelection;
}

async function checkPollingRate(firstRun) {
  let dongle;
  let claimedInterfaceNumber = null;

  try {
    const { settings, entries } = loadConfig((message) => log(message, true));
    applySettings(settings);
    const mode = getDetectionMode();
    let runningProcesses = null;
    let runningProcessesError = null;
    let foregroundProcess = null;
    let loggingSelection = null;

    if (diagnosticLoggingEnabled || (detectionEnabled && mode === 'running')) {
      try {
        runningProcesses = getRunningProcesses();
      } catch (error) {
        runningProcessesError = error;
      }
    }

    loggingSelection = updateDiagnosticSession(entries, runningProcesses, runningProcessesError);

    let selected;
    if (!detectionEnabled) {
      stopForegroundProcessWatcher();
      selected = createInactiveSelection();
    } else if (mode === 'foreground') {
      foregroundProcess = getForegroundProcess();
      selected = selectForegroundPollingRate(entries, foregroundProcess, lowerRate);
    } else {
      stopForegroundProcessWatcher();
      if (!runningProcesses) {
        if (runningProcessesError) {
          throw runningProcessesError;
        }
        runningProcesses = getRunningProcesses();
      }
      selected = selectTargetPollingRate(entries, runningProcesses, lowerRate);
    }
    const requestedTarget = selected.targetRate;

    recordDiagnosticEvent('detection_selection', {
      detectionEnabled,
      mode: detectionEnabled ? mode : 'disabled',
      foregroundProcess: describeDiscoveredProcess(foregroundProcess),
      runningMatchedProcess: loggingSelection ? loggingSelection.matchedProcess : null,
      selectedProcess: selected.matchedProcess || 'inactive',
      requestedTarget,
    }, {
      key: [
        detectionEnabled ? mode : 'disabled',
        describeDiscoveredProcess(foregroundProcess) || 'none',
        loggingSelection ? loggingSelection.matchedProcess : 'none',
        selected.matchedProcess || 'inactive',
        requestedTarget,
      ].join('|'),
    });
    dongle = await getDongle();
    claimedInterfaceNumber = await prepareDongle(dongle);

    let pollingRate = await getPollingRate(dongle);
    const resolvedTarget = resolveSupportedPollingRate(requestedTarget, { is8kCompatible: is8kCompatible() });
    if (!resolvedTarget.rate) {
      throw new Error(resolvedTarget.warning);
    }

    if (resolvedTarget.warning) {
      log(resolvedTarget.warning, true);
    }

    const targetRate = resolvedTarget.rate;
    const matchedText = selected.matchedProcess ? `matched ${selected.matchedProcess}` : 'inactive';
    const modeText = detectionEnabled ? getDetectionModeLabel() : 'detection disabled';

    recordDiagnosticEvent('polling_check', {
      firstRun: Boolean(firstRun),
      detectionEnabled,
      mode: detectionEnabled ? mode : 'disabled',
      foregroundProcess: describeDiscoveredProcess(foregroundProcess),
      runningMatchedProcess: loggingSelection ? loggingSelection.matchedProcess : null,
      selectedProcess: selected.matchedProcess || 'inactive',
      currentRate: pollingRate,
      targetRate,
      requestedTarget,
      rules: entries.length,
    }, { verbose: true });

    recordDiagnosticEvent('polling_status', {
      currentRate: pollingRate,
      targetRate,
      requestedTarget,
      matchedProcess: selected.matchedProcess || 'inactive',
    }, {
      key: `${pollingRate}:${targetRate}:${selected.matchedProcess || 'inactive'}`,
    });

    if (firstRun) {
      const active = Boolean(selected.matchedProcess && pollingRate === targetRate);
      setTrayStatus({
        icon: getPollingRateIcon(pollingRate, active),
        tooltip: `Current ${pollingRate} Hz; target ${targetRate} Hz; ${modeText}; ${matchedText}`,
      });
    }

    if (targetRate !== pollingRate) {
      recordDiagnosticEvent('polling_rate_change_requested', {
        from: pollingRate,
        to: targetRate,
        matchedProcess: selected.matchedProcess || 'inactive',
      });
      pollingRate = await setPollingRate(dongle, targetRate);
      recordDiagnosticEvent('polling_rate_change_result', {
        currentRate: pollingRate,
        targetRate,
      });
    }

    const isActive = Boolean(selected.matchedProcess && pollingRate === targetRate);
    if (setRate[0] !== pollingRate || setRate[1] !== isActive) {
      if (pollingRate !== targetRate) {
        setTrayStatus({
          icon: 'loading.png',
          tooltip: `Failed to set target ${targetRate} Hz; current ${pollingRate} Hz; ${modeText}; ${matchedText}`,
        });
        setRate = [0, false];
      } else {
        setTrayStatus({
          icon: getPollingRateIcon(pollingRate, isActive),
          tooltip: `Current ${pollingRate} Hz; target ${targetRate} Hz; ${modeText}; ${matchedText}`,
        });
        setRate = [pollingRate, isActive];
      }
    }
  } catch (error) {
    recordDiagnosticEvent('polling_check_error', {
      error: error.message,
    });
    setTrayStatus({
      icon: 'loading.png',
      tooltip: `Razer Auto Polling Rate error: ${error.message}`,
    });
    setRate = [0, false];
    console.error(error);
    log(error.toString(), true);
  } finally {
    await cleanupDongle(dongle, claimedInterfaceNumber);
  }
}
