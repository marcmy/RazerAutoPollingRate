function getRazerReport(transactionId, commandClass, commandId, dataSize, argument0, argument1) {
  let msg = Buffer.from([0x00, transactionId, 0x00, 0x00, 0x00, dataSize, commandClass, commandId, argument0, argument1]);
  msg = Buffer.concat([msg, Buffer.alloc(78)]);

  let crc = 0;
  for (let i = 2; i < 88; i += 1) {
    crc ^= msg[i];
  }

  return Buffer.concat([msg, Buffer.from([crc, 0])]);
}

module.exports = {
  getRazerReport,
};
