if (require('electron-squirrel-startup')) return;

const path = require('path');
const { pathToFileURL } = require('url');
const { app, nativeImage } = require('electron');

const { acquireSingleInstanceLock } = require('./lib/singleInstance');
const { installPollingRateIconColorizer } = require('./lib/trayIcons');

if (!acquireSingleInstanceLock(app)) return;

installPollingRateIconColorizer(nativeImage);

const allowedPageUrls = new Set([
  'settings.html',
  'updateProgress.html',
  'updateChangelog.html',
].map((fileName) => pathToFileURL(path.join(__dirname, fileName)).href));

app.on('web-contents-created', (_event, webContents) => {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, navigationUrl) => {
    if (!allowedPageUrls.has(navigationUrl)) {
      event.preventDefault();
    }
  });
});

require('./main');
