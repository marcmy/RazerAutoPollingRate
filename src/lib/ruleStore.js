const { readAppConfig, writeAppConfig } = require('./appConfig');

function readRules(filePath, warn) {
  return readAppConfig(filePath, { warn });
}

function writeRules(filePath, entries, settings) {
  writeAppConfig(filePath, settings, entries);
}

module.exports = {
  readRules,
  writeRules,
};
