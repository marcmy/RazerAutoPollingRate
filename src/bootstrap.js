const path = require('path');
const { pathToFileURL } = require('url');
const { app } = require('electron');

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
