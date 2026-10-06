const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { getGameActivity } = require('../src/lib/gameActivity');
const { selectConfiguredPollingRate } = require('../src/lib/processes');
const { parseProcessConfig } = require('../src/lib/config');

const cards = [
  { id: 'steam:1172470', processName: 'r5apex_dx12.exe', executablePath: 'D:\\Steam\\Apex\\r5apex_dx12.exe' },
  { id: 'ea:apex', processName: 'r5apex_dx12.exe', executablePath: 'D:\\EA\\Apex\\r5apex_dx12.exe' },
];

function runtimeFor(processInfo, mode = 'foreground') {
  const entries = parseProcessConfig(cards.map((card, index) =>
    `"${card.executablePath}" 4000 ${mode}${index === 0 ? ' turbo=on' : ''}`).join('\n')).entries;
  const selected = selectConfiguredPollingRate(entries, {
    foregroundProcess: processInfo,
    runningProcesses: [processInfo],
    inactivePollingRate: 125,
  });
  return {
    enabled: true,
    matchedProcess: selected.matchedProcess,
    matchedProcessName: selected.matchedProcessInfo?.processName,
    matchedExecutablePath: selected.matchedProcessInfo?.executablePath,
    targetRate: selected.targetRate,
  };
}

test('only the exact Steam or EA Apex card is active in foreground and running detection', () => {
  for (const mode of ['foreground', 'running']) {
    for (const activeCard of cards) {
      const runtime = runtimeFor({ processName: activeCard.processName, executablePath: activeCard.executablePath }, mode);
      // The focused window may be unrelated while a running-mode rule matches.
      runtime.processName = 'explorer.exe';
      runtime.executablePath = 'C:\\Windows\\explorer.exe';
      assert.equal(runtime.targetRate, 4000);
      assert.deepEqual(cards.map((card) => getGameActivity(card, runtime, cards)),
        cards.map((card) => card === activeCard ? 'active' : 'inactive'));
    }
  }
});

test('unidentified duplicate copies share a rate without claiming either installation is active', () => {
  const runtime = runtimeFor({ processName: 'r5apex_dx12.exe', executablePath: null });
  assert.equal(runtime.targetRate, 4000);
  assert.deepEqual(cards.map((card) => getGameActivity(card, runtime, cards)), ['ambiguous', 'ambiguous']);
  assert.equal(getGameActivity(cards[0], runtime, [cards[0]]), 'active');
  assert.equal(getGameActivity({ processName: 'r5apex_dx12.exe' }, runtime, cards), 'active');
});

test('known library identity, ignored games, inactive detection and unrelated same-name paths are respected', () => {
  const runtime = { ...runtimeFor(cards[0]), gameId: cards[0].id };
  assert.deepEqual(cards.map((card) => getGameActivity(card, runtime, cards)), ['active', 'inactive']);
  assert.equal(getGameActivity({ ...cards[0], hidden: true }, runtime, cards), 'inactive');
  assert.equal(getGameActivity(cards[0], { ...runtime, enabled: false }, cards), 'inactive');
  assert.equal(getGameActivity(cards[0], { ...runtime, matchedProcess: null }, cards), 'inactive');
  assert.equal(getGameActivity(cards[0], runtimeFor({ processName: 'r5apex_dx12.exe', executablePath: 'D:\\Other\\r5apex_dx12.exe' }), cards), 'inactive');
});

test('the Settings browser helper uses the same card matching behavior as Node', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../src/lib/gameActivity'), 'utf8'), context);
  assert.equal(context.gameActivity.getGameActivity(cards[0], runtimeFor(cards[0]), cards), 'active');
  assert.equal(context.gameActivity.getGameActivity(cards[1], runtimeFor(cards[0]), cards), 'inactive');
});
