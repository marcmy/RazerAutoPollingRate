if (require('electron-squirrel-startup')) return;

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, nativeImage } = require('electron');

const { acquireSingleInstanceLock } = require('./lib/singleInstance');
const { runCrazyLightProbe } = require('./lib/mouseBackends/startupProbe');
const { installPollingRateIconColorizer } = require('./lib/trayIcons');

if (!acquireSingleInstanceLock(app)) return;

installPollingRateIconColorizer(nativeImage);

const settingsUrl = pathToFileURL(path.join(__dirname, 'settings.html')).href;

app.on('web-contents-created', (_event, webContents) => {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== settingsUrl) {
      event.preventDefault();
    }
  });
});

function logCrazyLightProbe(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'pulsar-probe.log'), `${line}\n`);
  } catch (error) {
    console.error(`[Pulsar probe] Could not write probe log: ${error.message}`);
  }
}

app.whenReady().then(() => runCrazyLightProbe({
  log: logCrazyLightProbe,
})).catch((error) => {
  logCrazyLightProbe(`[Pulsar probe] Startup probe failed: ${error.message}`);
});

require('./main');
