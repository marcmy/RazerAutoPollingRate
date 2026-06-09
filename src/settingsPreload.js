const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (payload) => ipcRenderer.invoke('settings:save', payload),
  browseExecutable: () => ipcRenderer.invoke('settings:browseExecutable'),
  openConfig: () => ipcRenderer.invoke('settings:openConfig'),
  openLogs: () => ipcRenderer.invoke('settings:openLogs'),
});
