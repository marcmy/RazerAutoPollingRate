const {
  isGameActive,
  isNewerRollingVersion,
  shouldCheckForUpdates,
} = require('./appUpdates');

function createUpdateCoordinator(options) {
  const {
    currentVersion,
    fetchLatestRelease,
    getLastCheckedAt,
    getRuntimeStatus,
    initialPendingRelease = null,
    onNotify,
    onPendingChange,
    setLastCheckedAt,
  } = options;

  let pendingRelease = initialPendingRelease
    && isNewerRollingVersion(initialPendingRelease.tag_name, currentVersion)
    ? initialPendingRelease
    : null;
  let notifiedVersion = null;
  let notifyingVersion = null;
  let checkPromise = null;

  async function maybeNotify() {
    if (!pendingRelease || isGameActive(getRuntimeStatus())) {
      return false;
    }

    const version = pendingRelease.tag_name;
    if (notifiedVersion === version || notifyingVersion === version) {
      return false;
    }

    notifyingVersion = version;
    try {
      const handled = await onNotify(
        pendingRelease,
        () => !isGameActive(getRuntimeStatus()),
      );
      if (handled === false) {
        return false;
      }

      notifiedVersion = version;
      return true;
    } finally {
      if (notifyingVersion === version) {
        notifyingVersion = null;
      }
    }
  }

  async function runCheck({ manual = false, now = Date.now() } = {}) {
    if (!manual && !shouldCheckForUpdates(getLastCheckedAt(), now)) {
      await maybeNotify();
      return { status: 'not-due', release: pendingRelease };
    }

    setLastCheckedAt(now);
    const release = await fetchLatestRelease();

    if (isNewerRollingVersion(release && release.tag_name, currentVersion)) {
      pendingRelease = release;
      notifiedVersion = null;
      notifyingVersion = null;
      onPendingChange(pendingRelease);
      await maybeNotify();
      return { status: 'available', release: pendingRelease };
    }

    pendingRelease = null;
    notifiedVersion = null;
    notifyingVersion = null;
    onPendingChange(null);
    return { status: 'current', release };
  }

  function check(options = {}) {
    if (checkPromise) {
      return checkPromise;
    }

    checkPromise = runCheck(options).finally(() => {
      checkPromise = null;
    });
    return checkPromise;
  }

  return {
    check,
    getPendingRelease: () => pendingRelease,
    runtimeChanged: maybeNotify,
  };
}

module.exports = {
  createUpdateCoordinator,
};
