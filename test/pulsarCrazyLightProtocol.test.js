const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CMD_GET_ACTIVE_PROFILE,
  CMD_READ_MEMORY,
  CMD_WRITE_MEMORY,
  REPORT_ID,
  REPORT_SIZE,
  buildCommandPacket,
  buildMemoryReadPacket,
  buildMemoryWritePacket,
  decodePollingRate,
  encodePollingRate,
  parseActiveProfileReply,
  parseMemoryReadReply,
} = require('../src/lib/mouseBackends/pulsarCrazyLightProtocol');

function checksum(bytes) {
  return (0x55 - bytes.subarray(0, 16).reduce((sum, value) => sum + value, 0)) & 0xff;
}

function makeReply(command, fields = {}) {
  const reply = Buffer.alloc(REPORT_SIZE);
  reply[0] = REPORT_ID;
  reply[1] = command;
  Object.entries(fields).forEach(([index, value]) => {
    reply[Number(index)] = value;
  });
  reply[16] = checksum(reply);
  return reply;
}

test('buildCommandPacket creates a 17-byte Nordic report with checksum', () => {
  const packet = buildCommandPacket(CMD_GET_ACTIVE_PROFILE);

  assert.equal(packet.length, REPORT_SIZE);
  assert.equal(packet[0], REPORT_ID);
  assert.equal(packet[1], CMD_GET_ACTIVE_PROFILE);
  assert.equal(packet[16], checksum(packet));
});

test('buildMemoryReadPacket encodes address and requested byte count', () => {
  const packet = buildMemoryReadPacket(0x1234, 3);

  assert.equal(packet[1], CMD_READ_MEMORY);
  assert.equal(packet[3], 0x12);
  assert.equal(packet[4], 0x34);
  assert.equal(packet[5], 0x03);
  assert.equal(packet[16], checksum(packet));
});

test('buildMemoryWritePacket encodes a dense Nordic MEM_SET payload', () => {
  const packet = buildMemoryWritePacket(0x1234, Buffer.from([0x40, 0x15]));

  assert.equal(packet[1], CMD_WRITE_MEMORY);
  assert.equal(packet[3], 0x12);
  assert.equal(packet[4], 0x34);
  assert.equal(packet[5], 0x02);
  assert.equal(packet[6], 0x40);
  assert.equal(packet[7], 0x15);
  assert.equal(packet[16], checksum(packet));
});

test('polling-rate encoder mirrors every validated CrazyLight read value', () => {
  assert.equal(encodePollingRate(125), 0x08);
  assert.equal(encodePollingRate(250), 0x04);
  assert.equal(encodePollingRate(500), 0x02);
  assert.equal(encodePollingRate(1000), 0x01);
  assert.equal(encodePollingRate(2000), 0x10);
  assert.equal(encodePollingRate(4000), 0x20);
  assert.equal(encodePollingRate(8000), 0x40);
  assert.equal(encodePollingRate(1234), null);
});

test('decodePollingRate handles every CrazyLight polling value', () => {
  assert.equal(decodePollingRate(0x08), 125);
  assert.equal(decodePollingRate(0x04), 250);
  assert.equal(decodePollingRate(0x02), 500);
  assert.equal(decodePollingRate(0x01), 1000);
  assert.equal(decodePollingRate(0x10), 2000);
  assert.equal(decodePollingRate(0x20), 4000);
  assert.equal(decodePollingRate(0x40), 8000);
  assert.equal(decodePollingRate(0x7f), null);
});

test('parseActiveProfileReply converts the zero-based device profile to one-based', () => {
  const reply = makeReply(CMD_GET_ACTIVE_PROFILE, { 6: 2 });
  assert.equal(parseActiveProfileReply(reply), 3);
});

test('parseMemoryReadReply validates address and returns requested bytes', () => {
  const reply = makeReply(CMD_READ_MEMORY, {
    3: 0x00,
    4: 0x00,
    5: 0x02,
    6: 0x40,
    7: 0x15,
  });

  assert.deepEqual(parseMemoryReadReply(reply, 0x0000, 2), Buffer.from([0x40, 0x15]));
});

test('reply parsers reject malformed or mismatched reports', () => {
  assert.throws(() => parseActiveProfileReply(Buffer.alloc(4)), /short/i);

  const wrongReportId = makeReply(CMD_GET_ACTIVE_PROFILE);
  wrongReportId[0] = 0x07;
  assert.throws(() => parseActiveProfileReply(wrongReportId), /report id/i);

  const wrongCommand = makeReply(CMD_READ_MEMORY);
  assert.throws(() => parseActiveProfileReply(wrongCommand), /command/i);

  const wrongAddress = makeReply(CMD_READ_MEMORY, { 3: 0x12, 4: 0x34, 5: 1, 6: 0x01 });
  assert.throws(() => parseMemoryReadReply(wrongAddress, 0x0000, 1), /address/i);

  const shortPayload = makeReply(CMD_READ_MEMORY, { 3: 0x00, 4: 0x00, 5: 0, 6: 0x01 });
  assert.throws(() => parseMemoryReadReply(shortPayload, 0x0000, 1), /length/i);
});
