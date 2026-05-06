const VALID_POLLING_RATES = Object.freeze([125, 250, 500, 1000, 2000, 4000, 8000]);
const VALID_RATE_SET = new Set(VALID_POLLING_RATES);

const RATE_TO_REPORT_BYTE = Object.freeze({
  8000: 0x01,
  4000: 0x02,
  2000: 0x04,
  1000: 0x08,
  500: 0x10,
  250: 0x20,
  125: 0x40,
});

const REPORT_BYTE_TO_RATE = Object.freeze({
  0x01: 8000,
  0x02: 4000,
  0x04: 2000,
  0x08: 1000,
  0x10: 500,
  0x20: 250,
  0x40: 125,
});

function isValidPollingRate(rate) {
  return VALID_RATE_SET.has(Number(rate));
}

function parsePollingRate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }

  const rate = Number(text);
  return isValidPollingRate(rate) ? rate : null;
}

function getReportByteForRate(rate) {
  const parsedRate = parsePollingRate(rate);
  if (parsedRate === null) {
    throw new Error(`Invalid polling rate: ${rate}`);
  }

  return RATE_TO_REPORT_BYTE[parsedRate];
}

function getRateForReportByte(byte) {
  return REPORT_BYTE_TO_RATE[byte] || null;
}

function resolveSupportedPollingRate(rate, deviceCapabilities = {}) {
  const parsedRate = parsePollingRate(rate);
  if (parsedRate === null) {
    return {
      rate: null,
      supported: false,
      warning: `Invalid polling rate requested: ${rate}`,
    };
  }

  if (parsedRate === 8000 && !deviceCapabilities.is8kCompatible) {
    return {
      rate: 4000,
      supported: false,
      warning: '8000 Hz is not supported by this dongle; falling back to 4000 Hz.',
    };
  }

  return {
    rate: parsedRate,
    supported: true,
    warning: null,
  };
}

module.exports = {
  VALID_POLLING_RATES,
  getRateForReportByte,
  getReportByteForRate,
  isValidPollingRate,
  parsePollingRate,
  resolveSupportedPollingRate,
};
