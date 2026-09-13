'use strict';

const REPORT_ID = 0x08;
const REPORT_SIZE = 17;

const CMD_WRITE_MEMORY = 0x07;
const CMD_READ_MEMORY = 0x08;
const CMD_GET_ACTIVE_PROFILE = 0x0E;

const POLLING_RATE_BY_VALUE = new Map([
  [0x08, 125],
  [0x04, 250],
  [0x02, 500],
  [0x01, 1000],
  [0x10, 2000],
  [0x20, 4000],
  [0x40, 8000],
]);
const POLLING_VALUE_BY_RATE = new Map(
  Array.from(POLLING_RATE_BY_VALUE, ([value, rate]) => [rate, value]),
);

function calculateChecksum(report) {
  let sum = 0;
  for (let index = 0; index < 16; index += 1) {
    sum += report[index] || 0;
  }
  return (0x55 - sum) & 0xff;
}

function buildCommandPacket(command, fields = {}) {
  const packet = Buffer.alloc(REPORT_SIZE);
  packet[0] = REPORT_ID;
  packet[1] = command & 0xff;

  for (const [rawIndex, rawValue] of Object.entries(fields)) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 2 || index > 15) {
      throw new Error(`CrazyLight packet field index ${rawIndex} is out of range`);
    }
    packet[index] = Number(rawValue) & 0xff;
  }

  packet[16] = calculateChecksum(packet);
  return packet;
}

function validateMemoryRange(address, length, operation) {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new Error(`CrazyLight memory address ${address} is out of range`);
  }
  if (!Number.isInteger(length) || length < 1 || length > 10) {
    throw new Error(`CrazyLight memory ${operation} length ${length} must be between 1 and 10`);
  }
  if (address + length - 1 > 0xffff) {
    throw new Error(`CrazyLight memory ${operation} crosses the 16-bit address boundary`);
  }
}

function buildMemoryReadPacket(address, length) {
  validateMemoryRange(address, length, 'read');

  return buildCommandPacket(CMD_READ_MEMORY, {
    3: (address >> 8) & 0xff,
    4: address & 0xff,
    5: length,
  });
}

function buildMemoryWritePacket(address, data) {
  const payload = Buffer.from(data || []);
  validateMemoryRange(address, payload.length, 'write');

  const fields = {
    3: (address >> 8) & 0xff,
    4: address & 0xff,
    5: payload.length,
  };
  payload.forEach((value, index) => {
    fields[6 + index] = value;
  });
  return buildCommandPacket(CMD_WRITE_MEMORY, fields);
}

function toBuffer(report) {
  if (Buffer.isBuffer(report)) {
    return report;
  }
  if (report instanceof Uint8Array) {
    return Buffer.from(report.buffer, report.byteOffset, report.byteLength);
  }
  if (report && report.buffer instanceof ArrayBuffer) {
    const byteOffset = Number(report.byteOffset) || 0;
    const byteLength = Number(report.byteLength) || report.buffer.byteLength;
    return Buffer.from(report.buffer, byteOffset, byteLength);
  }
  return Buffer.alloc(0);
}

function validateReply(report, expectedCommand) {
  const reply = toBuffer(report);
  if (reply.length < REPORT_SIZE) {
    throw new Error(`CrazyLight returned a short report (${reply.length} bytes)`);
  }
  if (reply[0] !== REPORT_ID) {
    throw new Error(`CrazyLight returned unexpected report ID 0x${reply[0].toString(16).padStart(2, '0')}`);
  }
  if (reply[1] !== expectedCommand) {
    throw new Error(
      `CrazyLight returned command 0x${reply[1].toString(16).padStart(2, '0')}; expected 0x${expectedCommand.toString(16).padStart(2, '0')}`,
    );
  }
  if (reply[16] !== calculateChecksum(reply)) {
    throw new Error('CrazyLight returned a report with an invalid checksum');
  }
  return reply;
}

function decodePollingRate(value) {
  return POLLING_RATE_BY_VALUE.get(Number(value) & 0xff) || null;
}

function encodePollingRate(rate) {
  return POLLING_VALUE_BY_RATE.get(Number(rate)) || null;
}

function parseActiveProfileReply(report) {
  const reply = validateReply(report, CMD_GET_ACTIVE_PROFILE);
  return reply[6] + 1;
}

function parseMemoryReadReply(report, expectedAddress, expectedLength) {
  const reply = validateReply(report, CMD_READ_MEMORY);
  const address = (reply[3] << 8) | reply[4];
  if (address !== expectedAddress) {
    throw new Error(
      `CrazyLight memory reply address 0x${address.toString(16).padStart(4, '0')} did not match expected 0x${expectedAddress.toString(16).padStart(4, '0')}`,
    );
  }
  if (reply[5] < expectedLength) {
    throw new Error(`CrazyLight memory reply length ${reply[5]} is shorter than expected ${expectedLength}`);
  }
  return Buffer.from(reply.subarray(6, 6 + expectedLength));
}

module.exports = {
  CMD_GET_ACTIVE_PROFILE,
  CMD_READ_MEMORY,
  CMD_WRITE_MEMORY,
  POLLING_RATE_BY_VALUE,
  POLLING_VALUE_BY_RATE,
  REPORT_ID,
  REPORT_SIZE,
  buildCommandPacket,
  buildMemoryReadPacket,
  buildMemoryWritePacket,
  calculateChecksum,
  decodePollingRate,
  encodePollingRate,
  parseActiveProfileReply,
  parseMemoryReadReply,
  validateReply,
};
