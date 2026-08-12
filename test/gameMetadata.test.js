const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isGameHidden,
  isRuleHidden,
  metadataForGame,
  normalizeGameMetadata,
} = require('../src/lib/gameMetadata');

test('game metadata preserves custom names and hidden state', () => {
  const metadata = normalizeGameMetadata([
    {
      id: 'manual:C:\\Program Files\\R5Reloaded\\R5R Library\\LIVE\\r5apex.exe',
      name: 'R5Reloaded',
      hidden: false,
      target: 'C:\\Program Files\\R5Reloaded\\R5R Library\\LIVE\\r5apex.exe',
    },
  ]);

  assert.deepEqual(metadata, [{
    id: 'manual:c:\\program files\\r5reloaded\\r5r library\\live\\r5apex.exe',
    name: 'R5Reloaded',
    target: 'c:\\program files\\r5reloaded\\r5r library\\live\\r5apex.exe',
  }]);

  const game = {
    id: 'manual:C:\\Program Files\\R5Reloaded\\R5R Library\\LIVE\\r5apex.exe',
  };
  assert.equal(metadataForGame(game, metadata).name, 'R5Reloaded');
});

test('hidden automatic game suppresses both library detection and explicit path rules beneath its root', () => {
  const metadata = [{
    id: 'C:\\Games\\Hollow Knight',
    hidden: true,
    target: 'C:\\Games\\Hollow Knight\\hollow_knight.exe',
  }];

  const game = {
    id: 'c:\\games\\hollow knight',
    executablePath: 'C:\\Games\\Hollow Knight\\hollow_knight.exe',
  };
  const rule = {
    executablePath: 'c:\\games\\hollow knight\\hollow_knight.exe',
    processName: 'hollow_knight.exe',
  };

  assert.equal(isGameHidden(game, metadata), true);
  assert.equal(isRuleHidden(rule, metadata), true);
});

test('hidden manual game suppresses its process rule', () => {
  const metadata = [{
    id: 'manual:r5apex.exe',
    hidden: true,
    target: 'r5apex.exe',
  }];
  const rule = {
    processName: 'r5apex.exe',
    rawTarget: 'r5apex.exe',
  };

  assert.equal(isRuleHidden(rule, metadata), true);
});

test('empty metadata customizations are discarded', () => {
  assert.deepEqual(normalizeGameMetadata([
    { id: 'C:\\Games\\Quake', name: '', hidden: false },
  ]), []);
});
