'use strict';

// Loading the ESM-only package during Electron's ready phase avoids forcing
// the rest of the CommonJS main process and preload scripts into ESM.
// Keep the default config.json location and key names unchanged.
async function loadLegacyStore(loadModule = () => import('electron-store')) {
  const module = await loadModule();
  const Store = module && module.default;
  if (typeof Store !== 'function') {
    throw new TypeError('electron-store did not provide a default constructor');
  }
  return new Store();
}

module.exports = { loadLegacyStore };
