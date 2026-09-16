'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateChangelog', {
  openFullChangelog() {
    ipcRenderer.send('update-changelog-open-full');
  },
});
