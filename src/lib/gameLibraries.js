const fs = require('fs');
const path = require('path');

const winPath = path.win32;

const HELPER_DIRECTORY_PATTERN = /^(?:_commonredist|redist|redistributables|support|installer|installers|uninstall|uninstaller|crash(?:pad|reporter)?|easyanticheat|battleye)$/i;
const HELPER_EXECUTABLE_PATTERN = /(?:unins|uninstall|setup|installer|crash|report|easyanticheat|eac|battleye|beservice|vc_redist|vcredist|dxsetup|dotnet|ue4prereq|ue5prereq|cefprocess|helper|updater|update)\b/i;
const NON_GAME_FOLDER_PATTERN = /^(?:launcher|launchers|riot client|social club|redistributables|support|tools?)$/i;

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

function normalizeGameName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:x64|win64|shipping|release|launcher)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
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

  if (/\\binaries\\win64\\/i.test(executablePath.replace(/\//g, '\\'))) {
    score += 24;
  }

  if (/launcher/i.test(base)) {
    score -= 18;
  }

  if (HELPER_EXECUTABLE_PATTERN.test(base)) {
    score -= 250;
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
  const maxVisited = Number.isInteger(options.maxVisited) ? options.maxVisited : 500;
  const candidates = [];
  let visited = 0;

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

    for (const item of items) {
      if (visited >= maxVisited) {
        break;
      }
      visited += 1;
      const fullPath = winPath.join(directory, item.name);

      if (item.isDirectory()) {
        if (!HELPER_DIRECTORY_PATTERN.test(item.name)) {
          walk(fullPath, depth + 1);
        }
        continue;
      }

      if (item.isFile() && /\.exe$/i.test(item.name)) {
        candidates.push({
          path: fullPath,
          score: executableScore(fullPath, gameName, gameRoot, fsImpl),
        });
      }
    }
  }

  walk(gameRoot, 0);
  candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return candidates.length > 0 ? candidates[0].path : null;
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
    if (games.length === gamesBeforeLibrary) {
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
  getDriveRoots,
  isPathInsideRoot,
  normalizeWindowsPath,
  parseSteamAppManifest,
  parseSteamLibraryFolders,
  readSteamLibraryRoots,
  scanLibraryGames,
};
