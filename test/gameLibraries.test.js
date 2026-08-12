const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findContainingLibrary,
  findLikelyExecutable,
  gameForExecutable,
  getFriendlyGameNameFromExecutable,
  isPathInsideRoot,
  parseSteamAppManifest,
  parseSteamLibraryFolders,
} = require('../src/lib/gameLibraries');

test('Steam libraryfolders.vdf paths are parsed and normalized', () => {
  const roots = parseSteamLibraryFolders(`
"libraryfolders"
{
  "0"
  {
    "path" "C:\\\\Program Files (x86)\\\\Steam"
  }
  "1"
  {
    "path" "D:\\\\SteamLibrary"
  }
}`);
  assert.deepEqual(roots, [
    'c:\\program files (x86)\\steam',
    'd:\\steamlibrary',
  ]);
});

test('Steam app manifests expose friendly name and install directory', () => {
  const manifest = parseSteamAppManifest(`
"AppState"
{
  "appid" "1172470"
  "name" "Apex Legends"
  "installdir" "Apex Legends"
}`);
  assert.deepEqual(manifest, {
    name: 'Apex Legends',
    installDir: 'Apex Legends',
  });
});

test('library-root matching is case-insensitive and boundary safe', () => {
  assert.equal(
    isPathInsideRoot('D:\\SteamLibrary\\steamapps\\common\\Quake\\quake.exe', 'd:\\steamlibrary\\steamapps\\common'),
    true,
  );
  assert.equal(
    isPathInsideRoot('D:\\SteamLibrary2\\game.exe', 'D:\\SteamLibrary'),
    false,
  );
});

test('the most specific library root wins', () => {
  const libraries = [
    { name: 'Custom', root: 'D:\\Games', provider: 'custom' },
    { name: 'Steam', root: 'D:\\Games\\Steam\\steamapps\\common', provider: 'steam' },
  ];
  const match = findContainingLibrary('D:\\Games\\Steam\\steamapps\\common\\Quake\\quake.exe', libraries);
  assert.equal(match.name, 'Steam');
});

test('runtime game identity is derived from the first folder under a library root', () => {
  const game = gameForExecutable(
    'D:\\SteamLibrary\\steamapps\\common\\Quake\\rerelease\\Quake_x64.exe',
    [{ name: 'Steam', provider: 'steam', root: 'D:\\SteamLibrary\\steamapps\\common' }],
  );

  assert.equal(game.name, 'Quake');
  assert.equal(game.provider, 'steam');
  assert.equal(game.gameRoot, 'D:\\SteamLibrary\\steamapps\\common\\Quake');
  assert.equal(game.processName, 'Quake_x64.exe');
});


test('Apex discovery ignores crashmsg.exe and prefers the real game executable', () => {
  const root = 'D:\\SteamLibrary\\steamapps\\common\\Apex Legends';
  const fsImpl = {
    readdirSync(directory) {
      if (directory === root) {
        return [
          { name: 'crashmsg.exe', isDirectory: () => false, isFile: () => true },
          { name: 'r5apex_dx12.exe', isDirectory: () => false, isFile: () => true },
        ];
      }
      return [];
    },
    statSync(file) {
      return { size: /r5apex/i.test(file) ? 80_000_000 : 8_000_000 };
    },
  };

  assert.equal(
    findLikelyExecutable(root, 'Apex Legends', { fsImpl }),
    `${root}\\r5apex_dx12.exe`,
  );
});

test('Quake discovery prefers the rerelease binary over the legacy root executable', () => {
  const root = 'D:\\SteamLibrary\\steamapps\\common\\Quake';
  const rerelease = `${root}\\rerelease`;
  const fsImpl = {
    readdirSync(directory) {
      if (directory === root) {
        return [
          { name: 'quake.exe', isDirectory: () => false, isFile: () => true },
          { name: 'rerelease', isDirectory: () => true, isFile: () => false },
        ];
      }
      if (directory === rerelease) {
        return [
          { name: 'quake_x64_steam.exe', isDirectory: () => false, isFile: () => true },
        ];
      }
      return [];
    },
    statSync() {
      return { size: 20_000_000 };
    },
  };

  assert.equal(
    findLikelyExecutable(root, 'Quake', { fsImpl }),
    `${rerelease}\\quake_x64_steam.exe`,
  );
});

test('nested rerelease executable paths keep the parent game name', () => {
  assert.equal(
    getFriendlyGameNameFromExecutable('D:\\SteamLibrary\\steamapps\\common\\Quake\\rerelease\\quake_x64_steam.exe'),
    'Quake',
  );
});
