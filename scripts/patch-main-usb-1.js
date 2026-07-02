const fs = require('fs');
const { execFileSync } = require('child_process');
const run = (c, a) => execFileSync(c, a, { stdio: 'inherit' });
let stage = 'start';
try {
  for (const p of ['patches/usb-stability-1.patch', 'patches/usb-stability-2a.patch', 'notes-test.txt']) {
    stage = `check ${p}`;
    run('git', ['apply', '--check', p]);
    stage = `apply ${p}`;
    run('git', ['apply', p]);
  }
  stage = 'syntax'; run('node', ['--check', 'src/main.js']);
  stage = 'install'; run('npm.cmd', ['ci']);
  stage = 'tests'; run('npm.cmd', ['test']);
  fs.rmSync('patches', { recursive: true, force: true });
  fs.rmSync('notes-test.txt', { force: true });
  fs.rmSync(__filename, { force: true });
} catch (e) {
  run('git', ['checkout', '--', 'src/main.js']);
  fs.writeFileSync('workflow-error.txt', `${stage}\n${e.message}\n`);
}
fs.rmSync('.github/workflows/apply-usb-stability.yml', { force: true });
