const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

let githubReleaseClient = {};
try {
  githubReleaseClient = require('../src/lib/githubReleaseClient');
} catch (_error) {
  // RED: implementation follows these behavior tests.
}

test('GitHub release client reads JSON and downloads redirected assets', async (t) => {
  assert.equal(typeof githubReleaseClient.fetchJson, 'function');
  assert.equal(typeof githubReleaseClient.downloadFile, 'function');

  const payload = Buffer.from('installer-bytes');
  const server = http.createServer((request, response) => {
    if (request.url === '/release') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ tag_name: '20260914.0900' }));
      return;
    }
    if (request.url === '/asset') {
      response.statusCode = 302;
      response.setHeader('location', '/download');
      response.end();
      return;
    }
    response.setHeader('content-length', payload.length);
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const release = await githubReleaseClient.fetchJson(`${base}/release`);
  assert.equal(release.tag_name, '20260914.0900');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-update-'));
  const destination = path.join(directory, 'setup.exe');
  const progress = [];
  await githubReleaseClient.downloadFile(`${base}/asset`, destination, {
    expectedBytes: payload.length,
    onProgress: (state) => progress.push(state),
  });
  assert.deepEqual(fs.readFileSync(destination), payload);
  assert.equal(progress[0].downloadedBytes, 0);
  assert.equal(progress.at(-1).downloadedBytes, payload.length);
  assert.equal(progress.at(-1).totalBytes, payload.length);
  assert.equal(progress.at(-1).fraction, 1);
});

test('downloaded asset digest is verified when GitHub supplies sha256 metadata', () => {
  assert.equal(typeof githubReleaseClient.verifyFileDigest, 'function');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-update-'));
  const filePath = path.join(directory, 'setup.exe');
  fs.writeFileSync(filePath, 'installer-bytes');
  assert.equal(
    githubReleaseClient.verifyFileDigest(
      filePath,
      'sha256:204676736cea68d6411da9d3aa3fab0a5e70b023ba30cd560cfa9c8e7250f4df',
    ),
    true,
  );
  assert.equal(githubReleaseClient.verifyFileDigest(filePath, `sha256:${'0'.repeat(64)}`), false);
});
