'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLegacyStore } = require('../src/lib/legacyStore');

test('awaits the native ESM store constructor before returning', async () => {
  let resolveImport;
  const pending = new Promise((resolve) => { resolveImport = resolve; });
  const result = loadLegacyStore(() => pending);
  let initialized = false;
  result.then(() => { initialized = true; });
  await Promise.resolve();
  assert.equal(initialized, false);
  resolveImport({ default: class Store {
    constructor() { this.values = new Map([['autostart', true], ['mouseBatteryHistory', { mouse: 80 }]]); }
    get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
    set(key, value) { this.values.set(key, value); }
    delete(key) { this.values.delete(key); }
    has(key) { return this.values.has(key); }
  } });
  const store = await result;
  assert.equal(store.has('autostart'), true);
  assert.equal(store.get('autostart'), true);
  assert.deepEqual(store.get('mouseBatteryHistory', {}), { mouse: 80 });
  store.set('updates.lastCheckedAt', 1234);
  assert.equal(store.get('updates.lastCheckedAt'), 1234);
  store.delete('updates.lastCheckedAt');
  assert.equal(store.has('updates.lastCheckedAt'), false);
});

test('rejects module load errors and missing constructor instead of resetting settings', async () => {
  await assert.rejects(loadLegacyStore(async () => { throw new Error('module missing'); }), /module missing/);
  await assert.rejects(loadLegacyStore(async () => ({})), /default constructor/);
});
