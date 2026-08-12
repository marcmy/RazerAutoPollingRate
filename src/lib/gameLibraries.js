const fs = require('fs');
const path = require('path');

const winPath = path.win32;

const HELPER_DIRECTORY_PATTERN = /^(?:_commonredist|redist|redistributables|support|installer|installers|uninstall|uninstaller|crash(?:msg|pad|reporter|handler|sender)?|easyanticheat|battleye)$/i;
const HELPER_EXECUTABLE_PATTERN = /(?:unins|uninstall|setup|installer|crash(?:msg|pad|reporter|handler|sender)?|report(?:er)?|easyanticheat|eac|battleye|beservice|vc_redist|vcredist|dxsetup|dotnet|ue4prereq|ue5prereq|cefprocess|helper|updater|update)\b/i;
const NON_GAME_FOLDER_PATTERN = /^(?:launcher|launchers|riot client|social club|redistributables|support|tools?)$/i;
const PROVIDER_UTILITY_GAME_NAME_PATTERN = /\b(?:launcher|client)\b/i;
const GAME_IDENTITY_NOISE_TOKENS = new Set([
  'x64', 'x86', 'win64', 'win32', 'shipping', 'release', 'launcher',
  'steam', 'gog', 'epic', 'dx11', 'dx12', 'd3d11', 'd3d12', 'vulkan',
]);
const GAME_NAME_STOP_TOKENS = new Set([
  'game', 'games', 'edition', 'deluxe', 'ultimate', 'complete', 'collection',
  'remastered', 'enhanced', 'launcher', 'windows', 'microsoft',
]);
const GENERIC_GAME_SUBDIRECTORY_PATTERN = /^(?:win64|win32|x64|x86|binaries|bin|rerelease|release|remaster(?:ed)?|enhanced)$/i;

function normalizeWindowsPath(value) {
  const text = String(value || '').trim().replace(/\//g, '\\');
  if (!text) {
    return '';
  }

  return winPath.normalize(text).replace(/[\\]+$/, '').toLowerCase();
}

function displayWindowsPath(value) {
  const text = String(value || '').trim().replace(/\//g, '\\');
  if (!text) {
    return '';
  }

  return winPath.normalize(text).replace(/[\\]+$/, '');
}

function isPathInsideRoot(filePath, rootPath) {
  const file = normalizeWindowsPath(filePath);
  const root = normalizeWindowsPath(rootPath);
  if (!file || !root) {
    return false;
  }

  return file === root || file.startsWith(`${root}\\`);
}

function findContainingLibrary(executablePath, libraries = []) {
  return libraries
    .filter((library) => library && isPathInsideRoot(executablePath, library.root))
    .sort((left, right) => normalizeWindowsPath(right.root).length - normalizeWindowsPath(left.root).length)[0] || null;
}

function makeLibrary(provider, name, root, options = {}) {
  const cleanRoot = displayWindowsPath(root);
  const key = normalizeWindowsPath(cleanRoot);
  return {
    id: `${provider}:${key}`,
    provider,
    name,
    root: cleanRoot,
    custom: Boolean(options.custom),
  };
}

function dedupeLibraries(libraries) {
  const seen = new Set();
  return libraries.filter((library) => {
    const key = normalizeWindowsPath(library.root);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function existingDirectory(fsImpl, candidate) {
  if (!candidate) {
    return false;
  }

  try {
    return fsImpl.existsSync(candidate) && fsImpl.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function getDriveRoots(fsImpl = fs) {
  const roots = [];
  for (let code = 67; code <= 90; code += 1) {
    const candidate = `${String.fromCharCode(code)}:\\`;
    if (existingDirectory(fsImpl, candidate)) {
      roots.push(candidate);
    }
  }
  return roots;
}

function parseSteamLibraryFolders(contents) {
  const roots = [];
  const expression = /"path"\s*"([^"]+)"/gi;
  let match = expression.exec(String(contents || ''));
  while (match) {
    const decoded = match[1].replace(/\\\\/g, '\\');
    if (decoded) {
      roots.push(displayWindowsPath(decoded));
    }
    match = expression.exec(String(contents || ''));
  }
  return [...new Set(roots.map((root) => normalizeWindowsPath(root)))];
}

function parseSteamAppManifest(contents) {
  const text = String(contents || '');
  const nameMatch = text.match(/"name"\s*"([^"]+)"/i);
  const installDirMatch = text.match(/"installdir"\s*"([^"]+)"/i);
  if (!installDirMatch) {
    return null;
  }

  return {
    name: nameMatch ? nameMatch[1] : installDirMatch[1],
    installDir: installDirMatch[1],
  };
}

function readSteamLibraryRoots(steamInstallRoot, fsImpl = fs) {
  const roots = [];
  const common = winPath.join(steamInstallRoot, 'steamapps', 'common');
  if (existingDirectory(fsImpl, common)) {
    roots.push(common);
  }

  const vdfPath = winPath.join(steamInstallRoot, 'steamapps', 'libraryfolders.vdf');
  try {
    if (fsImpl.existsSync(vdfPath)) {
      parseSteamLibraryFolders(fsImpl.readFileSync(vdfPath, 'utf8')).forEach((libraryRoot) => {
        const libraryCommon = winPath.join(libraryRoot, 'steamapps', 'common');
        if (existingDirectory(fsImpl, libraryCommon)) {
          roots.push(libraryCommon);
        }
      });
    }
  } catch {
    // A malformed or temporarily locked VDF should not disable the rest of discovery.
  }

  return roots;
}

function discoverGameLibraries(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const env = options.env || process.env;
  const driveRoots = Array.isArray(options.driveRoots) ? options.driveRoots : getDriveRoots(fsImpl);
  const customFolders = Array.isArray(options.customFolders) ? options.customFolders : [];
  const includeKnown = options.includeKnown !== false;
  const libraries = [];

  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || env.ProgramFilesX86 || 'C:\\Program Files (x86)';
  const appData = env.APPDATA || '';

  if (includeKnown) {
  const steamRoots = [
    winPath.join(programFilesX86, 'Steam'),
    winPath.join(programFiles, 'Steam'),
  ];

  driveRoots.forEach((drive) => {
    steamRoots.push(winPath.join(drive, 'Steam'));
    const steamLibraryCommon = winPath.join(drive, 'SteamLibrary', 'steamapps', 'common');
    if (existingDirectory(fsImpl, steamLibraryCommon)) {
      libraries.push(makeLibrary('steam', 'Steam', steamLibraryCommon));
    }
  });

  steamRoots.forEach((steamRoot) => {
    if (!existingDirectory(fsImpl, steamRoot)) {
      return;
    }
    readSteamLibraryRoots(steamRoot, fsImpl).forEach((root) => {
      libraries.push(makeLibrary('steam', 'Steam', root));
    });
  });

  const driveCandidates = [
    ['xbox', 'Xbox', 'XboxGames'],
    ['epic', 'Epic Games', 'Epic Games'],
    ['ea', 'EA app', 'EA Games'],
    ['gog', 'GOG Galaxy', 'GOG Games'],
    ['riot', 'Riot Games', 'Riot Games'],
    ['amazon', 'Amazon Games', 'Amazon Games'],
  ];

  driveRoots.forEach((drive) => {
    driveCandidates.forEach(([provider, name, relative]) => {
      const root = winPath.join(drive, relative);
      if (existingDirectory(fsImpl, root)) {
        libraries.push(makeLibrary(provider, name, root));
      }
    });
  });

  [
    ['epic', 'Epic Games', winPath.join(programFiles, 'Epic Games')],
    ['ea', 'EA app', winPath.join(programFiles, 'EA Games')],
    ['ubisoft', 'Ubisoft Connect', winPath.join(programFilesX86, 'Ubisoft', 'Ubisoft Game Launcher', 'games')],
    ['ubisoft', 'Ubisoft Connect', winPath.join(programFiles, 'Ubisoft', 'Ubisoft Game Launcher', 'games')],
    ['rockstar', 'Rockstar Games', winPath.join(programFiles, 'Rockstar Games')],
    ['rockstar', 'Rockstar Games', winPath.join(programFilesX86, 'Rockstar Games')],
    ['hoyoplay', 'HoYoPlay', winPath.join(programFiles, 'HoYoPlay', 'games')],
    ['hoyoplay', 'HoYoPlay', winPath.join(programFilesX86, 'HoYoPlay', 'games')],
    ['itch', 'itch.io', appData ? winPath.join(appData, 'itch', 'apps') : ''],
  ].forEach(([provider, name, root]) => {
    if (existingDirectory(fsImpl, root)) {
      libraries.push(makeLibrary(provider, name, root));
    }
  });

  }

  customFolders.forEach((root) => {
    if (existingDirectory(fsImpl, root)) {
      libraries.push(makeLibrary('custom', 'Custom', root, { custom: true }));
    }
  });

  return dedupeLibraries(libraries);
}

function splitNameTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeGameName(value) {
  return splitNameTokens(value)
    .filter((token) => !GAME_IDENTITY_NOISE_TOKENS.has(token))
    .join('');
}

function getMeaningfulGameNameTokens(value) {
  return splitNameTokens(value)
    .filter((token) => token.length >= 4 && !GAME_NAME_STOP_TOKENS.has(token));
}

function executableScore(executablePath, gameName, gameRoot, fsImpl = fs) {
  const base = winPath.basename(executablePath, '.exe');
  const normalizedBase = normalizeGameName(base);
  const normalizedGame = normalizeGameName(gameName);
  const relative = winPath.relative(gameRoot, executablePath);
  const depth = relative.split('\\').length - 1;
  let score = Math.max(0, 35 - (depth * 8));

  if (normalizedGame && normalizedBase) {
    if (normalizedBase === normalizedGame) {
      score += 160;
    } else if (normalizedBase.includes(normalizedGame) || normalizedGame.includes(normalizedBase)) {
      score += 80;
    }
  }

  const tokenMatch = getMeaningfulGameNameTokens(gameName)
    .filter((token) => normalizedBase.includes(token))
    .sort((left, right) => right.length - left.length)[0];
  if (tokenMatch) {
    score += 70 + Math.min(30, tokenMatch.length * 3);
  }

  const normalizedExecutablePath = executablePath.replace(/\//g, '\\');
  if (/\\binaries\\win64\\/i.test(normalizedExecutablePath)) {
    score += 24;
  }

  if (/\\(?:rerelease|remaster(?:ed)?|enhanced)\\/i.test(normalizedExecutablePath)) {
    score += 120;
  }

  if (/launcher/i.test(base)) {
    score -= 18;
  }

  if (HELPER_EXECUTABLE_PATTERN.test(base)) {
    score -= 400;
  }

  try {
    const size = fsImpl.statSync(executablePath).size;
    score += Math.min(40, Math.log2(Math.max(size, 1)) * 1.5);
  } catch {
    // Size is a minor signal only.
  }

  return score;
}

function findLikelyExecutable(gameRoot, gameName, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 3;
  const maxVisited = Number.isInteger(options.maxVisited) ? options.maxVisited : 1500;
  const candidates = [];
  const launcherCandidates = [];
  let visited = 0;

  function directoryPriority(name) {
    if (/^(?:rerelease|remaster(?:ed)?|enhanced)$/i.test(name)) return 100;
    if (/^(?:binaries|bin)$/i.test(name)) return 80;
    if (/^(?:win64|x64|game)$/i.test(name)) return 60;
    return 0;
  }

  function walk(directory, depth) {
    if (depth > maxDepth || visited >= maxVisited) {
      return;
    }

    let items;
    try {
      items = fsImpl.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    // Inspect files at this level before descending. Large asset/support
    // directories must not consume the traversal budget before a root EXE
    // (for example r5apex_dx12.exe) gets considered.
    for (const item of items.filter((entry) => entry.isFile())) {
      if (visited >= maxVisited) break;
      visited += 1;
      if (!/\.exe$/i.test(item.name)) continue;

      const fullPath = winPath.join(directory, item.name);
      const baseName = winPath.basename(item.name, '.exe');
      if (HELPER_EXECUTABLE_PATTERN.test(baseName)) continue;

      const candidate = {
        path: fullPath,
        score: executableScore(fullPath, gameName, gameRoot, fsImpl),
      };

      // Launchers are useful only as a last resort. They frequently exit as
      // soon as the actual game starts, which would immediately drop the
      // polling rate back to the inactive value.
      if (/launcher/i.test(baseName)) {
        launcherCandidates.push(candidate);
      } else {
        candidates.push(candidate);
      }
    }

    const directories = items
      .filter((entry) => entry.isDirectory() && !HELPER_DIRECTORY_PATTERN.test(entry.name))
      .sort((left, right) => directoryPriority(right.name) - directoryPriority(left.name));

    for (const item of directories) {
      if (visited >= maxVisited) break;
      visited += 1;
      walk(winPath.join(directory, item.name), depth + 1);
    }
  }

  walk(gameRoot, 0);
  const pool = candidates.length > 0 ? candidates : launcherCandidates;
  pool.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return pool.length > 0 ? pool[0].path : null;
}

function getSteamManifestNames(libraryRoot, fsImpl = fs) {
  const names = new Map();
  const steamApps = winPath.dirname(libraryRoot);
  let files = [];
  try {
    files = fsImpl.readdirSync(steamApps);
  } catch {
    return names;
  }

  files.filter((file) => /^appmanifest_\d+\.acf$/i.test(file)).forEach((file) => {
    try {
      const manifest = parseSteamAppManifest(fsImpl.readFileSync(winPath.join(steamApps, file), 'utf8'));
      if (manifest) {
        names.set(normalizeWindowsPath(winPath.join(libraryRoot, manifest.installDir)), manifest.name);
      }
    } catch {
      // Ignore individual malformed manifests.
    }
  });
  return names;
}

function scanLibraryGames(libraries = [], options = {}) {
  const fsImpl = options.fsImpl || fs;
  const games = [];

  libraries.forEach((library) => {
    if (!existingDirectory(fsImpl, library.root)) {
      return;
    }

    const steamNames = library.provider === 'steam'
      ? getSteamManifestNames(library.root, fsImpl)
      : new Map();

    let children = [];
    try {
      children = fsImpl.readdirSync(library.root, { withFileTypes: true })
        .filter((item) => item.isDirectory() && !NON_GAME_FOLDER_PATTERN.test(item.name));
    } catch {
      return;
    }

    const gamesBeforeLibrary = games.length;
    children.forEach((child) => {
      const gameRoot = winPath.join(library.root, child.name);
      const gameName = steamNames.get(normalizeWindowsPath(gameRoot)) || child.name;

      // Known provider libraries can contain standalone launchers/clients that are
      // installed independently from any playable game. Do not present those as
      // games. Custom folders stay permissive because users may intentionally keep
      // unusual community clients or alternate engines there.
      if (!library.custom && PROVIDER_UTILITY_GAME_NAME_PATTERN.test(gameName)) {
        return;
      }

      const executablePath = findLikelyExecutable(gameRoot, gameName, { fsImpl });
      if (!executablePath) {
        return;
      }

      games.push({
        id: normalizeWindowsPath(gameRoot),
        name: gameName,
        source: library.name,
        provider: library.provider,
        libraryRoot: library.root,
        gameRoot,
        executablePath: displayWindowsPath(executablePath),
        processName: winPath.basename(executablePath),
        autoDetected: true,
      });
    });

    // A custom folder can point directly at one game instead of a multi-game library.
    // Only fall back to the root itself when no child game was discovered, otherwise
    // a generic library root would show an extra synthetic card for the whole folder.
    if (library.custom && games.length === gamesBeforeLibrary) {
      const gameRoot = library.root;
      const gameName = winPath.basename(gameRoot) || library.name;
      const executablePath = findLikelyExecutable(gameRoot, gameName, { fsImpl });
      if (executablePath) {
        games.push({
          id: normalizeWindowsPath(gameRoot),
          name: gameName,
          source: library.name,
          provider: library.provider,
          libraryRoot: library.root,
          gameRoot,
          executablePath: displayWindowsPath(executablePath),
          processName: winPath.basename(executablePath),
          autoDetected: true,
        });
      }
    }
  });

  const seen = new Set();
  return games.filter((game) => {
    const key = normalizeWindowsPath(game.executablePath);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getFriendlyGameNameFromExecutable(executablePath) {
  const target = displayWindowsPath(executablePath);
  if (!target) {
    return 'Game';
  }

  if (/^[a-z]:\\/i.test(target)) {
    let directory = winPath.dirname(target);
    while (GENERIC_GAME_SUBDIRECTORY_PATTERN.test(winPath.basename(directory))) {
      directory = winPath.dirname(directory);
    }

    const folderName = winPath.basename(directory);
    if (folderName) {
      return folderName;
    }
  }

  return winPath.basename(target, winPath.extname(target)) || target || 'Game';
}

function gameForExecutable(executablePath, libraries = []) {
  const library = findContainingLibrary(executablePath, libraries);
  if (!library) {
    return null;
  }

  const relative = winPath.relative(library.root, displayWindowsPath(executablePath));
  const firstSegment = relative.split('\\').filter(Boolean)[0];
  const executableAtRoot = Boolean(firstSegment && /\.exe$/i.test(firstSegment));
  const gameRoot = firstSegment && !executableAtRoot ? winPath.join(library.root, firstSegment) : library.root;
  const name = firstSegment && !executableAtRoot ? firstSegment : winPath.basename(library.root);

  return {
    id: normalizeWindowsPath(gameRoot),
    name,
    source: library.name,
    provider: library.provider,
    libraryRoot: library.root,
    gameRoot,
    executablePath: displayWindowsPath(executablePath),
    processName: winPath.basename(executablePath),
    autoDetected: true,
  };
}

module.exports = {
  discoverGameLibraries,
  displayWindowsPath,
  findContainingLibrary,
  findLikelyExecutable,
  gameForExecutable,
  getFriendlyGameNameFromExecutable,
  getDriveRoots,
  isPathInsideRoot,
  normalizeWindowsPath,
  parseSteamAppManifest,
  parseSteamLibraryFolders,
  readSteamLibraryRoots,
  scanLibraryGames,
};
