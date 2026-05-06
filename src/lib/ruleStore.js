const fs = require('fs');
const { parseProcessConfig, serializeProcessConfig } = require('./config');

function readRules(filePath, warn) {
  const contents = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  return parseProcessConfig(contents, { warn });
}

function writeRules(filePath, entries) {
  const contents = serializeProcessConfig(entries);
  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(tempPath, `${contents}${contents ? '\n' : ''}`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  readRules,
  writeRules,
};
