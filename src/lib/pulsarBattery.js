'use strict';

// Bibimbap's voltage calibration points, at 5% intervals. Interpolate between
// them rather than treating the firmware's coarse level byte as precise.
// https://bbb.pulsar.gg/cMouse/js/app.6842ab2c.js
const VOLTAGE_MV = [3050, 3420, 3480, 3540, 3600, 3660, 3720, 3760, 3800,
  3840, 3880, 3920, 3940, 3960, 3980, 4000, 4020, 4040, 4060, 4080, 4110];
const HISTORY_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_HISTORY_ENTRIES = 16;
// Bibimbap's reconnect bounds: 0.028 percentage points/sec rising, 0.014 falling.
const RISE_PER_MS = 0.028 / 1000;
const FALL_PER_MS = 0.014 / 1000;

function batteryPercentFromVoltage(voltageMv) {
  if (!Number.isFinite(voltageMv) || voltageMv < 2500 || voltageMv > 4500) return null;
  if (voltageMv <= VOLTAGE_MV[0]) return 0;
  if (voltageMv >= VOLTAGE_MV.at(-1)) return 100;
  const upper = VOLTAGE_MV.findIndex((value) => value >= voltageMv);
  const lowerVoltage = VOLTAGE_MV[upper - 1];
  return Math.round((upper - 1) * 5
    + 5 * (voltageMv - lowerVoltage) / (VOLTAGE_MV[upper] - lowerVoltage));
}

function createPulsarBatteryEstimator({ loadHistory = () => ({}), saveHistory = () => {} } = {}) {
  let initial;
  try { initial = loadHistory(); } catch { initial = {}; }
  const history = new Map(Object.entries(initial && typeof initial === 'object' ? initial : {})
    .filter(([key, value]) => /^[0-9a-f]{6}$/.test(key)
      && Number.isFinite(value?.level) && value.level >= 0 && value.level <= 100
      && Number.isFinite(value.timestamp) && typeof value.charging === 'boolean')
    .sort((left, right) => left[1].timestamp - right[1].timestamp)
    .slice(-MAX_HISTORY_ENTRIES));

  return function estimate(status, fallbackKey, timestamp) {
    const stableId = /^[0-9a-f]{6}$/.test(status.batteryId || '') ? status.batteryId : null;
    const key = stableId || fallbackKey;
    const previous = history.get(key);
    const elapsed = previous ? timestamp - previous.timestamp : Infinity;
    const recent = previous && elapsed >= 0 && elapsed <= HISTORY_MAX_AGE_MS;
    const raw = status.batteryPercent;
    const voltageLevel = batteryPercentFromVoltage(status.voltageMv);
    const target = raw === 0 ? 0 : voltageLevel ?? raw;
    let level;
    const fullReports = status.charging && raw === 100
      ? (recent ? previous.fullReports || 0 : 0) + 1 : 0;

    if (raw === 0) level = 0;
    else if (fullReports >= 8) level = 100;
    else if (!recent || previous.level == null) {
      // Charge voltage is biased upward. Without a baseline, do not invent a
      // percentage; learn it from a wireless/unplugged reading or confirmed full.
      level = status.charging ? null : target;
    } else if (status.charging !== previous.charging) {
      level = previous.level;
    } else if (status.charging) {
      level = Math.min(99, Math.max(previous.level,
        Math.min(target, previous.level + elapsed * RISE_PER_MS)));
      if (previous.level === 100) level = 100;
    } else {
      // A recharge may have happened while the app was closed. A bounded rise
      // must remain possible even when both saved and current states are unplugged.
      level = Math.max(previous.level - elapsed * FALL_PER_MS,
        Math.min(target, previous.level + elapsed * RISE_PER_MS));
    }

    history.delete(key);
    history.set(key, { level, timestamp, charging: status.charging, fullReports });
    while (history.size > MAX_HISTORY_ENTRIES) history.delete(history.keys().next().value);
    // Persist only a device address, never a receiver/path that could be reused
    // for a different mouse. Store failures must not stop optional telemetry.
    if (stableId && level != null) {
      const persisted = Object.fromEntries([...history].filter(([id, value]) =>
        /^[0-9a-f]{6}$/.test(id) && value.level != null));
      try { saveHistory(persisted); } catch { /* retain the in-memory baseline */ }
    }
    return level == null ? null : Math.round(level);
  };
}

module.exports = { batteryPercentFromVoltage, createPulsarBatteryEstimator };
