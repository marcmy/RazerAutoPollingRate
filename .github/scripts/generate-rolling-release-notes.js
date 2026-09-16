'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROLLING_TAG_PATTERN = /^\d{8}\.\d{4}$/;

function extractUnreleasedItems(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+Unreleased\s*$/i.test(line));
  if (start < 0) return [];

  const items = [];
  let heading = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;

    const headingMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1];
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (bulletMatch) {
      items.push({ heading, text: `- ${bulletMatch[1]}` });
    }
  }
  return items;
}

function newUnreleasedItems(currentChangelog, previousChangelog) {
  const previous = new Set(
    extractUnreleasedItems(previousChangelog)
      .map((item) => `${item.heading || ''}\u0000${item.text}`),
  );
  return extractUnreleasedItems(currentChangelog)
    .filter((item) => !previous.has(`${item.heading || ''}\u0000${item.text}`));
}

function formatChangelogItems(items) {
  const lines = [];
  let currentHeading = Symbol('unset');
  for (const item of items) {
    const heading = item.heading || null;
    if (heading !== currentHeading) {
      if (lines.length > 0) lines.push('');
      if (heading) {
        lines.push(`### ${heading}`, '');
      }
      currentHeading = heading;
    }
    lines.push(item.text);
  }
  return lines;
}

function isHousekeepingSubject(subject) {
  return /^(?:ci|docs|test|build(?:\([^)]*\))?):\s/i.test(String(subject || '').trim());
}

function humanizeCommitSubject(subject) {
  const cleaned = String(subject || '')
    .trim()
    .replace(/^(?:feat|fix|perf|refactor)(?:\([^)]*\))?:\s*/i, '');
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function meaningfulCommitItems(commits) {
  const candidates = commits.filter((commit) => {
    const subject = String(commit.subject || '').trim();
    return subject && !isHousekeepingSubject(subject) && !/^Merge pull request\b/i.test(subject);
  });
  const selected = candidates.length > 0 ? candidates : commits.filter((commit) => String(commit.subject || '').trim());
  return selected.map((commit) => humanizeCommitSubject(commit.subject)).filter(Boolean);
}

function buildRollingReleaseNotes({
  currentVersion,
  currentSha,
  previousTag,
  repository,
  currentChangelog,
  previousChangelog,
  commits,
}) {
  const lines = ["## What's Changed", ''];
  const changelogItems = newUnreleasedItems(currentChangelog, previousChangelog);

  if (changelogItems.length > 0) {
    lines.push(...formatChangelogItems(changelogItems));
  } else {
    const commitItems = meaningfulCommitItems(commits || []);
    if (commitItems.length > 0) {
      lines.push(...commitItems.map((item) => `- ${item}`));
    } else {
      lines.push(`- Changes from commit ${String(currentSha || '').slice(0, 12) || 'unknown'}.`);
    }
  }

  if (repository && previousTag && currentVersion) {
    lines.push(
      '',
      `**Full Changelog**: https://github.com/${repository}/compare/${previousTag}...${currentVersion}`,
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

function runGit(args, options = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    if (options.allowFailure) return '';
    throw error;
  }
}

function findPreviousReleaseTag(currentVersion, currentSha) {
  const tags = runGit(['tag', '--merged', currentSha, '--list'])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  const rollingTags = tags
    .filter((tag) => ROLLING_TAG_PATTERN.test(tag) && tag !== currentVersion)
    .sort((left, right) => right.localeCompare(left));
  if (rollingTags.length > 0) return rollingTags[0];

  const stableTags = tags
    .filter((tag) => /^v\d/i.test(tag))
    .sort((left, right) => right.localeCompare(left));
  return stableTags[0] || null;
}

function readChangelogAtRef(ref) {
  if (!ref) return '';
  return runGit(['show', `${ref}:CHANGELOG.md`], { allowFailure: true });
}

function readCommits(previousTag, currentSha) {
  const range = previousTag ? `${previousTag}..${currentSha}` : currentSha;
  const output = runGit(['log', '--first-parent', '--format=%H%x09%s', range], { allowFailure: true });
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => {
    const separator = line.indexOf('\t');
    return separator >= 0
      ? { sha: line.slice(0, separator), subject: line.slice(separator + 1) }
      : { sha: '', subject: line };
  });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !name.startsWith('--') || value === undefined) {
      throw new Error('Expected --version, --sha, and --output arguments');
    }
    values[name.slice(2)] = value;
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentVersion = args.version;
  const currentSha = args.sha;
  const outputPath = args.output;
  if (!currentVersion || !currentSha || !outputPath) {
    throw new Error('--version, --sha, and --output are required');
  }

  const previousTag = findPreviousReleaseTag(currentVersion, currentSha);
  const currentChangelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const previousChangelog = readChangelogAtRef(previousTag);
  const commits = readCommits(previousTag, currentSha);
  const notes = buildRollingReleaseNotes({
    currentVersion,
    currentSha,
    previousTag,
    repository: process.env.GITHUB_REPOSITORY || '',
    currentChangelog,
    previousChangelog,
    commits,
  });

  fs.writeFileSync(outputPath, notes, 'utf8');
  console.log(`Generated rolling release notes from ${previousTag || 'repository history'} to ${currentVersion}.`);
}

module.exports = {
  buildRollingReleaseNotes,
  extractUnreleasedItems,
  findPreviousReleaseTag,
  humanizeCommitSubject,
  isHousekeepingSubject,
  meaningfulCommitItems,
  newUnreleasedItems,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
