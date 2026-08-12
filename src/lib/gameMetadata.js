const { normalizeExecutablePath, normalizeProcessName } = require('./config');
const { isPathInsideRoot, normalizeWindowsPath } = require('./gameLibraries');

function normalizeMetadataId(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (/^manual:/i.test(text)) {
    const target = text.slice(text.indexOf(':') + 1).trim();
    if (!target) {
      return '';
    }

    const normalizedTarget = /^[a-z]:\\/i.test(target)
      ? normalizeExecutablePath(target)
      : normalizeProcessName(target);
    return `manual:${normalizedTarget}`;
  }

  return normalizeWindowsPath(text);
}

function normalizeMetadataTarget(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  return /^[a-z]:\\/i.test(text)
    ? normalizeExecutablePath(text)
    : normalizeProcessName(text);
}

function normalizeGameMetadata(items = []) {
  const deduped = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const id = normalizeMetadataId(item.id);
    if (!id) {
      return;
    }

    const name = String(item.name || '').trim();
    const hidden = Boolean(item.hidden);
    const target = normalizeMetadataTarget(item.target);

    if (!name && !hidden) {
      return;
    }

    deduped.set(id, {
      id,
      ...(name ? { name } : {}),
      ...(hidden ? { hidden: true } : {}),
      ...(target ? { target } : {}),
    });
  });

  return [...deduped.values()];
}

function metadataIdForGame(game) {
  if (!game) {
    return '';
  }

  const id = String(game.id || '').trim();
  if (id) {
    return normalizeMetadataId(id);
  }

  const target = game.overrideTarget || game.executablePath || game.processName;
  if (!target) {
    return '';
  }

  return normalizeMetadataId(`manual:${target}`);
}

function metadataForGame(game, metadata = []) {
  const id = metadataIdForGame(game);
  if (!id) {
    return null;
  }

  return normalizeGameMetadata(metadata).find((item) => item.id === id) || null;
}

function isGameHidden(game, metadata = []) {
  const item = metadataForGame(game, metadata);
  return Boolean(item && item.hidden);
}

function ruleTarget(entry) {
  if (!entry) {
    return '';
  }

  if (entry.executablePath) {
    return normalizeExecutablePath(entry.executablePath);
  }

  return normalizeProcessName(entry.rawTarget || entry.rawProcessName || entry.processName);
}

function isRuleHidden(entry, metadata = []) {
  const target = ruleTarget(entry);
  if (!target) {
    return false;
  }

  return normalizeGameMetadata(metadata).some((item) => {
    if (!item.hidden) {
      return false;
    }

    if (item.target && item.target === target) {
      return true;
    }

    if (item.id.startsWith('manual:')) {
      return item.id.slice('manual:'.length) === target;
    }

    return Boolean(entry.executablePath && isPathInsideRoot(entry.executablePath, item.id));
  });
}

module.exports = {
  isGameHidden,
  isRuleHidden,
  metadataForGame,
  metadataIdForGame,
  normalizeGameMetadata,
  normalizeMetadataId,
};
