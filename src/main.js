if (require('electron-squirrel-startup')) return;

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require('electron');

const { WebUSB } = require('usb');
const fs = require('fs');
const Store = require('electron-store');
const path = require('path');
const AutoLaunch = require('auto-launch');

const { createCheckGuard } = require('./lib/checkGuard');
const { formatRuleTarget, parseProcessConfig } = require('./lib/config');
const { getForegroundProcess, getRunningProcesses } = require('./lib/processDiscovery');
const { selectForegroundPollingRate, selectTargetPollingRate } = require('./lib/processes');
const {
  getRateForReportByte,
  getReportByteForRate,
  parsePollingRate,
  resolveSupportedPollingRate,
} = require('./lib/rates');
const { getRazerReport } = require('./lib/razerReports');
const { readRules, writeRules } = require('./lib/ruleStore');

const appPath = app.getAppPath();
const store = new Store();

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
let detectionMode = 'foreground';
let hasStopped = false;
let stop = false;
let ruleEditorWindow = null;
const assetsFolder = 'src/assets/';
const checkGuard = createCheckGuard();

function getConfigDirectory() {
  return path.join(app.getPath('userData'), 'cfg');
}

function getProcessListPath() {
  return path.join(getConfigDirectory(), 'processlist.cfg');
}

function ensureConfigFile() {
  fs.mkdirSync(getConfigDirectory(), { recursive: true });
  fs.closeSync(fs.openSync(getProcessListPath(), 'a'));
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

function handleContextMenu() {
  contextMenu.items[0].submenu.items.forEach((item) => {
    item.enabled = parseInt(item.label, 10) < 8000;
  });
}

function getDetectionMode() {
  return detectionMode === 'foreground' ? 'foreground' : 'running';
}

function getDetectionModeLabel() {
  return getDetectionMode() === 'foreground' ? 'foreground window' : 'running processes';
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

function setupRuleEditorIpc() {
  ipcMain.handle('rules:load', () => {
    ensureConfigFile();
    const { entries, warnings } = readRules(getProcessListPath(), (message) => log(message, true));
    return { rules: editorRulesFromEntries(entries), warnings };
  });

  ipcMain.handle('rules:save', (_event, rules) => {
    try {
      const text = buildEditorConfigText(rules);
      const { entries, warnings } = parseProcessConfig(text);
      if (warnings.length > 0 || entries.length !== rules.length) {
        return { ok: false, warnings };
      }

      writeRules(getProcessListPath(), entries);
      return { ok: true, rules: editorRulesFromEntries(entries), warnings: [] };
    } catch (error) {
      return { ok: false, warnings: [error.message] };
    }
  });

  ipcMain.handle('rules:browse', async () => {
    const options = {
      title: 'Choose executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe'] },
      ],
    };
    const result = ruleEditorWindow
      ? await dialog.showOpenDialog(ruleEditorWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
}

app.whenReady().then(() => {
  if (!store.has('autostart')) {
    store.set('autostart', true);
  }

  if (!store.has('detection_mode')) {
    store.set('detection_mode', 'foreground');
  }

  autostartEnabled = store.get('autostart');
  detectionMode = store.get('detection_mode') === 'foreground' ? 'foreground' : 'running';

  autolaunch = new AutoLaunch({
    name: 'Razer Auto Polling Rate',
  });

  updateAutostart();

  if (store.has('lower_rate')) {
    const storedLowerRate = parsePollingRate(store.get('lower_rate'));
    if (storedLowerRate && storedLowerRate <= 1000) {
      lowerRate = storedLowerRate;
    }
  }

  ensureConfigFile();

  contextMenu = Menu.buildFromTemplate([
    {
      label: 'Inactive polling rate',
      type: 'submenu',
      submenu: [
        { label: '125hz', type: 'radio', click: handleInactive, checked: lowerRate === 125 },
        { label: '250hz', type: 'radio', click: handleInactive, checked: lowerRate === 250 },
        { label: '500hz', type: 'radio', click: handleInactive, checked: lowerRate === 500 },
        { label: '1000hz', type: 'radio', click: handleInactive, checked: lowerRate === 1000 },
      ],
    },
    {
      label: 'Detection mode',
      type: 'submenu',
      submenu: [
        { label: 'Running processes', type: 'radio', click: () => handleDetectionMode('running'), checked: detectionMode === 'running' },
        { label: 'Foreground window', type: 'radio', click: () => handleDetectionMode('foreground'), checked: detectionMode === 'foreground' },
      ],
    },
    { label: 'Edit polling rules', type: 'normal', click: openRuleEditor },
    { label: 'Open config folder', type: 'normal', click: openProcessList },
    { label: 'Autostart', type: 'checkbox', click: handleAutostart, checked: autostartEnabled },
    { label: 'Quit', type: 'normal', click: quit },
  ]);

  handleContextMenu();

  tray = new Tray(nativeImage.createFromPath(path.join(appPath, assetsFolder + 'loading.png')));

  tray.on('click', () => {
    tray.popUpContextMenu();
  });

  tray.setToolTip('Searching for Razer HyperPolling dongle');
  tray.setTitle('Razer auto polling rate');
  tray.setContextMenu(contextMenu);

  runLoop();
});

setupRuleEditorIpc();

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

async function runLoop() {
  await guardedCheckPollingRate(true);

  while (true) {
    await new Promise((res) => setTimeout(res, 3000));
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

function openProcessList() {
  shell.openPath(getConfigDirectory());
}

function openRuleEditor() {
  ensureConfigFile();
  if (ruleEditorWindow && !ruleEditorWindow.isDestroyed()) {
    ruleEditorWindow.focus();
    return;
  }

  ruleEditorWindow = new BrowserWindow({
    width: 840,
    height: 560,
    title: 'Polling rules',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'ruleEditorPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ruleEditorWindow.setMenu(null);

  ruleEditorWindow.once('ready-to-show', () => {
    ruleEditorWindow.show();
  });
  ruleEditorWindow.on('closed', () => {
    ruleEditorWindow = null;
  });
  ruleEditorWindow.loadFile(path.join(__dirname, 'ruleEditor.html'));
}

function updateAutostart() {
  store.set('autostart', autostartEnabled);
  autolaunch.isEnabled().then((enabled) => {
    if (!enabled && autostartEnabled) {
      autolaunch.enable();
      log('enabled autostart');
    } else if (enabled && !autostartEnabled) {
      autolaunch.disable();
      log('disabled autostart');
    }
  }).catch((error) => {
    log(`autostart update failed: ${error.message}`, true);
  });
}

function handleAutostart(menuItem) {
  autostartEnabled = menuItem.checked;
  updateAutostart();
}

function handleInactive(menuItem) {
  lowerRate = parseInt(menuItem.label, 10);
  store.set('lower_rate', lowerRate);
  handleContextMenu();
}

function handleDetectionMode(mode) {
  detectionMode = mode === 'foreground' ? 'foreground' : 'running';
  store.set('detection_mode', detectionMode);
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
  }
}

async function checkPollingRate(firstRun) {
  let dongle;
  let claimedInterfaceNumber = null;

  try {
    ensureConfigFile();

    const { entries } = readRules(getProcessListPath(), (message) => log(message, true));
    const mode = getDetectionMode();
    const selected = mode === 'foreground'
      ? selectForegroundPollingRate(entries, getForegroundProcess(), lowerRate)
      : selectTargetPollingRate(entries, getRunningProcesses(), lowerRate);
    const requestedTarget = selected.targetRate;

    dongle = await getDongle();
    claimedInterfaceNumber = await prepareDongle(dongle);

    const resolvedTarget = resolveSupportedPollingRate(requestedTarget, { is8kCompatible: is8kCompatible() });
    if (!resolvedTarget.rate) {
      throw new Error(resolvedTarget.warning);
    }

    if (resolvedTarget.warning) {
      log(resolvedTarget.warning, true);
    }

    let pollingRate = await getPollingRate(dongle);
    const targetRate = resolvedTarget.rate;
    const matchedText = selected.matchedProcess ? `matched ${selected.matchedProcess}` : 'inactive';
    const modeText = getDetectionModeLabel();

    if (firstRun) {
      const active = Boolean(selected.matchedProcess && pollingRate === targetRate);
      setTrayStatus({
        icon: getPollingRateIcon(pollingRate, active),
        tooltip: `Current ${pollingRate} Hz; target ${targetRate} Hz; ${modeText}; ${matchedText}`,
      });
    }

    if (targetRate !== pollingRate) {
      pollingRate = await setPollingRate(dongle, targetRate);
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
