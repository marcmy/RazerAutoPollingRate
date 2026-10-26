const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMouseIdlePolicy } = require('../src/lib/mouseIdle');
const { createMouseTelemetryReader } = require('../src/lib/mouseTelemetry');
const { supportsTurboMode, applyTurboMode } = require('../src/lib/mouseBackends/turboAutomation');
const { resolveSupportedPollingRate } = require('../src/lib/rates');

function harness() {
  const state = {
    time: 1000, lastInput: 1000, generation: 1, connection: 'receiver', ready: true,
    mouse: { backend: 'pulsar', vendorId: 0x3710, productId: 0x5406 },
    rate: 125, turbo: false, failRate: false, calls: [], tooltips: [], events: [], bridgesClosed: 0,
    selected: { targetRate: 125, matchedProcess: null, matchedRule: null, source: 'inactive', game: null },
  };
  const readMouseTelemetry = createMouseTelemetryReader({ now: () => state.time });
  const context = vm.createContext({
    console: { error() {} }, lowerRate: 125, detectionEnabled: true, diagnosticLoggingEnabled: false,
    turboAutomationUsed: false, settingsWindow: null, lastPollingError: null, setRate: [0, false],
    runtimeStatus: {}, updateCoordinator: null, gameLibraries: [],
    mouseIdlePolicy: createMouseIdlePolicy({ now: () => state.time }), readMouseTelemetry,
    loadConfig: () => ({ settings: {}, entries: [{ turboMode: true }], gameFolders: [], gameMetadata: [] }),
    applySettings() {}, syncGameLibraries() {}, isRuleHidden: () => false,
    getForegroundProcess: () => null, stopForegroundProcessWatcher() {}, getDetectionMode: () => 'foreground',
    getDetectionModeLabel: (mode) => mode, ruleNeedsRunningProcesses: () => false, updateDiagnosticSession() {},
    createInactiveSelection: () => ({ targetRate: 125, matchedProcess: null, matchedRule: null, source: 'inactive', game: null }),
    selectCurrentPollingRate: () => state.selected,
    updateRuntimeSelection(selected) { Object.assign(context.runtimeStatus, { enabled: context.detectionEnabled, targetRate: selected.targetRate }); },
    describeDiscoveredProcess() {}, log() {},
    recordDiagnosticEvent: (event, details) => state.events.push({ event, details }),
    supportsTurboMode, applyTurboMode, resolveSupportedPollingRate,
    getPollingRateIcon: (rate, active) => `${rate}${active ? 'a' : ''}.png`,
    setTrayStatus: (status) => state.tooltips.push(status.tooltip),
    closeAllWindowsHidOutputBridges: async () => { state.bridgesClosed++; },
    createPreferredMouseBackend: async () => {
      const mouse = state.mouse;
      const wired = mouse.productId === 0x3414 || mouse.productId === 0x3524;
      let opened = false;
      const backend = {
        id: mouse.backend === 'razer' ? 'razer' : 'pulsar-x2-crazylight',
        name: 'Test mouse', connection: wired ? 'wired' : 'wireless', canWrite: !wired,
        capabilities: { turboMode: !wired }, supportedRates: [125, 250, 500, 1000, 4000, 8000],
        deviceInfo: { vendorId: mouse.vendorId, productId: mouse.productId, path: String(mouse.productId), productName: 'Test mouse' },
        discover: async () => { state.calls.push('discover'); },
        open: async () => { opened = true; state.calls.push('open'); },
        close: async () => { if (opened) state.calls.push('close'); },
        getActiveProfile: async () => { state.calls.push('profile'); return 1; },
        getTurboMode: async () => { state.calls.push('turbo'); return state.turbo; },
        setTurboMode: async (value, profile) => { assert.equal(profile, 1); state.calls.push(`setTurbo:${value}`); state.turbo = value; },
        getPollingRate: async () => {
          state.calls.push('rate');
          if (state.failRate) throw new Error('read failed');
          return state.rate;
        },
        setPollingRate: async (value) => { state.calls.push(`setRate:${value}`); state.rate = value; return value; },
        getBatteryStatus: async () => { state.calls.push('battery'); return { batteryPercent: 75, charging: false }; },
      };
      return {
        backend, selectedMouse: mouse, connectionToken: state.connection,
        activityTracker: { getLastActivity: () => state.lastInput, isMonitoringReady: () => state.ready, getConnectionGeneration: () => state.generation },
      };
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  vm.runInContext(`${source.slice(source.indexOf('async function checkPollingRate(firstRun)'))}\nthis.check = checkPollingRate;`, context);
  return { state, context, check: () => context.check(false) };
}

test('the actual polling loop stops all configuration/battery calls while idle, retains status and refreshes on input', async () => {
  const { state, context, check } = harness();
  await check();
  assert.equal(context.runtimeStatus.error, null, JSON.stringify(state.events.filter((entry) => entry.event === 'polling_check_error')));
  assert.equal(context.runtimeStatus.currentRate, 125);
  assert.equal(context.runtimeStatus.turboMode, false);
  const before = state.calls.length;
  for (let time = 11000; time < 3611000; time += 1500) {
    state.time = time;
    await check();
  }
  assert.equal(state.calls.length, before);
  assert.equal(state.bridgesClosed, 1);
  assert.equal(context.runtimeStatus.queriesPaused, true);
  assert.equal(context.runtimeStatus.batteryPercent, 75);
  assert.match(state.tooltips.at(-1), /last verified 125 Hz/);
  state.lastInput = state.time;
  await check();
  assert.equal(context.runtimeStatus.queriesPaused, false);
  assert.equal(state.calls.filter((call) => call === 'battery').length, 2, 'refresh cached battery on resume');
  assert.doesNotMatch(state.tooltips.at(-1), /idle/);
});

test('game entry, same-rate Turbo changes and desktop reset apply while the mouse remains idle', async () => {
  const { state, check } = harness();
  await check();
  state.time = 20000;
  await check();
  state.selected = { targetRate: 4000, matchedProcess: 'game.exe', matchedRule: { turboMode: true }, source: 'rule', game: null };
  await check();
  assert.equal(state.rate, 4000);
  assert.equal(state.turbo, true);
  await check(); // The game settings are now verified: quiet again.
  state.selected = { ...state.selected, matchedRule: { turboMode: false } };
  await check();
  assert.equal(state.turbo, false);
  assert.equal(state.rate, 4000);
  state.selected = { targetRate: 125, matchedProcess: null, matchedRule: null, source: 'inactive', game: null };
  await check();
  assert.equal(state.rate, 125);
  assert.equal(state.turbo, false);
  assert.ok(state.calls.includes('setTurbo:true'));
  assert.ok(state.calls.includes('setTurbo:false'));
});

test('receiver changes and input-monitor failure resume checks; failed reads cannot establish an idle cache', async () => {
  const { state, context, check } = harness();
  await check();
  state.time = 20000;
  await check();
  state.generation++;
  await check();
  assert.equal(context.runtimeStatus.queriesPaused, false);
  await check();
  assert.equal(context.runtimeStatus.queriesPaused, true);
  state.ready = false;
  await check();
  assert.equal(context.runtimeStatus.queriesPaused, false);
  state.ready = true;
  state.generation++; // A restarted passive monitor emits READY with a new generation.
  state.failRate = true;
  await check();
  const count = state.calls.length;
  await check();
  assert.ok(state.calls.length > count, 'failed state must keep checking');
  assert.equal(context.runtimeStatus.queriesPaused, false);
});

test('Razer and wired mice retain normal checking after long inactivity', async () => {
  for (const mouse of [
    { backend: 'razer', vendorId: 0x1532, productId: 0x00e5 },
    { backend: 'pulsar', vendorId: 0x3710, productId: 0x3414 },
    { backend: 'pulsar', vendorId: 0x3710, productId: 0x3524 },
  ]) {
    const { state, context, check } = harness();
    state.mouse = mouse;
    await check();
    const count = state.calls.length;
    state.time = 20000;
    await check();
    assert.ok(state.calls.length > count);
    assert.equal(context.runtimeStatus.queriesPaused, false);
    assert.equal(state.bridgesClosed, 0);
    if (mouse.backend === 'razer') assert.equal(state.calls.includes('turbo'), false);
  }
});

test('disabling detection verifies Turbo off once, then can pause without further rate or battery reads', async () => {
  const { state, context, check } = harness();
  state.turbo = true;
  context.detectionEnabled = false;
  await check();
  assert.equal(state.turbo, false);
  assert.equal(state.calls.includes('rate'), false);
  assert.equal(state.calls.includes('battery'), false);
  state.time = 20000;
  const count = state.calls.length;
  await check();
  assert.equal(state.calls.length, count);
  assert.equal(context.runtimeStatus.queriesPaused, true);
  assert.doesNotMatch(state.tooltips.at(-1), /last verified/);
});
