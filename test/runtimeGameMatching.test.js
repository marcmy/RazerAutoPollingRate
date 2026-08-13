const test = require('node:test');
const assert = require('node:assert/strict');

const { gameForExecutable } = require('../src/lib/gameLibraries');

test('known provider runtime matching ignores launchers and helpers', () => {
  const libraries = [{
    name: 'Steam',
    provider: 'steam',
    root: 'D:\\SteamLibrary\\steamapps\\common',
    custom: false,
  }];

  assert.equal(
    gameForExecutable('D:\\SteamLibrary\\steamapps\\common\\Apex Legends\\ApexLauncher.exe', libraries),
    null,
  );
  assert.equal(
    gameForExecutable('D:\\SteamLibrary\\steamapps\\common\\Apex Legends\\crashmsg.exe', libraries),
    null,
  );

  const game = gameForExecutable(
    'D:\\SteamLibrary\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe',
    libraries,
  );
  assert.equal(game.name, 'Apex Legends');
  assert.equal(game.processName, 'r5apex_dx12.exe');
});

test('custom runtime matching remains permissive for launcher-named executables', () => {
  const libraries = [{
    name: 'Custom',
    provider: 'custom',
    root: 'C:\\Games',
    custom: true,
  }];

  const game = gameForExecutable('C:\\Games\\Community Client\\MyLauncher.exe', libraries);
  assert.equal(game.name, 'Community Client');
  assert.equal(game.processName, 'MyLauncher.exe');
});
