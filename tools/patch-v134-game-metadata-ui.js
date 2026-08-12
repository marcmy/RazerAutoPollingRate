const fs = require('fs');

function replaceOnce(text, oldText, newText, label) {
  if (!text.includes(oldText)) {
    throw new Error(`Missing expected block: ${label}`);
  }
  return text.replace(oldText, newText);
}

// ---- main.js ---------------------------------------------------------------
const mainPath = 'src/main.js';
let main = fs.readFileSync(mainPath, 'utf8');

main = replaceOnce(main,
`const {
  discoverGameLibraries,
  gameForExecutable,
  getFriendlyGameNameFromExecutable,
  isPathInsideRoot,
  normalizeWindowsPath,
  scanLibraryGames,
} = require('./lib/gameLibraries');
`,
`const {
  discoverGameLibraries,
  gameForExecutable,
  getFriendlyGameNameFromExecutable,
  isPathInsideRoot,
  normalizeWindowsPath,
  scanLibraryGames,
} = require('./lib/gameLibraries');
const {
  isGameHidden,
  isRuleHidden,
  metadataForGame,
  normalizeGameMetadata,
} = require('./lib/gameMetadata');
`, 'game metadata import');

main = replaceOnce(main,
`function saveConfig(settings, entries, gameFolders = []) {
  writeAppConfig(getConfigPath(), settings, entries, gameFolders);
}
`,
`function saveConfig(settings, entries, gameFolders = [], gameMetadata = []) {
  writeAppConfig(getConfigPath(), settings, entries, gameFolders, gameMetadata);
}
`, 'saveConfig signature');

const buildStart = main.indexOf('async function buildGameCards(entries) {');
const buildEnd = main.indexOf('\nfunction getRuntimeStatus()', buildStart);
if (buildStart < 0 || buildEnd < 0) throw new Error('Could not locate buildGameCards');
const newBuild = `async function buildGameCards(entries, gameMetadata = []) {
  const rules = editorRulesFromEntries(entries);
  const metadata = normalizeGameMetadata(gameMetadata);
  const cards = [];
  const usedRules = new Set();

  for (const game of scannedGames) {
    const overrideIndex = rules.findIndex((rule, index) => !usedRules.has(index) && ruleMatchesGame(rule, game));
    const override = overrideIndex >= 0 ? rules[overrideIndex] : null;
    if (overrideIndex >= 0) {
      usedRules.add(overrideIndex);
    }

    const overrideExecutablePath = override && /^[a-z]:\\\\/i.test(override.target)
      ? override.target
      : null;
    const cardExecutablePath = overrideExecutablePath || game.executablePath;
    const cardProcessName = override
      ? path.win32.basename(override.target)
      : game.processName;
    const gameMeta = metadataForGame(game, metadata);
    const defaultName = game.name;
    const customName = gameMeta && gameMeta.name ? gameMeta.name : null;
    const hidden = Boolean(gameMeta && gameMeta.hidden);
    const hasRuleOverride = Boolean(override);

    cards.push({
      ...game,
      name: customName || defaultName,
      defaultName,
      customName,
      hidden,
      executablePath: cardExecutablePath,
      processName: cardProcessName,
      kind: 'auto',
      customized: hasRuleOverride || Boolean(customName) || hidden,
      hasRuleOverride,
      pollingRate: override ? override.pollingRate : null,
      detectionMode: override ? override.detectionMode : 'default',
      overrideTarget: override ? override.target : null,
      iconDataUrl: await getExecutableIconDataUrl(cardExecutablePath),
    });
  }

  for (let index = 0; index < rules.length; index += 1) {
    if (usedRules.has(index)) {
      continue;
    }

    const rule = rules[index];
    const executablePath = /^[a-z]:\\\\/i.test(rule.target) ? rule.target : null;
    const defaultName = getFriendlyRuleName(rule);
    const baseCard = {
      id: \`manual:\${normalizeProcessName(rule.target)}\`,
      defaultName,
      source: 'Manual',
      provider: 'manual',
      gameRoot: executablePath ? path.win32.dirname(executablePath) : null,
      executablePath,
      processName: path.win32.basename(rule.target),
      autoDetected: false,
      kind: 'manual',
      hasRuleOverride: true,
      pollingRate: rule.pollingRate,
      detectionMode: rule.detectionMode || 'default',
      overrideTarget: rule.target,
    };
    const gameMeta = metadataForGame(baseCard, metadata);
    const customName = gameMeta && gameMeta.name ? gameMeta.name : null;
    const hidden = Boolean(gameMeta && gameMeta.hidden);

    cards.push({
      ...baseCard,
      name: customName || defaultName,
      customName,
      hidden,
      customized: true,
      iconDataUrl: await getExecutableIconDataUrl(executablePath),
    });
  }

  cards.sort((left, right) => left.name.localeCompare(right.name));
  return cards;
}
`;
main = main.slice(0, buildStart) + newBuild + main.slice(buildEnd);

main = main.replace(
`      entries,
      gameFolders,
      warnings,
    } = loadConfig((message) => log(message, true));`,
`      entries,
      gameFolders,
      gameMetadata,
      warnings,
    } = loadConfig((message) => log(message, true));`);
main = main.replace(
`      rules: editorRulesFromEntries(entries),
      gameFolders,
      libraries: gameLibraries,
      games: await buildGameCards(entries),`,
`      rules: editorRulesFromEntries(entries),
      gameFolders,
      gameMetadata,
      libraries: gameLibraries,
      games: await buildGameCards(entries, gameMetadata),`);

main = replaceOnce(main,
`      const gameFolders = Array.isArray(payload.gameFolders)
        ? payload.gameFolders.map((folder) => String(folder || '').trim()).filter(Boolean)
        : [];
      const autostartChanged = settings.autostart !== autostartEnabled;
      applySettings(settings);
      saveConfig(getCurrentSettings(), entries, gameFolders);
`,
`      const gameFolders = Array.isArray(payload.gameFolders)
        ? payload.gameFolders.map((folder) => String(folder || '').trim()).filter(Boolean)
        : [];
      const gameMetadata = normalizeGameMetadata(payload.gameMetadata);
      const autostartChanged = settings.autostart !== autostartEnabled;
      applySettings(settings);
      saveConfig(getCurrentSettings(), entries, gameFolders, gameMetadata);
`, 'settings save metadata');
main = replaceOnce(main,
`        rules: editorRulesFromEntries(entries),
        gameFolders,
        warnings: [],
`,
`        rules: editorRulesFromEntries(entries),
        gameFolders,
        gameMetadata,
        warnings: [],
`, 'settings save response metadata');

main = replaceOnce(main,
`      settings,
      entries,
      gameFolders,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    rescanGames(settings, gameFolders);
    return {
      libraries: gameLibraries,
      games: await buildGameCards(entries),
    };
`,
`      settings,
      entries,
      gameFolders,
      gameMetadata,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    rescanGames(settings, gameFolders);
    return {
      libraries: gameLibraries,
      games: await buildGameCards(entries, gameMetadata),
    };
`, 'rescan metadata');

main = replaceOnce(main,
`      settings,
      entries,
      gameFolders,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    const newEntry = createRuleEntry(target, defaultGamePollingRate);
    const updatedEntries = upsertPickedRule(entries, newEntry);
    saveConfig(getCurrentSettings(), updatedEntries, gameFolders);
`,
`      settings,
      entries,
      gameFolders,
      gameMetadata,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    const newEntry = createRuleEntry(target, defaultGamePollingRate);
    const updatedEntries = upsertPickedRule(entries, newEntry);
    saveConfig(getCurrentSettings(), updatedEntries, gameFolders, gameMetadata);
`, 'pick window metadata preservation');

const selectStart = main.indexOf('function selectCurrentPollingRate(entries, foregroundProcess, runningProcesses) {');
const selectEnd = main.indexOf('\nfunction updateRuntimeSelection(', selectStart);
if (selectStart < 0 || selectEnd < 0) throw new Error('Could not locate selectCurrentPollingRate');
const newSelect = `function selectCurrentPollingRate(entries, foregroundProcess, runningProcesses, gameMetadata = []) {
  const configured = selectConfiguredPollingRate(entries, {
    foregroundProcess,
    runningProcesses,
    defaultDetectionMode: getDetectionMode(),
    inactivePollingRate: lowerRate,
    defaultGamePollingRate,
  });

  if (configured.matchedRule) {
    return { ...configured, game: null };
  }

  if (foregroundProcess && foregroundProcess.executablePath && gameLibraries.length > 0) {
    const game = gameForExecutable(foregroundProcess.executablePath, gameLibraries);
    if (game && !isGameHidden(game, gameMetadata)) {
      rememberDetectedGame(game);
      return {
        targetRate: defaultGamePollingRate,
        matchedProcess: foregroundProcess.processName || foregroundProcess.executablePath,
        matchedRule: null,
        matchedDetectionMode: 'foreground',
        source: 'library',
        game,
      };
    }
  }

  return createInactiveSelection();
}
`;
main = main.slice(0, selectStart) + newSelect + main.slice(selectEnd);

main = replaceOnce(main,
`      settings,
      entries,
      gameFolders,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    syncGameLibraries(settings, gameFolders);

    let runningProcesses = null;`,
`      settings,
      entries,
      gameFolders,
      gameMetadata,
    } = loadConfig((message) => log(message, true));
    applySettings(settings);
    syncGameLibraries(settings, gameFolders);
    const activeEntries = entries.filter((entry) => !isRuleHidden(entry, gameMetadata));

    let runningProcesses = null;`, 'runtime metadata load');
main = main.replace(
`(detectionEnabled && entries.some((entry) => ruleNeedsRunningProcesses(entry, getDetectionMode())))`,
`(detectionEnabled && activeEntries.some((entry) => ruleNeedsRunningProcesses(entry, getDetectionMode())))`);
main = main.replace('updateDiagnosticSession(entries, runningProcesses, runningProcessesError)', 'updateDiagnosticSession(activeEntries, runningProcesses, runningProcessesError)');
main = main.replace('entries.some((entry) => ruleNeedsRunningProcesses(entry, getDetectionMode()))', 'activeEntries.some((entry) => ruleNeedsRunningProcesses(entry, getDetectionMode()))');
main = main.replace('selectCurrentPollingRate(entries, foregroundProcess, runningProcesses || [])', 'selectCurrentPollingRate(activeEntries, foregroundProcess, runningProcesses || [], gameMetadata)');
main = main.replace('      rules: entries.length,', '      rules: activeEntries.length,');

fs.writeFileSync(mainPath, main);

// ---- settings.html ---------------------------------------------------------
const settingsPath = 'src/settings.html';
let html = fs.readFileSync(settingsPath, 'utf8');

html = html.replace('grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));', 'grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));');
html = html.replace('      gap: 12px;\n      min-height: 176px;\n      padding: 14px;', '      gap: 8px;\n      min-height: 142px;\n      padding: 11px;');
html = html.replace('      height: 48px;\n      justify-content: center;\n      overflow: hidden;\n      width: 48px;', '      height: 40px;\n      justify-content: center;\n      overflow: hidden;\n      width: 40px;');
html = html.replace('      font-size: 14px;\n      font-weight: 650;', '      font-size: 13px;\n      font-weight: 650;');
html = html.replace('      margin-top: 7px;', '      margin-top: 5px;');
html = html.replace('      gap: 4px;\n      margin-top: auto;', '      gap: 2px;\n      margin-top: auto;');

html = replaceOnce(html,
`                <button class="segment" data-filter="auto" type="button">Auto-detected</button>
`,
`                <button class="segment" data-filter="auto" type="button">Auto-detected</button>
                <button class="segment" data-filter="hidden" type="button">Hidden</button>
`, 'hidden filter');

html = replaceOnce(html,
`    <div class="modal-body">
      <div class="field">
        <label for="modal-executable">Executable</label>
`,
`    <div class="modal-body">
      <div class="field">
        <label for="modal-name">Display name</label>
        <input id="modal-name" type="text" maxlength="80" spellcheck="false">
        <div class="field-help">Customize the name shown on the game card without changing detection.</div>
      </div>

      <div class="field">
        <label for="modal-executable">Executable</label>
`, 'display name field');

html = replaceOnce(html,
`      <div class="modal-grid">
        <div class="field">
          <label for="modal-rate">Polling rate</label>
          <select id="modal-rate"></select>
        </div>
        <div class="field">
          <label for="modal-detection">Detection</label>
          <select id="modal-detection">
            <option value="default">Use default</option>
            <option value="foreground">Foreground window</option>
            <option value="running">Running process</option>
          </select>
        </div>
      </div>
`,
`      <div class="modal-grid">
        <div class="field">
          <label for="modal-rate">Polling rate</label>
          <select id="modal-rate"></select>
        </div>
        <div class="field">
          <label for="modal-detection">Detection</label>
          <select id="modal-detection">
            <option value="default">Use default</option>
            <option value="foreground">Foreground window</option>
            <option value="running">Running process</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label class="toggle-row">
          <input id="modal-hidden" type="checkbox">
          <span>Hide and ignore this game</span>
        </label>
        <div class="field-help">Ignored games stay out of the normal list and will not activate an automatic or explicit polling rule. Use the Hidden filter to restore them.</div>
      </div>
`, 'hidden toggle');

html = html.replace('      gameFolders: [],\n      libraries: [],', '      gameFolders: [],\n      gameMetadata: [],\n      libraries: [],');
html = replaceOnce(html,
`          gameFolders: state.gameFolders,
        });`,
`          gameFolders: state.gameFolders,
          gameMetadata: state.gameMetadata,
        });`, 'save payload metadata');
html = replaceOnce(html,
`        state.rules = result.rules;
        state.gameFolders = result.gameFolders;
        setStatus('Saved');`,
`        state.rules = result.rules;
        state.gameFolders = result.gameFolders;
        state.gameMetadata = result.gameMetadata || state.gameMetadata;
        setStatus('Saved');`, 'save response metadata');

html = replaceOnce(html,
`        if (state.filter === 'customized' && !card.customized) {
          return false;
        }
        if (state.filter === 'auto' && card.kind !== 'auto') {
          return false;
        }

        if (!query) {`,
`        if (state.filter === 'hidden') {
          if (!card.hidden) return false;
        } else {
          if (card.hidden) return false;
          if (state.filter === 'customized' && !card.customized) return false;
          if (state.filter === 'auto' && card.kind !== 'auto') return false;
        }

        if (!query) {`, 'game visibility filters');

html = replaceOnce(html,
`        if (card.customized) {
          const customized = document.createElement('span');
          customized.className = 'badge customized';
          customized.textContent = 'Customized';
          badges.appendChild(customized);
        }
`,
`        if (card.customized) {
          const customized = document.createElement('span');
          customized.className = 'badge customized';
          customized.textContent = 'Customized';
          badges.appendChild(customized);
        }
        if (card.hidden) {
          const hidden = document.createElement('span');
          hidden.className = 'badge customized';
          hidden.textContent = 'Ignored';
          badges.appendChild(hidden);
        }
`, 'hidden badge');
html = html.replace(
`        liveText.textContent = running
          ? \`Running · \${state.runtime.targetRate || state.runtime.requestedTarget || getRateLabel(card)} Hz active\`
          : 'Not running';`,
`        liveText.textContent = card.hidden
          ? 'Ignored'
          : (running
            ? \`Running · \${state.runtime.targetRate || state.runtime.requestedTarget || getRateLabel(card)} Hz active\`
            : 'Not running');`);

html = replaceOnce(html,
`    function openGameDialog(card) {
      state.modalCard = card;
      setModalIcon(card);
      byId('modal-title').textContent = card.name || card.processName || 'Game';
      byId('modal-subtitle').textContent = \`${card.source || 'Manual'} · \${card.kind === 'auto' ? 'Automatically detected' : 'Manual game'}\`;
      byId('modal-executable').value = card.overrideTarget || card.executablePath || card.processName || '';
      fillRateSelect(byId('modal-rate'), validRates, card.pollingRate, true);
      byId('modal-detection').value = card.detectionMode || 'default';
      byId('modal-remove').classList.toggle('hidden', card.kind !== 'auto' || !card.customized);
      byId('modal-delete').classList.toggle('hidden', card.kind !== 'manual');
      gameDialog.showModal();
    }
`,
`    function openGameDialog(card) {
      state.modalCard = card;
      setModalIcon(card);
      byId('modal-title').textContent = card.name || card.processName || 'Game';
      byId('modal-subtitle').textContent = \`${card.source || 'Manual'} · \${card.kind === 'auto' ? 'Automatically detected' : 'Manual game'}\`;
      byId('modal-name').value = card.name || card.defaultName || card.processName || 'Game';
      byId('modal-executable').value = card.overrideTarget || card.executablePath || card.processName || '';
      fillRateSelect(byId('modal-rate'), validRates, card.pollingRate, true);
      byId('modal-detection').value = card.detectionMode || 'default';
      byId('modal-hidden').checked = Boolean(card.hidden);
      byId('modal-remove').classList.toggle('hidden', card.kind !== 'auto' || !card.hasRuleOverride);
      byId('modal-delete').classList.toggle('hidden', card.kind !== 'manual');
      gameDialog.showModal();
    }
`, 'open modal metadata');

html = replaceOnce(html,
`    function upsertRule(target, pollingRate, detectionMode) {
`,
`    function metadataIdForCard(card) {
      return String(card && card.id || '').trim().toLowerCase();
    }

    function removeMetadataForCard(card) {
      const id = metadataIdForCard(card);
      state.gameMetadata = state.gameMetadata.filter((item) => String(item.id || '').trim().toLowerCase() !== id);
    }

    function upsertMetadataForCard(card, customName, hidden, target, previousId = null) {
      const id = metadataIdForCard(card);
      const oldId = String(previousId || '').trim().toLowerCase();
      state.gameMetadata = state.gameMetadata.filter((item) => {
        const itemId = String(item.id || '').trim().toLowerCase();
        return itemId !== id && (!oldId || itemId !== oldId);
      });

      if (customName || hidden) {
        state.gameMetadata.push({
          id: card.id,
          ...(customName ? { name: customName } : {}),
          ...(hidden ? { hidden: true } : {}),
          ...(target ? { target } : {}),
        });
      }
    }

    function upsertRule(target, pollingRate, detectionMode) {
`, 'metadata helpers');

const applyStart = html.indexOf('    function applyModalChanges() {');
const applyEnd = html.indexOf('\n    async function browseModalExecutable()', applyStart);
if (applyStart < 0 || applyEnd < 0) throw new Error('Could not locate applyModalChanges');
const newApply = `    function applyModalChanges() {
      const card = state.modalCard;
      if (!card) {
        return;
      }

      const target = byId('modal-executable').value.trim();
      if (!target) {
        setStatus('Choose an executable first.', true);
        return;
      }

      const displayName = byId('modal-name').value.trim();
      const rateValue = byId('modal-rate').value;
      const pollingRate = rateValue === 'default' ? null : Number(rateValue);
      const detectionMode = byId('modal-detection').value;
      const hidden = byId('modal-hidden').checked;
      const defaultName = card.defaultName || card.name || card.processName || 'Game';
      const customName = displayName && displayName !== defaultName ? displayName : null;
      const previousMetadataId = metadataIdForCard(card);

      if (card.kind === 'auto' && pollingRate === null && detectionMode === 'default'
        && normalizedPath(target) === normalizedPath(card.executablePath)) {
        removeRuleForCard(card);
        card.pollingRate = null;
        card.detectionMode = 'default';
        card.overrideTarget = null;
        card.hasRuleOverride = false;
      } else {
        upsertRule(target, pollingRate, detectionMode);
        card.pollingRate = pollingRate;
        card.detectionMode = detectionMode;
        card.overrideTarget = target;
        card.hasRuleOverride = true;
        card.executablePath = /^[a-z]:\\\\/i.test(target) ? target : card.executablePath;
        card.processName = target.split(/[\\\\/]/).pop();
        if (card.kind === 'manual') {
          card.id = \`manual:\${normalizedPath(target)}\`;
        }
      }

      card.customName = customName;
      card.name = customName || defaultName;
      card.hidden = hidden;
      card.customized = Boolean(card.hasRuleOverride || customName || hidden);
      upsertMetadataForCard(card, customName, hidden, target, previousMetadataId);

      closeGameDialog();
      renderGames();
      scheduleSave(0);
    }
`;
html = html.slice(0, applyStart) + newApply + html.slice(applyEnd);

html = replaceOnce(html,
`        name: selected.name || selected.processName,
        source: 'Manual',`,
`        name: selected.name || selected.processName,
        defaultName: selected.name || selected.processName,
        customName: null,
        hidden: false,
        source: 'Manual',`, 'manual card metadata defaults');
html = html.replace(`        customized: true,
        pollingRate: null,`, `        customized: true,
        hasRuleOverride: true,
        pollingRate: null,`);

html = replaceOnce(html,
`      state.gameFolders = result.gameFolders || [];
      state.libraries = result.libraries || [];
`,
`      state.gameFolders = result.gameFolders || [];
      state.gameMetadata = result.gameMetadata || [];
      state.libraries = result.libraries || [];
`, 'load metadata state');

html = replaceOnce(html,
`      card.customized = false;
      card.pollingRate = null;
      card.detectionMode = 'default';
      card.overrideTarget = null;
`,
`      card.hasRuleOverride = false;
      card.pollingRate = null;
      card.detectionMode = 'default';
      card.overrideTarget = null;
      card.customized = Boolean(card.customName || card.hidden);
`, 'remove rule preserves metadata');

html = replaceOnce(html,
`      removeRuleForCard(card);
      state.games = state.games.filter((item) => item !== card);
`,
`      removeRuleForCard(card);
      removeMetadataForCard(card);
      state.games = state.games.filter((item) => item !== card);
`, 'delete metadata');

fs.writeFileSync(settingsPath, html);

// ---- appConfig tests -------------------------------------------------------
const testPath = 'test/appConfig.test.js';
let tests = fs.readFileSync(testPath, 'utf8');
if (!tests.includes("config.ini persists custom game names and ignored games")) {
  tests += `\n\ntest('config.ini persists custom game names and ignored games', () => {\n  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-config-'));\n  const configPath = path.join(directory, 'config.ini');\n  const { entries } = parseProcessConfig('r5apex.exe default');\n  const metadata = [\n    { id: 'manual:r5apex.exe', name: 'R5Reloaded', target: 'r5apex.exe' },\n    { id: 'C:\\\\Games\\\\Hollow Knight', hidden: true, target: 'C:\\\\Games\\\\Hollow Knight\\\\hollow_knight.exe' },\n  ];\n\n  writeAppConfig(configPath, DEFAULT_SETTINGS, entries, ['C:\\\\Games'], metadata);\n  const readBack = readAppConfig(configPath);\n\n  assert.deepEqual(readBack.gameMetadata, [\n    { id: 'manual:r5apex.exe', name: 'R5Reloaded', target: 'r5apex.exe' },\n    { id: 'c:\\\\games\\\\hollow knight', hidden: true, target: 'c:\\\\games\\\\hollow knight\\\\hollow_knight.exe' },\n  ]);\n});\n`;
}
fs.writeFileSync(testPath, tests);

console.log('v1.3.4 game metadata/UI patch applied');
