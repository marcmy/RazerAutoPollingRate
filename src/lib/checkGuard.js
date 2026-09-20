let latestGuard = null;

function createCheckGuard() {
  let running = false;
  let lastWork = null;
  let rerunScheduled = false;
  let rerunPending = false;

  async function run(work) {
    if (typeof work === 'function') {
      lastWork = work;
    }

    if (running) {
      return { skipped: true };
    }

    if (typeof lastWork !== 'function') {
      throw new Error('No polling check has been registered');
    }

    running = true;
    try {
      const result = await lastWork();
      return { skipped: false, result };
    } finally {
      running = false;
      if (rerunPending) {
        rerunPending = false;
        requestRerun();
      }
    }
  }

  function requestRerun() {
    if (typeof lastWork !== 'function') {
      return false;
    }

    if (running) {
      rerunPending = true;
      return true;
    }

    if (rerunScheduled) {
      return true;
    }

    rerunScheduled = true;
    setImmediate(() => {
      rerunScheduled = false;
      run(lastWork).catch(() => {
        // The normal polling check owns user-facing/logging error handling.
        // Avoid creating an unhandled rejection if a caller supplies a work
        // function that rejects outside that production path.
      });
    });
    return true;
  }

  const guard = {
    isRunning() {
      return running;
    },
    requestRerun,
    run,
  };

  latestGuard = guard;
  return guard;
}

function requestLatestCheck() {
  return latestGuard ? latestGuard.requestRerun() : false;
}

module.exports = {
  createCheckGuard,
  requestLatestCheck,
};
