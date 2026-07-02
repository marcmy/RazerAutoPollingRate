const fs = require('fs');
const file = 'src/main.js';
let source = fs.readFileSync(file, 'utf8');
function patch(before, after) {
  if (!source.includes(before)) throw new Error('Missing patch anchor');
  source = source.replace(before, after);
}
patch(
  "const { createCheckGuard } = require('./lib/checkGuard');",
  "const { createCheckGuard } = require('./lib/checkGuard');\nconst { createUsbAccessPolicy } = require('./lib/usbAccessPolicy');",
);
patch(
  'const checkGuard = createCheckGuard();',
  `const checkGuard = createCheckGuard();
const usbAccessPolicy = createUsbAccessPolicy();
const webUsb = new WebUSB({
  devicesFound: (devices) => devices.find((device) => device.vendorId === 0x1532 && dongles[device.productId] !== undefined),
});
let lastKnownPollingRate = null;`,
);
fs.writeFileSync(file, source);
