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
const { dongles } = require('./lib/devices');
const { DiagnosticLogger } = require('./lib/diagnosticLogger');
const { retryImmediately } = require('./lib/retryImmediately');
const {
  DEFAULT_SETTINGS,
  configExists,
  normalizePollingCheckIntervalMs,
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
  discoverGameLibraries,
  gameForExecutable,
  normalizeWindowsPath,
  scanLibraryGames,
} = require('./lib/gameLibraries');
const {
  getForegroundProcess,
  getForegroundProcessSnapshot,
  getRunningProcesses,
  stopForegroundProcessWatcher,
} = require('./lib/processDiscovery');
const {
  ruleNeedsRunningProcesses,
  selectConfiguredPollingRate,
  selectTargetPollingRate,
} = require('./lib/processes');
const {
  getRateForReportByte,
  getReportByteForRate,
  parsePollingRate,
  resolveSupportedPollingRate,
} = require('./lib/rates');
const { getRazerReport } = require('./lib/razerReports');

const appPath = app.getAppPath();
const legacyStore = new Store();
const assetsFolder = 'src/assets/';
const checkGuard = createCheckGuard();

let tray;
let autostartEnabled;
let autolaunch;
let contextMenu;
let currentModel;
let setRate = [0, false];
let lowerRate = 500;
let defaultGamePollingRate = 1000;
let detectionMode = 'foreground';
let autoDetectGames = true;
let diagnosticLoggingEnabled = false;
let verboseDiagnosticLoggingEnabled = false;
let pollingCheckIntervalMs = DEFAULT_SETTINGS.pollingCheckIntervalMs;
let detectionEnabled = true;
let pickingWindow = false;
let hasStopped = false;
let stop = false;
let settingsWindow = null;
let diagnosticLogger = null;
let lastPollingError = null;
let gameLibraries = [];
let scannedGames = [];
let libraryConfigurationKey = '';
let runtimeStatus = {
  enabled: true,
  processName: null,
  executablePath: null,
  matchedProcess: null,
  source: 'inactive',
  detectionMode: null,
  requestedTarget: lowerRate,
  targetRate: lowerRate,
  currentRate: null,
  gameId: null,
  gameName: null,
  provider: null,
  error: null,
};

function log(out, error = false) {
  const date = new Date().toLocaleTimeString('en-US', { hour12: false, hour: 'numeric', minute: 'numeric' });
  fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[ ${date} ] ${error ? 'ERROR: ' : 'LOG: '}${out}\n`);
}

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

  writeAppConfig(getConfigPath(), settings, entries, []);
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
  return detectionMode === 'running' ? 'running' : 'foreground';
}

function getDetectionModeLabel(mode = getDetectionMode()) {
  return mode === 'running' ? 'running processes' : 'foreground window';
}

function getCurrentSettings() {
  return {
    inactivePollingRate: lowerRate,
    defaultGamePollingRate,
    detectionMode: getDetectionMode(),
    autoDetectGames: Boolean(autoDetectGames),
    autostart: Boolean(autostartEnabled),
    diagnosticLogging: Boolean(diagnosticLoggingEnabled),
    verboseDiagnosticLogging: Boolean(verboseDiagnosticLoggingEnabled),
    pollingCheckIntervalMs,
  };
}

function applySettings(settings) {
  lowerRate = settings.inactivePollingRate;
  defaultGamePollingRate = settings.defaultGamePollingRate;
  detectionMode = settings.detectionMode === 'running' ? 'running' : 'foreground';
  autoDetectGames = settings.autoDetectGames !== false;
  autostartEnabled = Boolean(settings.autostart);
  diagnosticLoggingEnabled = Boolean(settings.diagnosticLogging);
  verboseDiagnosticLoggingEnabled = Boolean(settings.verboseDiagnosticLogging);
  pollingCheckIntervalMs = settings.pollingCheckIntervalMs || DEFAULT_SETTINGS.pollingCheckIntervalMs;
}

function loadConfig(warn = (message) => log(message, true)) {
  ensureConfigFile();
  return readAppConfig(getConfigPath(), { warn });
}

function saveConfig(settings, entries, gameFolders = []) {
  writeAppConfig(getConfigPath(), settings, entries, gameFolders);
}

function buildLibraryConfigurationKey(settings, gameFolders) {
  return JSON.stringify({
    auto: settings.autoDetectGames !== false,
    folders: (gameFolders || []).map(normalizeWindowsPath),
  });
}

function syncGameLibraries(settings, gameFolders, force = false) {
  const key = buildLibraryConfigurationKey(settings, gameFolders);
  if (!force && key === libraryConfigurationKey) {
    return;
  }

  gameLibraries = discoverGameLibraries({
    customFolders: gameFolders,
    includeKnown: settings.autoDetectGames !== false,
  });
  libraryConfigurationKey = key;
}

function rescanGames(settings, gameFolders) {
  syncGameLibraries(settings, gameFolders, true);
  scannedGames = scanLibraryGames(gameLibraries);
  return scannedGames;
}

function rememberDetectedGame(game) {
  if (!game || !game.executablePath) {
    return;
  }

  const key = normalizeWindowsPath(game.executablePath);
  const existingIndex = scannedGames.findIndex((item) => normalizeWindowsPath(item.executablePath) === key);
  if (existingIndex >= 0) {
    scannedGames[existingIndex] = { ...scannedGames[existingIndex], ...game };
  } else {
    scannedGames.push(game);
  }
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
    pollingRate: entry.usesDefaultPollingRate ? null : entry.pollingRate,
    detectionMode: entry.detectionMode || 'default',
    isPathRule: Boolean(entry.executablePath),
  }));
}

function buildEditorConfigText(rules) {
  if (!Array.isArray(rules)) {
    throw new Error('Rules must be an array');
  }

  return rules.map((rule) => {
    const target = String(rule.target || '').trim();
    const pollingRate = rule.pollingRate === null || rule.pollingRate === 'default'
      ? 'default'
      : String(rule.pollingRate || '').trim();
    const mode = ['foreground', 'running'].includes(rule.detectionMode)
      ? rule.detectionMode
      : 'default';
    if (!target || !pollingRate) {
      throw new Error('Each game override needs an executable and polling rate');
    }

    return `${formatRuleTarget(target)} ${pollingRate}${mode === 'default' ? '' : ` ${mode}`}`;
  }).join('\n');
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

function createRuleEntry(target, pollingRate, perGameDetectionMode = 'default') {
  const suffix = perGameDetectionMode === 'foreground' || perGameDetectionMode === 'running'
    ? ` ${perGameDetectionMode}`
    : '';
  const rateValue = pollingRate === null || pollingRate === 'default' ? 'default' : pollingRate;
  const text = `${formatRuleTarget(target)} ${rateValue}${suffix}`;
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

function getFriendlyRuleName(rule) {
  const target = String(rule.target || '').trim();
  if (/^[a-z]:\\/i.test(target)) {
    let directory = path.win32.dirname(target);
    const generic = /^(?:win64|win32|x64|x86|binaries|bin)$/i;
    while (generic.test(path.win32.basename(directory))) {
      directory = path.win32.dirname(directory);
    }
    const folderName = path.win32.basename(directory);
    if (folderName) {
      return folderName;
    }
  }

  return path.win32.basename(target, path.win32.extname(target)) || target || 'Game';
}

function ruleMatchesGame(rule, game) {
  const target = String(rule.target || '').trim();
  if (!target || !game) {
    return false;
  }

  if (/^[a-z]:\\/i.test(target) && game.executablePath) {
    return normalizeWindowsPath(target) === normalizeWindowsPath(game.executablePath);
  }

  const processName = path.win32.basename(target).toLowerCase();
  return Boolean(game.processName) && processName === String(game.processName).toLowerCase();
}

async function getExecutableIconDataUrl(executablePath) {
  if (!executablePath || !fs.existsSync(executablePath)) {
    return null;
  }

  try {
    const image = await app.getFileIcon(executablePath, { size: 'large' });
    return image && !image.isEmpty() ? image.toDataURL() : null;
  } catch {
    return null;
  }
}

async function buildGameCards(entries) {
  const rules = editorRulesFromEntries(entries);
  const cards = [];
  const usedRules = new Set();

  for (const game of scannedGames) {
    const overrideIndex = rules.findIndex((rule, index) => !usedRules.has(index) && ruleMatchesGame(rule, game));
    const override = overrideIndex >= 0 ? rules[overrideIndex] : null;
    if (overrideIndex >= 0) {
      usedRules.add(overrideIndex);
    }

    cards.push({
      ...game,
      kind: 'auto',
      customized: Boolean(override),
      pollingRate: override ? override.pollingRate : null,
      detectionMode: override ? override.detectionMode : 'default',
      overrideTarget: override ? override.target : null,
      iconDataUrl: await getExecutableIconDataUrl(game.executablePath),
    });
  }

  for (let index = 0; index < rules.length; index += 1) {
    if (usedRules.has(index)) {
      continue;
    }

    const rule = rules[index];
    const executablePath = /^[a-z]:\\/i.test(rule.target) ? rule.target : null;
    cards.push({
      id: `manual:${normalizeProcessName(rule.target)}`,
      name: getFriendlyRuleName(rule),
      source: 'Manual',
      provider: 'manual',
      gameRoot: executablePath ? path.win32.dirname(executablePath) : null,
      executablePath,
      processName: path.win32.basename(rule.target),
      autoDetected: false,
      kind: 'manual',
      customized: true,
      pollingRate: rule.pollingRate,
      detectionMode: rule.detectionMode || 'default',
      overrideTarget: rule.target,
      iconDataUrl: await getExecutableIconDataUrl(executablePath),
    });
  }

  cards.sort((left, right) => left.name.localeCompare(right.name));
  return cards;
}

function getRuntimeStatus() {
  return {
    ...runtimeStatus,
    enabled: detectionEnabled,
  };
}

function setupSettingsIpc() {
  ipcMain.handle('settings:load', async () => {
    const {
      settings,
      entries,
      gameFolders,
      warnings,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    rescanGames(settings, gameFolders);

    return {
      appVersion: app.getVersion(),
      settings: getCurrentSettings(),
      rules: editorRulesFromEntries(entries),
      gameFolders,
      libraries: gameLibraries,
      games: await buildGameCards(entries),
      runtime: getRuntimeStatus(),
      warnings,
    };
  });

  ipcMain.handle('settings:save', async (_event, payload) => {
    try {
      const settings = {
        inactivePollingRate: parsePollingRate(payload.settings.inactivePollingRate) || DEFAULT_SETTINGS.inactivePollingRate,
        defaultGamePollingRate: parsePollingRate(payload.settings.defaultGamePollingRate) || DEFAULT_SETTINGS.defaultGamePollingRate,
        detectionMode: payload.settings.detectionMode === 'running' ? 'running' : 'foreground',
        autoDetectGames: payload.settings.autoDetectGames !== false,
        autostart: Boolean(payload.settings.autostart),
        diagnosticLogging: Boolean(payload.settings.diagnosticLogging),
        verboseDiagnosticLogging: Boolean(payload.settings.verboseDiagnosticLogging),
        pollingCheckIntervalMs: normalizePollingCheckIntervalMs(payload.settings.pollingCheckIntervalMs),
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

      const gameFolders = Array.isArray(payload.gameFolders)
        ? payload.gameFolders.map((folder) => String(folder || '').trim()).filter(Boolean)
        : [];
      const autostartChanged = settings.autostart !== autostartEnabled;
      applySettings(settings);
      saveConfig(getCurrentSettings(), entries, gameFolders);
      syncGameLibraries(settings, gameFolders, true);

      if (autostartChanged) {
        updateAutostart();
      }

      updateTrayMenu();
      guardedCheckPollingRate();
      return {
        ok: true,
        settings: getCurrentSettings(),
        rules: editorRulesFromEntries(entries),
        gameFolders,
        warnings: [],
      };
    } catch (error) {
      return { ok: false, warnings: [error.message] };
    }
  });

  ipcMain.handle('settings:rescanLibraries', async () => {
    const {
      settings,
      entries,
      gameFolders,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    rescanGames(settings, gameFolders);
    return {
      libraries: gameLibraries,
      games: await buildGameCards(entries),
    };
  });

  ipcMain.handle('settings:getRuntimeStatus', () => getRuntimeStatus());

  ipcMain.handle('settings:browseExecutable', async () => {
    const options = {
      title: 'Choose game executable',
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe'] }],
    };
    const result = settingsWindow
      ? await dialog.showOpenDialog(settingsWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const executablePath = result.filePaths[0];
    return {
      path: executablePath,
      processName: path.win32.basename(executablePath),
      name: getFriendlyRuleName({ target: executablePath }),
      iconDataUrl: await getExecutableIconDataUrl(executablePath),
    };
  });

  ipcMain.handle('settings:browseFolder', async () => {
    const options = {
      title: 'Choose game library folder',
      properties: ['openDirectory'],
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
  autolaunch = new AutoLaunch({ name: 'Razer Auto Polling Rate' });

  const { settings, gameFolders } = loadConfig((message) => log(message, true));
  applySettings(settings);
  syncGameLibraries(settings, gameFolders, true);
  updateAutostart();
  diagnosticLogger = new DiagnosticLogger({ logDirectory: getDiagnosticLogDirectory() });

  tray = new Tray(nativeImage.createFromPath(path.join(appPath, assetsFolder + 'loading.png')));
  tray.on('click', () => tray.popUpContextMenu());
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
    await new Promise((resolve) => setTimeout(resolve, pollingCheckIntervalMs));
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
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
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
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
    log(autostartEnabled ? 'enabled autostart' : 'disabled autostart');
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
    setTrayStatus({ icon: 'loading.png', tooltip: 'Could not register F3 for window picking' });
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
    const {
      settings,
      entries,
      gameFolders,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    const newEntry = createRuleEntry(target, defaultGamePollingRate);
    const updatedEntries = upsertPickedRule(entries, newEntry);
    saveConfig(getCurrentSettings(), updatedEntries, gameFolders);
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
    devicesFound: (devices) => devices.find((device) => device.vendorId === 0x1532
      && dongles[device.productId] !== undefined),
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

  const targetIndex = currentModel.interfaceIndex !== undefined ? currentModel.interfaceIndex : 0x00;
  const targetInterface = dongle.configuration.interfaces.find((item) => item.interfaceNumber === targetIndex)
    || dongle.configuration.interfaces[0];

  await dongle.claimInterface(targetInterface.interfaceNumber);
  return targetInterface.interfaceNumber;
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

async function getPollingRateOnce(dongle) {
  const targetIndex = currentModel.interfaceIndex !== undefined ? currentModel.interfaceIndex : 0x00;

  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: targetIndex,
  }, getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));

  await new Promise((resolve) => setTimeout(resolve, 100));

  const reply = await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: targetIndex,
  }, 90);

  const responseLength = reply && reply.data ? reply.data.byteLength : 0;
  if (!reply || !reply.data || responseLength <= 9) {
    throw new Error(`Dongle returned a short polling-rate response (${responseLength} bytes)`);
  }

  const responseByte = reply.data.getUint8(9);
  const pollingRate = getRateForReportByte(responseByte);
  if (!pollingRate) {
    throw new Error(
      `Dongle returned an unknown polling-rate response (byte 0x${responseByte.toString(16).padStart(2, '0')}, length ${responseLength})`,
    );
  }

  return pollingRate;
}

async function getPollingRate(dongle) {
  return retryImmediately(() => getPollingRateOnce(dongle), {
    attempts: 3,
    onFailure: (error, attempt, attempts) => {
      recordDiagnosticEvent('polling_rate_query_attempt_failed', {
        attempt,
        attempts,
        error: error.message,
      }, { verbose: true });
    },
  });
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
  const targetIndex = currentModel.interfaceIndex !== undefined ? currentModel.interfaceIndex : 0x00;

  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: targetIndex,
  }, getRazerReport(0x1F, 0x00, 0x40, 0x02, 0x00, rate));

  await new Promise((resolve) => setTimeout(resolve, 100));
  await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: targetIndex,
  }, 90);

  await new Promise((resolve) => setTimeout(resolve, 100));
  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: targetIndex,
  }, getRazerReport(is8kCompatible() ? 0x1F : 0xFF, 0x00, 0x40, 0x02, 0x01, rate));

  await new Promise((resolve) => setTimeout(resolve, 100));
  await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: targetIndex,
  }, 90);

  await new Promise((resolve) => setTimeout(resolve, 100));
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
    matchedDetectionMode: null,
    source: 'inactive',
    game: null,
  };
}

function recordDiagnosticEvent(eventName, details = {}, options = {}) {
  if (diagnosticLogger) {
    diagnosticLogger.record(eventName, details, options);
  }
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

  const runningSelection = selectTargetPollingRate(entries, runningProcesses, lowerRate, defaultGamePollingRate);
  diagnosticLogger.updateSession({
    enabled: true,
    verbose: diagnosticLoggingEnabled && verboseDiagnosticLoggingEnabled,
    runningSelection,
  });
  return runningSelection;
}

function selectCurrentPollingRate(entries, foregroundProcess, runningProcesses) {
  const configured = selectConfiguredPollingRate(entries, {
    foregroundProcess,
    runningProcesses,
    defaultDetectionMode: getDetectionMode(),
    inactivePollingRate: lowerRate,
    defaultGamePollingRate,
  });

  if (configured.matchedRule) {
    return { ...configured, game: null };
  }

  if (foregroundProcess && foregroundProcess.executablePath && gameLibraries.length > 0) {
    const game = gameForExecutable(foregroundProcess.executablePath, gameLibraries);
    if (game) {
      rememberDetectedGame(game);
      return {
        targetRate: defaultGamePollingRate,
        matchedProcess: foregroundProcess.processName || foregroundProcess.executablePath,
        matchedRule: null,
        matchedDetectionMode: 'foreground',
        source: 'library',
        game,
      };
    }
  }

  return createInactiveSelection();
}

function updateRuntimeSelection(selected, foregroundProcess, requestedTarget) {
  runtimeStatus = {
    ...runtimeStatus,
    enabled: detectionEnabled,
    processName: foregroundProcess ? foregroundProcess.processName : null,
    executablePath: foregroundProcess ? foregroundProcess.executablePath : null,
    matchedProcess: selected.matchedProcess,
    source: selected.source,
    detectionMode: selected.matchedDetectionMode,
    requestedTarget,
    targetRate: requestedTarget,
    gameId: selected.game ? selected.game.id : null,
    gameName: selected.game ? selected.game.name : null,
    provider: selected.game ? selected.game.provider : null,
    error: null,
  };
}

async function checkPollingRate(firstRun) {
  let dongle;
  let claimedInterfaceNumber = null;

  try {
    const {
      settings,
      entries,
      gameFolders,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    syncGameLibraries(settings, gameFolders);

    let runningProcesses = null;
    let runningProcessesError = null;
    let foregroundProcess = null;

    if (!detectionEnabled) {
      stopForegroundProcessWatcher();
    } else {
      foregroundProcess = getForegroundProcess();
    }

    const needsRunningProcesses = diagnosticLoggingEnabled
      || (detectionEnabled && entries.some((entry) => ruleNeedsRunningProcesses(entry, getDetectionMode())));

    if (needsRunningProcesses) {
      try {
        runningProcesses = getRunningProcesses();
      } catch (error) {
        runningProcessesError = error;
      }
    }

    const loggingSelection = updateDiagnosticSession(entries, runningProcesses, runningProcessesError);
    let selected;

    if (!detectionEnabled) {
      selected = createInactiveSelection();
    } else {
      if (needsRunningProcesses && !runningProcesses && runningProcessesError) {
        const requiredForMatching = entries.some((entry) => ruleNeedsRunningProcesses(entry, getDetectionMode()));
        if (requiredForMatching) {
          throw runningProcessesError;
        }
      }

      selected = selectCurrentPollingRate(entries, foregroundProcess, runningProcesses || []);
    }

    const requestedTarget = selected.targetRate;
    updateRuntimeSelection(selected, foregroundProcess, requestedTarget);

    recordDiagnosticEvent('detection_selection', {
      detectionEnabled,
      defaultMode: detectionEnabled ? getDetectionMode() : 'disabled',
      matchedMode: selected.matchedDetectionMode,
      source: selected.source,
      foregroundProcess: describeDiscoveredProcess(foregroundProcess),
      runningMatchedProcess: loggingSelection ? loggingSelection.matchedProcess : null,
      selectedProcess: selected.matchedProcess || 'inactive',
      requestedTarget,
      game: selected.game ? selected.game.name : null,
    }, {
      key: [
        detectionEnabled ? getDetectionMode() : 'disabled',
        selected.matchedDetectionMode || 'none',
        selected.source,
        selected.matchedProcess || 'inactive',
        requestedTarget,
      ].join('|'),
    });

    if (!detectionEnabled) {
      runtimeStatus.currentRate = null;
      recordDiagnosticEvent('usb_access_decision', {
        access: false,
        reason: 'disabled',
        requestedTarget,
      }, { verbose: true });
      return;
    }

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
    runtimeStatus.targetRate = targetRate;
    runtimeStatus.currentRate = pollingRate;

    const matchedText = selected.matchedProcess
      ? (selected.game ? `game ${selected.game.name}` : `matched ${selected.matchedProcess}`)
      : 'inactive';
    const modeText = selected.matchedDetectionMode
      ? getDetectionModeLabel(selected.matchedDetectionMode)
      : (detectionEnabled ? getDetectionModeLabel() : 'detection disabled');

    recordDiagnosticEvent('polling_check', {
      firstRun: Boolean(firstRun),
      detectionEnabled,
      defaultMode: getDetectionMode(),
      matchedMode: selected.matchedDetectionMode,
      source: selected.source,
      currentRate: pollingRate,
      targetRate,
      requestedTarget,
      rules: entries.length,
      libraries: gameLibraries.length,
    }, { verbose: true });

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
      runtimeStatus.currentRate = pollingRate;
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

    lastPollingError = null;
    runtimeStatus.error = null;
  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    setRate = [0, false];
    runtimeStatus.error = errorMessage;

    if (lastPollingError !== errorMessage) {
      recordDiagnosticEvent('polling_check_error', { error: errorMessage });
      setTrayStatus({
        icon: 'loading.png',
        tooltip: `Razer Auto Polling Rate error: ${errorMessage}`,
      });
      console.error(error);
      log(error.toString(), true);
      lastPollingError = errorMessage;
    }
  } finally {
    await cleanupDongle(dongle, claimedInterfaceNumber);
  }
}
