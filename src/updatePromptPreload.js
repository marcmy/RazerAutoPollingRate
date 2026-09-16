'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updatePrompt', {
  choose(action) {
    if (action === 'install' || action === 'later') {
      ipcRenderer.send('update-prompt-action', action);
    }
  },
});
