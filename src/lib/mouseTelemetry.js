'use strict';

const BATTERY_REFRESH_MS = 60 * 1000;
const { createPulsarBatteryEstimator } = require('./pulsarBattery');

function createMouseTelemetryReader({ now = Date.now, refreshMs = BATTERY_REFRESH_MS,
  loadBatteryHistory, saveBatteryHistory } = {}) {
  const estimateBattery = createPulsarBatteryEstimator({
    loadHistory: loadBatteryHistory, saveHistory: saveBatteryHistory,
  });
  let cachedKey = null;
  let checkedAt = -Infinity;
  let cached = { batteryPercent: null, charging: null, batteryError: null };

  async function readMouseTelemetry(backend) {
    const info = backend.deviceInfo || {};
    const key = [backend.id, info.vendorId, info.productId, info.path, info.serialNumber].join(':');
    if (key !== cachedKey) {
      cachedKey = key;
      checkedAt = -Infinity;
      cached = { batteryPercent: null, charging: null, batteryError: null };
    }
    if (typeof backend.getBatteryStatus !== 'function') return cached;
    const timestamp = now();
    if (timestamp - checkedAt < refreshMs) return cached;
    checkedAt = timestamp;
    try {
      const status = await backend.getBatteryStatus();
      if (!Number.isInteger(status?.batteryPercent) || status.batteryPercent < 0
        || status.batteryPercent > 100 || typeof status.charging !== 'boolean') {
        throw new Error('Invalid mouse battery status');
      }
      cached = {
        batteryPercent: backend.id === 'pulsar-x2-crazylight'
          ? estimateBattery(status, key, timestamp) : status.batteryPercent,
        charging: status.charging,
        batteryError: null,
      };
    } catch (error) {
      // Optional telemetry must neither stop rate switching nor leave a stale
      // percentage/charging indication visible after a failed read.
      cached = { batteryPercent: null, charging: null, batteryError: error.message };
    }
    return cached;
  }
  readMouseTelemetry.reset = () => { cachedKey = null; checkedAt = -Infinity; };
  return readMouseTelemetry;
}

function formatMouseTelemetry(status) {
  const parts = [];
  if (status.connection === 'wired') parts.push('Wired');
  if (status.connection === 'wireless') parts.push('Wireless');
  if (Number.isInteger(status.batteryPercent)) parts.push(`${status.batteryPercent}% battery`);
  if (status.charging === true) parts.push('Charging');
  if (status.charging === true && !Number.isInteger(status.batteryPercent)) parts.push('Battery percentage unavailable');
  if (status.charging === false && status.connection === 'wired') parts.push('Not charging');
  return parts.join(' · ');
}

module.exports = { BATTERY_REFRESH_MS, createMouseTelemetryReader, formatMouseTelemetry };
