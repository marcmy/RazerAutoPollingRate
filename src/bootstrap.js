if (require('electron-squirrel-startup')) return;

const path = require('path');
const { pathToFileURL } = require('url');
const { app, nativeImage } = require('electron');

const { acquireSingleInstanceLock } = require('./lib/singleInstance');
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

require('./main');
