const fs = require('node:fs');
const path = require('node:path');

const { parseRollingVersion } = require('../src/lib/appUpdates');

function toInternalVersion(displayVersion) {
  const parsed = parseRollingVersion(displayVersion);
  if (!parsed) {
    throw new Error(`Invalid rolling version: ${displayVersion}`);
  }

  const monthDay = (parsed.month * 100) + parsed.day;
  const hourMinute = (parsed.hour * 100) + parsed.minute;
  return `${parsed.year}.${monthDay}.${hourMinute}`;
}

function stampPackageJson(packagePath, displayVersion) {
  const resolved = path.resolve(packagePath);
  const pkg = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  pkg.version = toInternalVersion(displayVersion);
  pkg.buildDisplayVersion = displayVersion;
  fs.writeFileSync(resolved, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return pkg;
}

if (require.main === module) {
  const displayVersion = process.argv[2];
  const packagePath = process.argv[3] || path.join(process.cwd(), 'package.json');
  const pkg = stampPackageJson(packagePath, displayVersion);
  console.log(`Stamped ${pkg.buildDisplayVersion} as internal Squirrel version ${pkg.version}`);
}

module.exports = {
  stampPackageJson,
  toInternalVersion,
};
