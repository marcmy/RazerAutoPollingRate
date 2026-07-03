Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

function Read-NormalizedFile([string] $Path) {
    return ([IO.File]::ReadAllText($Path) -replace "`r`n", "`n")
}

function Write-NormalizedFile([string] $Path, [string] $Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Replace-Exactly([string] $Path, [string] $Old, [string] $New) {
    $content = Read-NormalizedFile $Path
    $matches = [regex]::Matches($content, [regex]::Escape($Old)).Count
    if ($matches -ne 1) {
        throw "Expected exactly one match in $Path, found $matches."
    }

    Write-NormalizedFile $Path ($content.Replace($Old, $New))
}

$main = 'src/main.js'

Replace-Exactly $main @'
const { createCheckGuard } = require('./lib/checkGuard');
const { createUsbAccessPolicy } = require('./lib/usbAccessPolicy');
const { DiagnosticLogger } = require('./lib/diagnosticLogger');
'@ @'
const { createCheckGuard } = require('./lib/checkGuard');
const { DiagnosticLogger } = require('./lib/diagnosticLogger');
const { retryImmediately } = require('./lib/retryImmediately');
'@

Replace-Exactly $main @'
let diagnosticLoggingEnabled = false;
let verboseDiagnosticLoggingEnabled = false;
let detectionEnabled = true;
'@ @'
let diagnosticLoggingEnabled = false;
let verboseDiagnosticLoggingEnabled = false;
let pollingCheckIntervalMs = DEFAULT_SETTINGS.pollingCheckIntervalMs;
let detectionEnabled = true;
'@

Replace-Exactly $main @'
let diagnosticLogger = null;
const assetsFolder = 'src/assets/';
const checkGuard = createCheckGuard();
const usbAccessPolicy = createUsbAccessPolicy();
const webUsb = new WebUSB({
  devicesFound: (devices) => devices.find((device) => device.vendorId === 0x1532
    && dongles[device.productId] !== undefined),
});
let lastKnownPollingRate = null;
'@ @'
let diagnosticLogger = null;
const assetsFolder = 'src/assets/';
const checkGuard = createCheckGuard();
let lastPollingError = null;
'@

Replace-Exactly $main @'
    diagnosticLogging: Boolean(diagnosticLoggingEnabled),
    verboseDiagnosticLogging: Boolean(verboseDiagnosticLoggingEnabled),
  };
'@ @'
    diagnosticLogging: Boolean(diagnosticLoggingEnabled),
    verboseDiagnosticLogging: Boolean(verboseDiagnosticLoggingEnabled),
    pollingCheckIntervalMs,
  };
'@

Replace-Exactly $main @'
  diagnosticLoggingEnabled = Boolean(settings.diagnosticLogging);
  verboseDiagnosticLoggingEnabled = Boolean(settings.verboseDiagnosticLogging);
}
'@ @'
  diagnosticLoggingEnabled = Boolean(settings.diagnosticLogging);
  verboseDiagnosticLoggingEnabled = Boolean(settings.verboseDiagnosticLogging);
  pollingCheckIntervalMs = settings.pollingCheckIntervalMs || DEFAULT_SETTINGS.pollingCheckIntervalMs;
}
'@

Replace-Exactly $main @'
        diagnosticLogging: Boolean(payload.settings.diagnosticLogging),
        verboseDiagnosticLogging: Boolean(payload.settings.verboseDiagnosticLogging),
      };
'@ @'
        diagnosticLogging: Boolean(payload.settings.diagnosticLogging),
        verboseDiagnosticLogging: Boolean(payload.settings.verboseDiagnosticLogging),
        pollingCheckIntervalMs,
      };
'@

Replace-Exactly $main '    await new Promise((res) => setTimeout(res, 1500));' '    await new Promise((res) => setTimeout(res, pollingCheckIntervalMs));'

Replace-Exactly $main @'
async function getDongle() {
  try {
'@ @'
async function getDongle() {
  const webUsb = new WebUSB({
    devicesFound: (devices) => devices.find((device) => device.vendorId === 0x1532
      && dongles[device.productId] !== undefined),
  });

  try {
'@

Replace-Exactly $main @'
async function getPollingRate(dongle) {
  const targetIndex = currentModel.interfaceIndex !== undefined ? currentModel.interfaceIndex : 0x00;

  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: targetIndex,
  }, getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));

  await new Promise((res) => setTimeout(res, 100));

  const reply = await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: targetIndex,
  }, 90);

  const pollingRate = getRateForReportByte(reply.data.getInt8(9));
  if (!pollingRate) {
    throw new Error('Dongle returned an unknown polling-rate response');
  }

  return pollingRate;
}
'@ @'
async function getPollingRateOnce(dongle) {
  const targetIndex = currentModel.interfaceIndex !== undefined ? currentModel.interfaceIndex : 0x00;

  await dongle.controlTransferOut({
    requestType: 'class',
    recipient: 'interface',
    request: 0x09,
    value: 0x300,
    index: targetIndex,
  }, getRazerReport(0x1F, 0x00, 0xC0, 0x01, 0x00, 0x00));

  await new Promise((res) => setTimeout(res, 100));

  const reply = await dongle.controlTransferIn({
    requestType: 'class',
    recipient: 'interface',
    request: 0x01,
    value: 0x300,
    index: targetIndex,
  }, 90);

  const responseLength = reply && reply.data ? reply.data.byteLength : 0;
  if (!reply || !reply.data || responseLength <= 9) {
    throw new Error(`Dongle returned a short polling-rate response (${responseLength} bytes)`);
  }

  const responseByte = reply.data.getUint8(9);
  const pollingRate = getRateForReportByte(responseByte);
  if (!pollingRate) {
    throw new Error(
      `Dongle returned an unknown polling-rate response (byte 0x${responseByte.toString(16).padStart(2, '0')}, length ${responseLength})`,
    );
  }

  return pollingRate;
}

async function getPollingRate(dongle) {
  return retryImmediately(() => getPollingRateOnce(dongle), {
    attempts: 3,
    onFailure: (error, attempt, attempts) => {
      recordDiagnosticEvent('polling_rate_query_attempt_failed', {
        attempt,
        attempts,
        error: error.message,
      }, { verbose: true });
    },
  });
}
'@

Replace-Exactly $main @'
async function checkPollingRate(firstRun) {
  let dongle;
  let claimedInterfaceNumber = null;
  let usbAttempted = false;
'@ @'
async function checkPollingRate(firstRun) {
  let dongle;
  let claimedInterfaceNumber = null;
'@

Replace-Exactly $main @'
    const usbDecision = usbAccessPolicy.shouldAccess({
      now: Date.now(),
      targetRate: requestedTarget,
      enabled: detectionEnabled,
      firstRun: Boolean(firstRun),
    });
    recordDiagnosticEvent('usb_access_decision', {
      access: usbDecision.access,
      reason: usbDecision.reason,
      requestedTarget,
      retryAfter: usbDecision.retryAfter || null,
      targetChanged: Boolean(usbDecision.targetChanged),
    }, {
      verbose: true,
      key: `${usbDecision.access}:${usbDecision.reason}:${requestedTarget}`,
    });

    if (!usbDecision.access) {
      return;
    }

    usbAttempted = true;
    dongle = await getDongle();
'@ @'
    if (!detectionEnabled) {
      recordDiagnosticEvent('usb_access_decision', {
        access: false,
        reason: 'disabled',
        requestedTarget,
      }, {
        verbose: true,
        key: `false:disabled:${requestedTarget}`,
      });
      return;
    }

    recordDiagnosticEvent('usb_access_decision', {
      access: true,
      reason: firstRun ? 'startup' : 'continuous_enforcement',
      requestedTarget,
    }, {
      verbose: true,
      key: `true:${firstRun ? 'startup' : 'continuous_enforcement'}:${requestedTarget}`,
    });
    recordDiagnosticEvent('polling_probe', {
      checkIntervalMs: pollingCheckIntervalMs,
      firstRun: Boolean(firstRun),
      requestedTarget,
    }, { verbose: true });

    dongle = await getDongle();
'@

Replace-Exactly $main @'
      currentRate: pollingRate,
      targetRate,
      requestedTarget,
      rules: entries.length,
'@ @'
      currentRate: pollingRate,
      targetRate,
      requestedTarget,
      checkIntervalMs: pollingCheckIntervalMs,
      rules: entries.length,
'@

Replace-Exactly $main @'
    lastKnownPollingRate = pollingRate;
    if (pollingRate === targetRate) {
      usbAccessPolicy.recordSuccess({
        now: Date.now(),
        targetRate: requestedTarget,
      });
    } else {
      const failure = usbAccessPolicy.recordFailure({ now: Date.now() });
      recordDiagnosticEvent('usb_access_backoff', {
        reason: 'target rate was not applied',
        backoffMs: failure.backoffMs,
        consecutiveErrors: failure.consecutiveErrors,
      });
    }
  } catch (error) {
    if (usbAttempted) {
      const failure = usbAccessPolicy.recordFailure({ now: Date.now() });
      recordDiagnosticEvent('usb_access_backoff', {
        reason: error.message,
        backoffMs: failure.backoffMs,
        consecutiveErrors: failure.consecutiveErrors,
      });
    }
    recordDiagnosticEvent('polling_check_error', {
      error: error.message,
    });
    setTrayStatus({
      icon: 'loading.png',
      tooltip: `Razer Auto Polling Rate error: ${error.message}`,
    });
    setRate = [0, false];
    console.error(error);
    log(error.toString(), true);
'@ @'
    lastPollingError = null;
  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    setRate = [0, false];

    if (lastPollingError !== errorMessage) {
      recordDiagnosticEvent('polling_check_error', {
        error: errorMessage,
      });
      setTrayStatus({
        icon: 'loading.png',
        tooltip: `Razer Auto Polling Rate error: ${errorMessage}`,
      });
      console.error(error);
      log(error.toString(), true);
      lastPollingError = errorMessage;
    }
'@

$appConfig = 'src/lib/appConfig.js'

Replace-Exactly $appConfig @'
  diagnosticLogging: false,
  verboseDiagnosticLogging: false,
};
'@ @'
  diagnosticLogging: false,
  verboseDiagnosticLogging: false,
  pollingCheckIntervalMs: 1500,
};

const MIN_POLLING_CHECK_INTERVAL_MS = 200;
const MAX_POLLING_CHECK_INTERVAL_MS = 60000;
'@

Replace-Exactly $appConfig @'
function parseIni(contents) {
'@ @'
function normalizePollingCheckIntervalMs(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    return DEFAULT_SETTINGS.pollingCheckIntervalMs;
  }

  const interval = Number(text);
  if (!Number.isSafeInteger(interval)
    || interval < MIN_POLLING_CHECK_INTERVAL_MS
    || interval > MAX_POLLING_CHECK_INTERVAL_MS) {
    return DEFAULT_SETTINGS.pollingCheckIntervalMs;
  }

  return interval;
}

function parseIni(contents) {
'@

Replace-Exactly $appConfig @'
    verboseDiagnosticLogging: parseBoolean(
      rawSettings.verbose_diagnostic_logging,
      DEFAULT_SETTINGS.verboseDiagnosticLogging,
    ),
  };
'@ @'
    verboseDiagnosticLogging: parseBoolean(
      rawSettings.verbose_diagnostic_logging,
      DEFAULT_SETTINGS.verboseDiagnosticLogging,
    ),
    pollingCheckIntervalMs: normalizePollingCheckIntervalMs(rawSettings.polling_check_interval_ms),
  };
'@

Replace-Exactly $appConfig @'
    `diagnostic_logging=${normalizedSettings.diagnosticLogging ? 'true' : 'false'}`,
    `verbose_diagnostic_logging=${normalizedSettings.verboseDiagnosticLogging ? 'true' : 'false'}`,
    '',
'@ @'
    `diagnostic_logging=${normalizedSettings.diagnosticLogging ? 'true' : 'false'}`,
    `verbose_diagnostic_logging=${normalizedSettings.verboseDiagnosticLogging ? 'true' : 'false'}`,
    '# Debug only: default 1500 ms; accepted range 200-60000 ms.',
    `polling_check_interval_ms=${normalizePollingCheckIntervalMs(normalizedSettings.pollingCheckIntervalMs)}`,
    '',
'@

Replace-Exactly $appConfig @'
module.exports = {
  DEFAULT_SETTINGS,
  configExists,
  normalizeSettings,
'@ @'
module.exports = {
  DEFAULT_SETTINGS,
  MAX_POLLING_CHECK_INTERVAL_MS,
  MIN_POLLING_CHECK_INTERVAL_MS,
  configExists,
  normalizePollingCheckIntervalMs,
  normalizeSettings,
'@

$appConfigTest = 'test/appConfig.test.js'

Replace-Exactly $appConfigTest @'
  DEFAULT_SETTINGS,
  readAppConfig,
'@ @'
  DEFAULT_SETTINGS,
  normalizePollingCheckIntervalMs,
  readAppConfig,
'@

Replace-Exactly $appConfigTest @'
    diagnosticLogging: true,
    verboseDiagnosticLogging: true,
  }, entries);
'@ @'
    diagnosticLogging: true,
    verboseDiagnosticLogging: true,
    pollingCheckIntervalMs: 500,
  }, entries);
'@

Replace-Exactly $appConfigTest @'
  assert.match(contents, /verbose_diagnostic_logging=true/);
  assert.match(contents, /\[rules\]/);
'@ @'
  assert.match(contents, /verbose_diagnostic_logging=true/);
  assert.match(contents, /polling_check_interval_ms=500/);
  assert.match(contents, /\[rules\]/);
'@

Replace-Exactly $appConfigTest @'
    'verbose_diagnostic_logging=false',
    '',
'@ @'
    'verbose_diagnostic_logging=false',
    'polling_check_interval_ms=200',
    '',
'@

Replace-Exactly $appConfigTest @'
    diagnosticLogging: true,
    verboseDiagnosticLogging: false,
  });
'@ @'
    diagnosticLogging: true,
    verboseDiagnosticLogging: false,
    pollingCheckIntervalMs: 200,
  });
'@

Replace-Exactly $appConfigTest @'
test('writeAppConfig writes a readable config.ini', () => {
'@ @'
test('debug polling interval accepts 200 ms and rejects invalid values', () => {
  assert.equal(normalizePollingCheckIntervalMs('200'), 200);
  assert.equal(normalizePollingCheckIntervalMs('500'), 500);
  assert.equal(normalizePollingCheckIntervalMs('199'), DEFAULT_SETTINGS.pollingCheckIntervalMs);
  assert.equal(normalizePollingCheckIntervalMs('not-a-number'), DEFAULT_SETTINGS.pollingCheckIntervalMs);
});

test('writeAppConfig writes a readable config.ini', () => {
'@

Replace-Exactly 'test/run-tests.js' "require('./usbAccessPolicy.test');" "require('./retryImmediately.test');"

Replace-Exactly 'CHANGELOG.md' @'
# Changelog

## v1.3.1
'@ @'
# Changelog

## v1.3.2

- Restored continuous 1500 ms dongle verification while detection is enabled so polling-rate changes from Razer Synapse are corrected promptly.
- Replaced the v1.3.0 target-change gating, five-minute health checks, and exponential USB backoff with continuous enforcement.
- Added three immediate polling-rate query attempts within the same open USB session before reporting a check failure.
- Added the debug-only `polling_check_interval_ms` config value (default `1500`, minimum `200`) and per-probe verbose diagnostics for testing shorter enforcement intervals.
- Kept USB access fully disabled when the runtime detection toggle is off and suppressed repeated identical error notifications while recovery checks continue.

## v1.3.1
'@
