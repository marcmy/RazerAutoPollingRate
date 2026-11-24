const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { stageUpdatePackage } = require('../src/lib/updateInstaller');
const metadata = require('../package.json');

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/validate-update-package.js <full.nupkg>');
  const packagePath = path.resolve(process.argv[2]);
  const manifestPath = path.join(path.dirname(packagePath), 'RELEASES');
  const manifest = fs.readFileSync(manifestPath, 'utf8').trim();
  const entries = manifest.split(/\r?\n/).filter((line) => line.trim());
  const match = entries.length === 1 && /^([a-f0-9]{40})\s+(\S+)\s+(\d+)$/i.exec(entries[0].trim());
  if (!match || match[2].toLowerCase() !== path.basename(packagePath).toLowerCase()) {
    throw new Error('Squirrel RELEASES manifest must contain exactly one valid entry for the full package');
  }
  const hash = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(packagePath)) hash.update(chunk);
  if (hash.digest('hex') !== match[1].toLowerCase() || fs.statSync(packagePath).size !== Number(match[3])) {
    throw new Error('Squirrel RELEASES manifest hash or size does not match the full package');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rapr-package-validation-'));
  try {
    const versionField = metadata.buildDisplayVersion ? 'buildDisplayVersion' : 'version';
    const staged = await stageUpdatePackage({
      packagePath,
      updateDirectory: root,
      expectedVersion: metadata[versionField],
      executableName: `${metadata.name}.exe`,
      versionField,
    });
    console.log(`Validated manifest and extracted payload: ${staged} (${metadata[versionField]})`);
  } finally {
    const logPath = path.join(root, 'updater-extraction.log');
    if (fs.existsSync(logPath)) console.log(fs.readFileSync(logPath, 'utf8'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
