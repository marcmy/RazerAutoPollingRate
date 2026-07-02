const fs = require('fs');
const { execFileSync } = require('child_process');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

for (const patch of ['patches/usb-stability-1.patch', 'patches/usb-stability-2a.patch', 'notes-test.txt']) {
  run('git', ['apply', '--check', patch]);
  run('git', ['apply', patch]);
}
run('node', ['--check', 'src/main.js']);
run('npm.cmd', ['ci']);
run('npm.cmd', ['test']);
fs.rmSync('patches', { recursive: true, force: true });
fs.rmSync('notes-test.txt', { force: true });
fs.rmSync('.github/workflows/apply-usb-stability.yml', { force: true });
fs.rmSync(__filename, { force: true });
