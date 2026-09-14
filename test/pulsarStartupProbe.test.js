const test = require('node:test');
const assert = require('node:assert/strict');

const { runCrazyLightProbe } = require('../src/lib/mouseBackends/startupProbe');

function rawUsb(vendorId, productId) {
  return {
    deviceDescriptor: {
      idVendor: vendorId,
      idProduct: productId,
    },
  };
}

test('startup probe reports unknown Pulsar identity without constructing a protocol backend', async () => {
  let backendConstructed = false;
  const lines = [];

  const result = await runCrazyLightProbe({
    getDeviceList: () => [rawUsb(0x3710, 0x7777)],
    createBackend: () => {
      backendConstructed = true;
      throw new Error('must not be called');
    },
    log: (line) => lines.push(line),
  });

  assert.equal(backendConstructed, false);
  assert.equal(result.probe, null);
  assert.equal(result.discovery.unknownPulsar.length, 1);
  assert.ok(lines.some((line) => /3710:7777/i.test(line) && /unsupported/i.test(line)));
});

test('startup probe queries validated CrazyLight and reports profile and polling rate', async () => {
  const lines = [];
  let probeCalls = 0;

  const result = await runCrazyLightProbe({
    getDeviceList: () => [rawUsb(0x3710, 0x5406)],
    createBackend: () => ({
      async probe() {
        probeCalls += 1;
        return {
          backend: 'pulsar-x2-crazylight',
          name: 'Pulsar X2 CrazyLight',
          vendorId: 0x3710,
          productId: 0x5406,
          activeProfile: 2,
          pollingRate: 4000,
          canWrite: false,
        };
      },
    }),
    log: (line) => lines.push(line),
  });

  assert.equal(probeCalls, 1);
  assert.equal(result.probe.pollingRate, 4000);
  assert.equal(result.probe.activeProfile, 2);
  assert.ok(lines.some((line) => /profile 2/i.test(line) && /4000 Hz/i.test(line) && /read-only/i.test(line)));
});

test('startup probe preserves probe errors as diagnostics instead of hiding them', async () => {
  const lines = [];
  const result = await runCrazyLightProbe({
    getDeviceList: () => [rawUsb(0x3710, 0x5406)],
    createBackend: () => ({
      async probe() {
        throw new Error('claimInterface failed');
      },
    }),
    log: (line) => lines.push(line),
  });

  assert.equal(result.probe, null);
  assert.match(result.error, /claimInterface failed/);
  assert.ok(lines.some((line) => /probe failed/i.test(line) && /claimInterface failed/i.test(line)));
});
