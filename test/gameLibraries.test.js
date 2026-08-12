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
  scanLibraryGames,
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


test('non-launcher executable wins even when launcher scores higher', () => {
  const root = 'D:\\SteamLibrary\\steamapps\\common\\Apex Legends';
  const fsImpl = {
    readdirSync(directory) {
      if (directory === root) {
        return [
{ name: 'ApexLauncher.exe', isDirectory: () => false, isFile: () => true },
{ name: 'r5apex_dx12.exe', isDirectory: () => false, isFile: () => true },
        ];
      }
      return [];
    },
    statSync(file) {
      return { size: /launcher/i.test(file) ? 500_000_000 : 10_000_000 };
    },
  };

  assert.equal(
    findLikelyExecutable(root, 'Apex Legends', { fsImpl }),
    `${root}\\r5apex_dx12.exe`,
  );
});

test('root executables are inspected before deep directories consume the scan budget', () => {
  const root = 'D:\\Games\\Example';
  const huge = `${root}\\A-Huge-Assets`;
  const fsImpl = {
    readdirSync(directory) {
      if (directory === root) {
        return [
{ name: 'A-Huge-Assets', isDirectory: () => true, isFile: () => false },
{ name: 'ExampleGame.exe', isDirectory: () => false, isFile: () => true },
        ];
      }
      if (directory === huge) {
        return Array.from({ length: 100 }, (_, index) => ({
name: `asset-${index}.bin`,
isDirectory: () => false,
isFile: () => true,
        }));
      }
      return [];
    },
    statSync() {
      return { size: 50_000_000 };
    },
  };

  assert.equal(
    findLikelyExecutable(root, 'Example Game', { fsImpl, maxVisited: 3 }),
    `${root}\\ExampleGame.exe`,
  );
});


test('known provider launcher-only entries are not shown as games', () => {
  const root = 'D:\\XboxGames';
  const fsImpl = {
    existsSync(candidate) {
      return candidate === root;
    },
    statSync(candidate) {
      if (candidate === root) return { isDirectory: () => true };
      throw new Error(`unexpected stat ${candidate}`);
    },
    readdirSync(directory) {
      if (directory === root) {
        return [
          { name: 'Minecraft Launcher', isDirectory: () => true, isFile: () => false },
        ];
      }
      throw new Error(`launcher directory should not be scanned: ${directory}`);
    },
  };

  assert.deepEqual(
    scanLibraryGames([{ name: 'Xbox', provider: 'xbox', root, custom: false }], { fsImpl }),
    [],
  );
});

test('custom folders remain permissive for unusual launcher or client names', () => {
  const root = 'C:\\Games';
  const gameRoot = `${root}\\Custom Client`;
  const executable = `${gameRoot}\\clientgame.exe`;
  const fsImpl = {
    existsSync(candidate) {
      return candidate === root;
    },
    statSync(candidate) {
      if (candidate === root) return { isDirectory: () => true };
      if (candidate === executable) return { size: 50_000_000 };
      throw new Error(`unexpected stat ${candidate}`);
    },
    readdirSync(directory) {
      if (directory === root) {
        return [
          { name: 'Custom Client', isDirectory: () => true, isFile: () => false },
        ];
      }
      if (directory === gameRoot) {
        return [
          { name: 'clientgame.exe', isDirectory: () => false, isFile: () => true },
        ];
      }
      return [];
    },
  };

  const games = scanLibraryGames([{ name: 'Custom', provider: 'custom', root, custom: true }], { fsImpl });
  assert.equal(games.length, 1);
  assert.equal(games[0].name, 'Custom Client');
  assert.equal(games[0].executablePath, executable);
});
