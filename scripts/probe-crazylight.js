'use strict';

const { runCrazyLightProbe } = require('../src/lib/mouseBackends/startupProbe');
const {
  closeAllWindowsHidOutputBridges,
} = require('../src/lib/mouseBackends/windowsHidOutputReport');

async function main() {
  const result = await runCrazyLightProbe({
    log: (line) => console.log(line),
  });

  if (result.probe) {
    return;
  }

  if (result.error) {
    process.exitCode = 1;
    return;
  }

  if (result.discovery.unknownPulsar.length > 0) {
    console.log('[Pulsar probe] Pulsar USB hardware was found, but its PID is not yet validated. No protocol commands were sent.');
    return;
  }

  console.log('[Pulsar probe] No Pulsar USB device (VID 0x3710) detected.');
}

async function run() {
  try {
    await main();
  } finally {
    await closeAllWindowsHidOutputBridges();
  }
}

run().catch((error) => {
  console.error(`[Pulsar probe] Fatal error: ${error.message}`);
  process.exitCode = 1;
});
