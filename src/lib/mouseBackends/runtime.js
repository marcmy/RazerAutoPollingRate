'use strict';

const { getDeviceList } = require('usb');
const { classifyUsbDevices, choosePreferredMousePath } = require('./discovery');
const { createPulsarCrazyLightBackend } = require('./pulsarCrazyLight');
const { createRazerBackend } = require('./razer');
const { getSharedMouseActivityTracker } = require('./mouseActivity');

const PRESENTATION_PROBE_METHODS = new Set([
  'discover',
  'open',
  'getPollingRate',
  'setPollingRate',
  'getActiveProfile',
  'getTurboMode',
  'setTurboMode',
]);

function createPresentationAwareBackend(backend, activityTracker, selectedMouse) {
  if (!backend || !activityTracker || !selectedMouse
    || typeof activityTracker.isPresentationSuppressed !== 'function'
    || typeof activityTracker.suppressPresentation !== 'function') {
    return backend;
  }

  const isSuppressed = () => activityTracker.isPresentationSuppressed(selectedMouse);

  return new Proxy(backend, {
    get(target, property, receiver) {
      if (property === 'name') {
        return isSuppressed() ? null : Reflect.get(target, property, receiver);
      }

      if (property === 'deviceInfo') {
        const info = Reflect.get(target, property, receiver);
        return isSuppressed() && info
          ? { ...info, productName: null }
          : info;
      }

      if (property === 'capabilities') {
        const capabilities = Reflect.get(target, property, receiver);
        return isSuppressed() && capabilities
          ? { ...capabilities, turboMode: false }
          : capabilities;
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;

      if (!PRESENTATION_PROBE_METHODS.has(property)) {
        return value.bind(target);
      }

      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          activityTracker.suppressPresentation(selectedMouse);
          throw error;
        }
      };
    },
  });
}

function fallbackMouseFromDiscovery(discovery) {
  const fallbackPath = choosePreferredMousePath(discovery);

  if (fallbackPath === 'razer' && discovery.supportedRazer.length > 0) {
    const { identity, device } = discovery.supportedRazer[0];
    return {
      backend: 'razer',
      vendorId: identity.vendorId,
      productId: identity.productId,
      serialNumber: device && device.serialNumber ? device.serialNumber : null,
    };
  }

  if (fallbackPath === 'pulsar' && discovery.knownCrazyLight.length > 0) {
    const { identity, device } = discovery.knownCrazyLight[0];
    return {
      backend: 'pulsar',
      vendorId: identity.vendorId,
      productId: identity.productId,
      serialNumber: device && device.serialNumber ? device.serialNumber : null,
    };
  }

  return null;
}

function createPreferredMouseBackend(options = {}) {
  const listDevices = options.getDeviceList || getDeviceList;
  const makeRazerBackend = options.createRazerBackend || createRazerBackend;
  const makePulsarBackend = options.createPulsarBackend || createPulsarCrazyLightBackend;
  const log = options.log || (() => {});
  const onDiagnostic = options.onDiagnostic || (() => {});

  const discovery = classifyUsbDevices(listDevices());

  for (const entry of discovery.unknownPulsar) {
    onDiagnostic('pulsar_usb_detected', {
      vendorId: entry.identity.vendorId,
      productId: entry.identity.productId,
      supported: false,
    });
  }

  const fallbackMouse = fallbackMouseFromDiscovery(discovery);
  const activityTracker = options.activityTracker
    || (!options.getDeviceList ? getSharedMouseActivityTracker({
      log,
      onDiagnostic,
      onActiveMouseChanged: options.onActiveMouseChanged,
    }) : null);
  const selectedMouse = activityTracker && typeof activityTracker.choosePreferredMouse === 'function'
    ? activityTracker.choosePreferredMouse(discovery, fallbackMouse)
    : fallbackMouse;
  const path = selectedMouse ? selectedMouse.backend : null;

  if (path === 'razer') {
    return {
      path,
      selectedMouse,
      discovery,
      backend: createPresentationAwareBackend(makeRazerBackend({
        log,
        onDiagnostic,
        preferredProductId: selectedMouse.productId,
        preferredSerialNumber: selectedMouse.serialNumber,
      }), activityTracker, selectedMouse),
    };
  }

  if (path === 'pulsar') {
    onDiagnostic('pulsar_usb_detected', {
      vendorId: 0x3710,
      productId: 0x5406,
      supported: true,
    });
    return {
      path,
      selectedMouse,
      discovery,
      backend: createPresentationAwareBackend(makePulsarBackend({
        log,
        onDiagnostic,
        // Read/write has now been validated on the user's retail 3710:5406
        // hardware, including an automatic restore with readback.
        allowHardwareValidationWrites: true,
      }), activityTracker, selectedMouse),
    };
  }

  throw new Error('No supported Razer or Pulsar mouse found');
}

module.exports = {
  createPreferredMouseBackend,
  createPresentationAwareBackend,
  fallbackMouseFromDiscovery,
};
