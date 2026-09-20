const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  getDefaultScriptPath,
  parseRawMouseDevicePath,
} = require('../src/lib/mouseBackends/windowsRawMouseActivity');

const { getDefaultPowerShellPath } = require('../src/lib/mouseBackends/windowsHidCaps');

test('Raw Input device paths expose the originating mouse VID/PID', () => {
  assert.deepEqual(
    parseRawMouseDevicePath('\\\\?\\HID#VID_3710&PID_5406&MI_00#8&abc&0&0000#{guid}'),
    {
      devicePath: '\\\\?\\HID#VID_3710&PID_5406&MI_00#8&abc&0&0000#{guid}',
      vendorId: 0x3710,
      productId: 0x5406,
    },
  );

  assert.deepEqual(
    parseRawMouseDevicePath('\\\\?\\HID#VID_1532&PID_00E5&MI_00#7&def&0&0000#{guid}'),
    {
      devicePath: '\\\\?\\HID#VID_1532&PID_00E5&MI_00#7&def&0&0000#{guid}',
      vendorId: 0x1532,
      productId: 0x00e5,
    },
  );

  assert.equal(parseRawMouseDevicePath('\\\\?\\ROOT#RDP_MOU#0000'), null);
});

test('Windows Raw Input PowerShell helper compiles on Windows', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync(getDefaultPowerShellPath(), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.resolve(getDefaultScriptPath()),
    '-CompileOnly',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });

  assert.match(output, /COMPILED/);
});
