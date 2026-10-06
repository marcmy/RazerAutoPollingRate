(function (root) {
  function normalizePath(value) {
    return String(value || '').trim().replace(/\//g, '\\').toLowerCase();
  }

  function getGameActivity(card, runtime, cards = []) {
    if (card.hidden || !runtime?.enabled || !runtime.matchedProcess) return 'inactive';

    if (card.id && runtime.gameId) {
      return card.id === runtime.gameId ? 'active' : 'inactive';
    }

    const executablePath = runtime.matchedExecutablePath;
    if (card.executablePath && executablePath) {
      return normalizePath(card.executablePath) === normalizePath(executablePath) ? 'active' : 'inactive';
    }

    const processName = String(runtime.matchedProcessName || '').toLowerCase();
    if (!processName || String(card.processName || '').toLowerCase() !== processName) return 'inactive';

    // A shared rate can match by name, but that does not identify an install.
    const copies = new Set(cards.filter((candidate) => !candidate.hidden
      && String(candidate.processName || '').toLowerCase() === processName)
      .map((candidate) => normalizePath(candidate.executablePath)).filter(Boolean));
    return !executablePath && card.executablePath && copies.size > 1 ? 'ambiguous' : 'active';
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { getGameActivity };
  } else {
    root.gameActivity = { getGameActivity };
  }
})(typeof globalThis === 'object' ? globalThis : this);
