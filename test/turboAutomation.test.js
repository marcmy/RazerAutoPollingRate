const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProcessConfig, serializeProcessConfig } = require('../src/lib/config');
const { serializeAppConfig, parseIni } = require('../src/lib/appConfig');
const { applyTurboMode, supportsTurboMode } = require('../src/lib/mouseBackends/turboAutomation');

function fakeBackend() {
  let value = false;
  const writes = [];
  return {
    id: 'pulsar-x2-crazylight', capabilities: { turboMode: true },
    deviceInfo: { vendorId: 0x3710, productId: 0x5406 }, writes,
    getActiveProfile: async () => 1,
    getTurboMode: async () => value,
    setTurboMode: async (target, profile) => { assert.equal(profile, 1); value = target; writes.push(target); },
  };
}

test('Turbo rules survive INI serialization with default rate and running detection', () => {
  const { entries, warnings } = parseProcessConfig('game.exe default running turbo=on\nother.exe 1000');
  assert.deepEqual(warnings, []);
  const ini = parseIni(serializeAppConfig({}, entries));
  const restored = parseProcessConfig(Object.values(ini.rules).join('\n')).entries;
  assert.equal(restored[0].turboMode, true);
  assert.equal(restored[0].detectionMode, 'running');
  assert.equal(restored[0].pollingRate, null);
  assert.equal(restored[1].turboMode, undefined);
  assert.equal(serializeProcessConfig(restored), 'game.exe default running turbo=on\nother.exe 1000');
});

test('Turbo follows matching game and resets on desktop, another game, or detection disable', async () => {
  const backend = fakeBackend();
  const game = { matchedRule: { turboMode: true } };
  await applyTurboMode(backend, {}, true);
  await applyTurboMode(backend, game, true);
  await applyTurboMode(backend, game, true);
  await applyTurboMode(backend, {}, true);
  await applyTurboMode(backend, game, true);
  await applyTurboMode(backend, { matchedRule: {} }, true);
  await applyTurboMode(backend, game, true);
  await applyTurboMode(backend, game, false);
  assert.deepEqual(backend.writes, [true, false, true, false, true, false]);
});

test('Razer and unrecognized Pulsar devices receive no Turbo traffic', async () => {
  for (const overrides of [{ id: 'razer' }, { deviceInfo: { vendorId: 0x3710, productId: 0x9999 } }, { capabilities: {} }]) {
    const backend = { ...fakeBackend(), ...overrides, getActiveProfile: () => { throw new Error('unexpected HID access'); } };
    assert.equal(supportsTurboMode(backend), false);
    assert.equal(await applyTurboMode(backend, { matchedRule: { turboMode: true } }, true), null);
  }
});

test('Turbo aborts if profile changes between profile and setting reads', async () => {
  const backend = fakeBackend();
  let profile = 0;
  backend.getActiveProfile = async () => ++profile;
  await assert.rejects(() => applyTurboMode(backend, { matchedRule: { turboMode: true } }, true), /profile changed/);
  assert.deepEqual(backend.writes, []);
});

const { selectConfiguredPollingRate } = require('../src/lib/processes');
test('Turbo uses foreground matching on Alt-Tab and running matching until game exits', async () => {
  for (const mode of ['foreground', 'running']) {
    const entries = parseProcessConfig(`game.exe default ${mode} turbo=on`).entries;
    const backend = fakeBackend();
    const select = (foreground, running) => selectConfiguredPollingRate(entries, {
      foregroundProcess: { processName: foreground },
      runningProcesses: running.map((processName) => ({ processName })),
      inactivePollingRate: 250, defaultGamePollingRate: 4000,
    });
    await applyTurboMode(backend, select('game.exe', ['game.exe']), true);
    await applyTurboMode(backend, select('explorer.exe', ['game.exe']), true);
    assert.deepEqual(backend.writes, mode === 'foreground' ? [true, false] : [true]);
    await applyTurboMode(backend, select('explorer.exe', []), true);
    assert.deepEqual(backend.writes, [true, false]);
  }
});
