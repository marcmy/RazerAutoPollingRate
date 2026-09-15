'use strict';

function supportsTurboMode(backend) {
  return backend.id === 'pulsar-x2-crazylight'
    && backend.capabilities?.turboMode === true
    && backend.deviceInfo.vendorId === 0x3710
    && backend.deviceInfo.productId === 0x5406;
}

async function applyTurboMode(backend, selection, enabled) {
  if (!supportsTurboMode(backend)) return null;
  const target = enabled && selection.matchedRule?.turboMode === true;
  const profile = await backend.getActiveProfile();
  const current = await backend.getTurboMode();
  if (await backend.getActiveProfile() !== profile) {
    throw new Error('CrazyLight profile changed while reading Turbo Mode');
  }
  if (current !== target) await backend.setTurboMode(target, profile);
  return target;
}

module.exports = { supportsTurboMode, applyTurboMode };
