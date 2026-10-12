const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreferredMouseBackend } = require('../src/lib/mouseBackends/runtime');
const { runCrazyLightProbe } = require('../src/lib/mouseBackends/startupProbe');

// USB v3 exposes WebUSB identity fields, not legacy deviceDescriptor fields.
const wired = { vendorId: 0x3710, productId: 0x3524, serialNumber: 'wired-mouse' };
const receiver = { vendorId: 0x3710, productId: 0x5406, serialNumber: 'receiver' };
const razer = { vendorId: 0x1532, productId: 0x00e5, serialNumber: 'razer-mouse' };

test('runtime waits for USB v3 discovery before selecting the wired CrazyLight', async () => {
  let finishDiscovery;
  let constructed = false;
  const selection = createPreferredMouseBackend({
    getDevices: () => new Promise((resolve) => { finishDiscovery = resolve; }),
    activityTracker: {},
    createPulsarBackend: (options) => {
      constructed = true;
      return { id: 'pulsar', selectedProduct: options.preferredProductId, selectedSerial: options.preferredSerialNumber };
    },
  });
  assert.equal(constructed, false);
  finishDiscovery([receiver, wired]);
  const result = await selection;
  assert.equal(result.path, 'pulsar');
  assert.equal(result.selectedMouse.productId, 0x3524);
  assert.equal(result.backend.selectedProduct, 0x3524);
  assert.equal(result.backend.selectedSerial, 'wired-mouse');
});

test('USB v3 enumeration preserves Razer priority and the active mouse override', async () => {
  const options = {
    getDevices: async () => [receiver, razer],
    activityTracker: {},
    createRazerBackend: () => ({ id: 'razer' }),
    createPulsarBackend: () => ({ id: 'pulsar' }),
  };
  assert.equal((await createPreferredMouseBackend(options)).path, 'razer');
  const active = await createPreferredMouseBackend({
    ...options,
    activityTracker: { choosePreferredMouse: () => ({ backend: 'pulsar', ...receiver }) },
  });
  assert.equal(active.path, 'pulsar');
  assert.equal(active.selectedMouse.serialNumber, 'receiver');
});

test('each runtime selection refreshes devices after a disconnect or reconnect', async () => {
  let devices = [receiver];
  const options = {
    getDevices: async () => devices,
    activityTracker: {},
    createPulsarBackend: () => ({ id: 'pulsar' }),
  };
  assert.equal((await createPreferredMouseBackend(options)).selectedMouse.productId, 0x5406);
  devices = [];
  await assert.rejects(() => createPreferredMouseBackend(options), /No supported Razer or Pulsar/);
  devices = [wired];
  assert.equal((await createPreferredMouseBackend(options)).selectedMouse.productId, 0x3524);
});

test('USB v3 startup probe selects the wired identity and remains read-only', async () => {
  const result = await runCrazyLightProbe({
    getDevices: async () => [receiver, wired],
    createBackend: (options) => {
      assert.equal(options.preferredProductId, 0x3524);
      assert.notEqual(options.allowHardwareValidationWrites, true);
      return { probe: async () => ({ name: 'Pulsar X2 CrazyLight', activeProfile: 2, pollingRate: 1000 }) };
    },
  });
  assert.equal(result.error, null);
  assert.equal(result.probe.pollingRate, 1000);
});

test('USB v3 discovery failures remain visible and do not construct a backend', async () => {
  const failure = new Error('native USB enumeration failed');
  const options = {
    getDevices: async () => { throw failure; },
    activityTracker: {},
    createRazerBackend: () => assert.fail('must not construct a Razer backend'),
    createPulsarBackend: () => assert.fail('must not construct a Pulsar backend'),
    createBackend: () => assert.fail('must not construct a probe backend'),
  };
  await assert.rejects(() => createPreferredMouseBackend(options), (error) => error === failure);
  await assert.rejects(() => runCrazyLightProbe(options), (error) => error === failure);
});

test('unknown USB v3 Pulsar identities do not receive protocol commands', async () => {
  const options = {
    getDevices: async () => [{ vendorId: 0x3710, productId: 0x9999 }],
    activityTracker: {},
    createPulsarBackend: () => assert.fail('unsupported mouse must not receive commands'),
    createBackend: () => assert.fail('unsupported mouse must not be probed'),
  };
  await assert.rejects(() => createPreferredMouseBackend(options), /No supported Razer or Pulsar/);
  const result = await runCrazyLightProbe(options);
  assert.equal(result.discovery.unknownPulsar.length, 1);
  assert.equal(result.probe, null);
});
