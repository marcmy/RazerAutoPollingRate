const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseRollingVersion(value) {
  const match = /^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})$/.exec(String(value || '').trim());
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return {
    value: `${yearText}${monthText}${dayText}.${hourText}${minuteText}`,
    timestamp,
    year,
    month,
    day,
    hour,
    minute,
  };
}

function getDisplayVersion(packageMetadata, appVersion) {
  const rolling = parseRollingVersion(packageMetadata && packageMetadata.buildDisplayVersion);
  return rolling ? rolling.value : appVersion;
}

function isNewerRollingVersion(latestVersion, currentVersion) {
  const latest = parseRollingVersion(latestVersion);
  if (!latest) {
    return false;
  }

  const current = parseRollingVersion(currentVersion);
  return !current || latest.timestamp > current.timestamp;
}

function shouldCheckForUpdates(lastCheckedAt, now = Date.now()) {
  const last = Number(lastCheckedAt);
  if (!Number.isFinite(last) || last <= 0) {
    return true;
  }
  return now - last >= UPDATE_CHECK_INTERVAL_MS;
}

function isGameActive(runtimeStatus) {
  if (!runtimeStatus) {
    return false;
  }
  return runtimeStatus.source !== 'inactive' && runtimeStatus.source !== 'disabled';
}

function selectSetupAsset(release) {
  const version = parseRollingVersion(release && release.tag_name);
  if (!version || !Array.isArray(release.assets)) {
    return null;
  }

  const expectedName = `RazerAutoPollingRate-${version.value}.Setup.exe`;
  return release.assets.find((asset) => asset && asset.name === expectedName) || null;
}
function selectFullPackageAsset(release) {
  const version = parseRollingVersion(release && release.tag_name);
  if (!version || !Array.isArray(release.assets)) {
    return null;
  }

  const monthDay = (version.month * 100) + version.day;
  const hourMinute = (version.hour * 100) + version.minute;
  const expectedName = `razerautopollingrate-${version.year}.${monthDay}.${hourMinute}-full.nupkg`;
  return release.assets.find((asset) => asset && asset.name === expectedName) || null;
}

function sanitizeReleaseNotes(value) {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  let skippedHeadingLevel = null;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (skippedHeadingLevel !== null) {
      if (!heading || heading[1].length > skippedHeadingLevel) {
        continue;
      }
      skippedHeadingLevel = null;
    }

    if (heading && /\bscoop\b/i.test(heading[2])) {
      skippedHeadingLevel = heading[1].length;
      continue;
    }

    if (/\bscoop\b/i.test(line)) {
      continue;
    }

    if (/^\s*(?:\*\*|__)?Full Changelog(?:\*\*|__)?\s*:/i.test(line)) {
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function releaseNotesToPlainText(value) {
  return sanitizeReleaseNotes(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .trim();
}

function buildRecentChangelogEntries(releases, pendingRelease, limit = 5) {
  const maximum = Number.isInteger(limit) && limit > 0 ? limit : 5;
  const candidates = [
    pendingRelease,
    ...(Array.isArray(releases) ? releases : []),
  ];
  const seen = new Set();
  const entries = [];

  for (const release of candidates) {
    const version = String(release && release.tag_name || '').trim();
    if (!version || seen.has(version)) {
      continue;
    }

    seen.add(version);
    entries.push({
      version,
      notes: releaseNotesToPlainText(release.body)
        || 'No release notes were provided for this version.',
    });
    if (entries.length >= maximum) {
      break;
    }
  }

  return entries;
}

function shouldShowInstalledChangelog(pendingRelease, currentVersion) {
  return Boolean(
    pendingRelease
    && pendingRelease.tag_name
    && String(pendingRelease.tag_name) === String(currentVersion),
  );
}

module.exports = {
  UPDATE_CHECK_INTERVAL_MS,
  buildRecentChangelogEntries,
  getDisplayVersion,
  isGameActive,
  isNewerRollingVersion,
  parseRollingVersion,
  releaseNotesToPlainText,
  sanitizeReleaseNotes,
  selectFullPackageAsset,
  selectSetupAsset,
  shouldShowInstalledChangelog,
  shouldCheckForUpdates,
};
