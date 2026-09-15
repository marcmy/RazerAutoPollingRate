const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'RazerAutoPollingRate',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function fetchJson(url) {
  const response = await fetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  fs.rmSync(partial, { force: true });

  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
    fs.renameSync(partial, destination);
  } finally {
    fs.rmSync(partial, { force: true });
  }

  return destination;
}

function verifyFileDigest(filePath, digest) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(String(digest || '').trim());
  if (!match) {
    return false;
  }

  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return actual.toLowerCase() === match[1].toLowerCase();
}

module.exports = {
  downloadFile,
  fetchJson,
  verifyFileDigest,
};
