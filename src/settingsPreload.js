const { contextBridge, ipcRenderer } = require('electron');

const NO_SUPPORTED_MOUSE_CONNECTED = 'No supported mouse connected';
const NO_SUPPORTED_MOUSE_FOUND = 'No supported mouse found - Is it disconnected, sleeping, or powered off?';
const MOUSE_PREFIX = 'Mouse: ';
const TURBO_MARKER = ' · Turbo ';

let lastStableTurboText = null;

function normalizeMouseStatusText(value) {
  const text = String(value || '');

  if (text.startsWith(NO_SUPPORTED_MOUSE_CONNECTED)
    || text === NO_SUPPORTED_MOUSE_FOUND) {
    lastStableTurboText = null;
    return NO_SUPPORTED_MOUSE_FOUND;
  }

  if (!text.startsWith(MOUSE_PREFIX)) {
    return text;
  }

  const turboIndex = text.indexOf(TURBO_MARKER);
  if (turboIndex >= 0) {
    const turboState = text.slice(turboIndex + TURBO_MARKER.length).toLowerCase();
    if (turboState === 'on' || turboState === 'off') {
      lastStableTurboText = text;
    }
    return text;
  }

  if (lastStableTurboText
    && lastStableTurboText.startsWith(`${text}${TURBO_MARKER}`)) {
    return lastStableTurboText;
  }

  lastStableTurboText = null;
  return text;
}

function normalizeMouseStatusElement() {
  const element = document.getElementById('detected-mouse');
  if (!element) return;

  const normalized = normalizeMouseStatusText(element.textContent);
  if (normalized !== element.textContent) {
    element.textContent = normalized;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  normalizeMouseStatusElement();

  const element = document.getElementById('detected-mouse');
  if (!element) return;

  const observer = new MutationObserver(normalizeMouseStatusElement);
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
