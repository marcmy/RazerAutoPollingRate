const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const {
  getDefaultScriptPath,
  parseRawMouseDevicePath,
  createWindowsRawMouseMonitor,
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
    timeout: 45_000,
  });

  assert.match(output, /COMPILED/);
});

test('passive helper messages distinguish input heartbeats from device changes and real resume input', async (t) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const activity = [];
  const diagnostic = [];
  const monitor = createWindowsRawMouseMonitor({
    spawn: () => child,
    onActivity: (input) => activity.push(input),
    onDiagnostic: (event) => diagnostic.push(event),
  });
  t.after(() => monitor.close());
  const device = '\\\\?\\HID#VID_3710&PID_5406&MI_00#test';
  child.stdout.write(`READY\nMOUSE\t${device}\nINPUT\t${device}\nDEVICE_CHANGE\n`);
  await new Promise(setImmediate);
  assert.deepEqual(diagnostic, ['raw_mouse_monitor_ready', 'raw_mouse_device_change']);
  assert.equal(activity.length, 2);
  assert.equal(activity[0].heartbeat, undefined);
  assert.equal(activity[1].heartbeat, true);
  assert.equal(activity[1].productId, 0x5406);
});
