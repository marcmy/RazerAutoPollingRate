const { execFileSync } = require('child_process');

for (const patch of [
  'patches/usb-stability-1.patch',
  'patches/usb-stability-2a.patch',
  'notes-test.txt',
]) {
  execFileSync('git', ['apply', '--check', patch], { stdio: 'inherit' });
  execFileSync('git', ['apply', patch], { stdio: 'inherit' });
}

execFileSync('node', ['--check', 'src/main.js'], { stdio: 'inherit' });
