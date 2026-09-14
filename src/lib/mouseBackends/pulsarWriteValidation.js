'use strict';

function chooseValidationTarget(originalRate, requestedTarget) {
  if (requestedTarget !== undefined && requestedTarget !== null) {
    const target = Number(requestedTarget);
    if (!Number.isFinite(target)) {
      throw new Error(`Invalid CrazyLight validation target ${requestedTarget}`);
    }
    if (target === originalRate) {
      throw new Error(`CrazyLight validation target ${target} Hz matches the original rate`);
    }
    return target;
  }

  return originalRate === 1000 ? 8000 : 1000;
}

function combineFailures(primaryError, restoreError) {
  if (primaryError && restoreError) {
    const combined = new Error(
      `${primaryError.message}; restore failed: ${restoreError.message}`,
    );
    combined.cause = primaryError;
    combined.restoreError = restoreError;
    return combined;
  }
  return primaryError || restoreError;
}

async function validateCrazyLightPollingWrite(options = {}) {
  const { backend } = options;
  const log = options.log || (() => {});
  if (!backend) {
    throw new Error('CrazyLight write validation requires a backend');
  }

  let opened = false;
  let writeAttempted = false;
  let originalProfile = null;
  let originalRate = null;
  let targetRate = null;
  let primaryError = null;
  let result = null;

  try {
    await backend.discover();
    await backend.open();
    opened = true;

    originalProfile = await backend.getActiveProfile();
    originalRate = await backend.getPollingRate();
    targetRate = chooseValidationTarget(originalRate, options.targetRate);

    log(`[Pulsar write validation] Baseline: profile ${originalProfile}; ${originalRate} Hz.`);
    log(`[Pulsar write validation] Testing ${originalRate} -> ${targetRate} Hz.`);

    // Mark this before awaiting: a transport/readback failure can happen after
    // the device accepted the write, so restoration must still be attempted.
    writeAttempted = true;
    await backend.setPollingRate(targetRate);

    const profileAfterTarget = await backend.getActiveProfile();
    if (profileAfterTarget !== originalProfile) {
      throw new Error(
        `CrazyLight profile changed during write validation: ${originalProfile} -> ${profileAfterTarget}`,
      );
    }

    log(`[Pulsar write validation] Target verified: profile ${profileAfterTarget}; ${targetRate} Hz.`);
    result = {
      originalProfile,
      originalRate,
      targetRate,
      targetProfile: profileAfterTarget,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    let restoreError = null;

    if (opened && writeAttempted && originalRate !== null) {
      try {
        const profileBeforeRestore = await backend.getActiveProfile();
        if (profileBeforeRestore !== originalProfile) {
          throw new Error(
            `CrazyLight profile changed before restore: ${originalProfile} -> ${profileBeforeRestore}; `
            + 'refusing to restore polling rate to a different profile',
          );
        }
        log(`[Pulsar write validation] Restoring ${originalRate} Hz.`);
        await backend.setPollingRate(originalRate);
        const restoredProfile = await backend.getActiveProfile();
        if (restoredProfile !== originalProfile) {
          throw new Error(
            `CrazyLight profile changed during restore: ${originalProfile} -> ${restoredProfile}`,
          );
        }
        log(`[Pulsar write validation] Restore verified: profile ${restoredProfile}; ${originalRate} Hz.`);
        if (result) {
          result.restoredProfile = restoredProfile;
          result.restoredRate = originalRate;
        }
      } catch (error) {
        restoreError = error;
      }
    }

    let closeError = null;
    if (opened) {
      try {
        await backend.close();
      } catch (error) {
        closeError = error;
      }
    }

    const operationError = combineFailures(primaryError, restoreError);
    if (operationError && closeError) {
      throw new Error(`${operationError.message}; close failed: ${closeError.message}`);
    }
    if (operationError) {
      throw operationError;
    }
    if (closeError) {
      throw closeError;
    }
  }

  return result;
}

module.exports = {
  chooseValidationTarget,
  validateCrazyLightPollingWrite,
};
