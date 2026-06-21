const fs = require('fs');
const path = require('path');
const { parseProcessConfig, serializeProcessConfig } = require('./config');
const { parsePollingRate } = require('./rates');

const DEFAULT_SETTINGS = {
  inactivePollingRate: 500,
  defaultGamePollingRate: 1000,
  detectionMode: 'foreground',
  autostart: true,
  diagnosticLogging: false,
  verboseDiagnosticLogging: false,
};

const BLOCKED_INI_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function createIniDictionary() {
  return Object.create(null);
}

function isSafeIniKey(value) {
  return Boolean(value) && !BLOCKED_INI_KEYS.has(value);
}

function parseBoolean(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseIni(contents) {
  const sections = createIniDictionary();
  let currentSection = null;

  String(contents || '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      return;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim().toLowerCase();
      if (!isSafeIniKey(sectionName)) {
        currentSection = null;
        return;
      }

      currentSection = sectionName;
      if (!Object.hasOwn(sections, currentSection)) {
        sections[currentSection] = createIniDictionary();
      }
      return;
    }

    if (!currentSection) {
      return;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      return;
    }

    const key = line.slice(0, equalsIndex).trim().toLowerCase();
    if (!isSafeIniKey(key)) {
      return;
    }

    const value = line.slice(equalsIndex + 1).trim();
    sections[currentSection][key] = value;
  });

  return sections;
}

function normalizeSettings(rawSettings = {}) {
  const inactivePollingRate = parsePollingRate(rawSettings.inactive_polling_rate);
  const defaultGamePollingRate = parsePollingRate(rawSettings.default_game_polling_rate);
  const detectionMode = rawSettings.detection_mode === 'running' ? 'running' : 'foreground';

  return {
    inactivePollingRate: inactivePollingRate && inactivePollingRate <= 1000
      ? inactivePollingRate
      : DEFAULT_SETTINGS.inactivePollingRate,
    defaultGamePollingRate: defaultGamePollingRate || DEFAULT_SETTINGS.defaultGamePollingRate,
    detectionMode,
    autostart: parseBoolean(rawSettings.autostart, DEFAULT_SETTINGS.autostart),
    diagnosticLogging: parseBoolean(rawSettings.diagnostic_logging, DEFAULT_SETTINGS.diagnosticLogging),
    verboseDiagnosticLogging: parseBoolean(
      rawSettings.verbose_diagnostic_logging,
      DEFAULT_SETTINGS.verboseDiagnosticLogging,
    ),
  };
}

function parseRulesSection(rulesSection = {}, options = {}) {
  const orderedKeys = Object.keys(rulesSection)
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right));
  const ruleLines = orderedKeys.map((key) => rulesSection[key]).join('\n');
  return parseProcessConfig(ruleLines, options);
}

function readAppConfig(configPath, options = {}) {
  const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const sections = parseIni(contents);
  const settings = normalizeSettings(sections.settings);
  const parsedRules = parseRulesSection(sections.rules, options);

  return {
    settings,
    entries: parsedRules.entries,
    warnings: parsedRules.warnings,
  };
}

function serializeAppConfig(settings, entries) {
  const normalizedSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
  };
  const ruleLines = serializeProcessConfig(entries)
    .split(/\r?\n/)
    .filter(Boolean);

  return [
    '[settings]',
    `inactive_polling_rate=${normalizedSettings.inactivePollingRate}`,
    `default_game_polling_rate=${normalizedSettings.defaultGamePollingRate}`,
    `detection_mode=${normalizedSettings.detectionMode === 'running' ? 'running' : 'foreground'}`,
    `autostart=${normalizedSettings.autostart ? 'true' : 'false'}`,
    `diagnostic_logging=${normalizedSettings.diagnosticLogging ? 'true' : 'false'}`,
    `verbose_diagnostic_logging=${normalizedSettings.verboseDiagnosticLogging ? 'true' : 'false'}`,
    '',
    '[rules]',
    ...ruleLines.map((line, index) => `${index + 1}=${line}`),
    '',
  ].join('\n');
}

function writeAppConfig(configPath, settings, entries) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.tmp`;
  fs.writeFileSync(tempPath, serializeAppConfig(settings, entries), 'utf8');
  fs.renameSync(tempPath, configPath);
}

function configExists(configPath) {
  return fs.existsSync(configPath);
}

module.exports = {
  DEFAULT_SETTINGS,
  configExists,
  normalizeSettings,
  parseIni,
  readAppConfig,
  serializeAppConfig,
  writeAppConfig,
};
