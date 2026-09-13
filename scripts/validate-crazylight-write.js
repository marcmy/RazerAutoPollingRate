'use strict';

const { createPulsarCrazyLightBackend } = require('../src/lib/mouseBackends/pulsarCrazyLight');
const { validateCrazyLightPollingWrite } = require('../src/lib/mouseBackends/pulsarWriteValidation');

function parseTargetRate(raw) {
  if (raw === undefined) return undefined;
  const rate = Number(raw);
  if (!Number.isFinite(rate)) {
    throw new Error(`Target polling rate must be numeric; received ${raw}`);
  }
  return rate;
}

async function main() {
  const targetRate = parseTargetRate(process.argv[2]);
  const backend = createPulsarCrazyLightBackend({
    allowHardwareValidationWrites: true,
    log: (line) => console.log(`[Pulsar write validation] ${line}`),
  });

  const result = await validateCrazyLightPollingWrite({
    backend,
    targetRate,
    log: (line) => console.log(line),
  });

  console.log(
    `[Pulsar write validation] PASS: profile ${result.originalProfile}; `
    + `${result.originalRate} -> ${result.targetRate} -> ${result.restoredRate} Hz.`,
  );
}

main().catch((error) => {
  console.error(`[Pulsar write validation] FAILED: ${error.message}`);
  process.exitCode = 1;
});
