const { contextBridge, ipcRenderer } = require('electron');

const NO_SUPPORTED_MOUSE_CONNECTED = 'No supported mouse connected';
const NO_SUPPORTED_MOUSE_FOUND = 'No supported mouse found - Is it disconnected, sleeping, or powered off?';

function updateNoMouseStatusText() {
  const element = document.getElementById('detected-mouse');
  if (element && element.textContent === NO_SUPPORTED_MOUSE_CONNECTED) {
    element.textContent = NO_SUPPORTED_MOUSE_FOUND;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  updateNoMouseStatusText();

  const element = document.getElementById('detected-mouse');
  if (!element) return;

  const observer = new MutationObserver(updateNoMouseStatusText);
  observer.observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });
});

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
