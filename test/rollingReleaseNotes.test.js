const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRollingReleaseNotes,
  extractUnreleasedItems,
} = require('../.github/scripts/generate-rolling-release-notes');

test('rolling release notes use new Unreleased changelog entries since the previous release', () => {
  const previous = `# Changelog

## Unreleased

### Added

- Existing released item.

## v1.3.6
`;
  const current = `# Changelog

## Unreleased

### Added

- Existing released item.
- Added useful new feature.

### Fixed

- Fixed the updater handoff.

## v1.3.6
`;

  assert.deepEqual(extractUnreleasedItems(current), [
    { heading: 'Added', text: '- Existing released item.' },
    { heading: 'Added', text: '- Added useful new feature.' },
    { heading: 'Fixed', text: '- Fixed the updater handoff.' },
  ]);

  const notes = buildRollingReleaseNotes({
    currentVersion: '20260916.1200',
    currentSha: 'abcdef1234567890',
    previousTag: '20260916.1100',
    repository: 'marcmy/RazerAutoPollingRate',
    currentChangelog: current,
    previousChangelog: previous,
    commits: [],
  });

  assert.match(notes, /### Added[\s\S]*Added useful new feature\./);
  assert.match(notes, /### Fixed[\s\S]*Fixed the updater handoff\./);
  assert.doesNotMatch(notes, /Existing released item/);
  assert.match(notes, /compare\/20260916\.1100\.\.\.20260916\.1200/);
});

test('rolling release notes fall back to meaningful main commit subjects when changelog has no new entry', () => {
  const notes = buildRollingReleaseNotes({
    currentVersion: '20260916.1200',
    currentSha: 'abcdef1234567890',
    previousTag: '20260916.1100',
    repository: 'marcmy/RazerAutoPollingRate',
    currentChangelog: '# Changelog\n\n## Unreleased\n',
    previousChangelog: '# Changelog\n\n## Unreleased\n',
    commits: [
      { sha: '111111111111', subject: 'feat: add useful new feature (#90)' },
      { sha: '222222222222', subject: 'ci: tweak release workflow' },
      { sha: '333333333333', subject: 'docs: update README' },
    ],
  });

  assert.match(notes, /- Add useful new feature \(#90\)/);
  assert.doesNotMatch(notes, /release workflow/);
  assert.doesNotMatch(notes, /README/);
});

