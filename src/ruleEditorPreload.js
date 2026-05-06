const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ruleEditor', {
  loadRules: () => ipcRenderer.invoke('rules:load'),
  saveRules: (rules) => ipcRenderer.invoke('rules:save', rules),
  browseExecutable: () => ipcRenderer.invoke('rules:browse'),
});
