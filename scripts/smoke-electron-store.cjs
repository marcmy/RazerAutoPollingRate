'use strict';

// Run with Electron, not node: verifies the ESM package can initialize in
// the real main process without changing an existing on-disk config.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { loadLegacyStore } = require('../src/lib/legacyStore');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'razer-electron-store-smoke-'));
const seeded = {
  autostart: true,
  detection_mode: 'running',
  lower_rate: 500,
  mouseBatteryHistory: { 'mouse-A': 77 },
  updates: { pendingRelease: { tag_name: 'v1.2.3' } },
};
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify(seeded), 'utf8');
app.setPath('userData', temp);

app.whenReady().then(async () => {
  const store = await loadLegacyStore();
  assert.equal(store.get('autostart'), true);
  assert.equal(store.get('detection_mode'), 'running');
  assert.equal(store.get('lower_rate'), 500);
  assert.deepEqual(store.get('mouseBatteryHistory'), seeded.mouseBatteryHistory);
  assert.deepEqual(store.get('updates.pendingRelease'), seeded.updates.pendingRelease);
  // The same JSON path/key format must still be readable and writable.
  store.set('updates.lastCheckedAt', 42);
  assert.equal(store.get('updates.lastCheckedAt'), 42);
  const disk = JSON.parse(fs.readFileSync(path.join(temp, 'config.json'), 'utf8'));
  assert.equal(disk.autostart, true);
  assert.deepEqual(disk.updates.pendingRelease, seeded.updates.pendingRelease);
  assert.equal(disk.updates.lastCheckedAt, 42);
  console.log('electron-store v11 startup and existing config migration OK');
  app.exit(0);
}).catch((error) => {
  console.error('electron-store startup smoke test failed:', error);
  app.exit(1);
}).finally(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});
