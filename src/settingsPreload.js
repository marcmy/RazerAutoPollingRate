const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (payload) => ipcRenderer.invoke('settings:save', payload),
  rescanLibraries: () => ipcRenderer.invoke('settings:rescanLibraries'),
  getRuntimeStatus: () => ipcRenderer.invoke('settings:getRuntimeStatus'),
  browseExecutable: () => ipcRenderer.invoke('settings:browseExecutable'),
  browseFolder: () => ipcRenderer.invoke('settings:browseFolder'),
  openConfig: () => ipcRenderer.invoke('settings:openConfig'),
  openLogs: () => ipcRenderer.invoke('settings:openLogs'),
});
