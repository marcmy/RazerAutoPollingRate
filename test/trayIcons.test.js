const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');

const {
  detectPixelFormat,
  getPollingRateColor,
  getPollingRateFromIconPath,
  getPollingRateIconTemplate,
  installPollingRateIconColorizer,
  tintBitmap,
} = require('../src/lib/trayIcons');

const expectedColors = new Map([
  [125, '#8B00FF'],
  [250, '#4600FF'],
  [500, '#0000FF'],
  [1000, '#00FF00'],
  [2000, '#FFFF00'],
  [4000, '#FF7F00'],
  [8000, '#FF0000'],
]);

test('polling-rate colors match Razer Synapse, with 250 Hz midway between magenta and blue', () => {
  for (const [rate, color] of expectedColors) {
    assert.equal(getPollingRateColor(rate), color, `${rate} Hz`);
  }
});

test('polling-rate icon templates preserve the existing rate-specific glyphs', () => {
  for (const rate of expectedColors.keys()) {
    const expected = rate === 8000 ? '8000a.png' : `${rate}.png`;
    assert.equal(getPollingRateIconTemplate(rate), expected, `${rate} Hz`);
  }
});

test('polling-rate icon paths recognize both active and inactive asset names', () => {
  assert.equal(getPollingRateFromIconPath(path.join('assets', '125.png')), 125);
  assert.equal(getPollingRateFromIconPath(path.join('assets', '125a.png')), 125);
  assert.equal(getPollingRateFromIconPath(path.join('assets', '8000a.png')), 8000);
  assert.equal(getPollingRateFromIconPath(path.join('assets', 'loading.png')), null);
});

test('tintBitmap recolors premultiplied RGBA pixels while preserving alpha', () => {
  const source = Buffer.from([
    255, 0, 0, 255,
    64, 0, 0, 128,
    0, 0, 0, 0,
  ]);

  const tinted = tintBitmap(source, '#FF7F00', 'RGBA');
  assert.deepEqual([...tinted], [
    255, 127, 0, 255,
    128, 64, 0, 128,
    0, 0, 0, 0,
  ]);
  assert.deepEqual([...source], [
    255, 0, 0, 255,
    64, 0, 0, 128,
    0, 0, 0, 0,
  ]);
});

test('tintBitmap recolors premultiplied BGRA pixels while preserving alpha', () => {
  const source = Buffer.from([
    0, 0, 255, 255,
    0, 0, 64, 128,
  ]);

  const tinted = tintBitmap(source, '#8B00FF', 'BGRA');
  assert.deepEqual([...tinted], [
    255, 0, 139, 255,
    128, 0, 70, 128,
  ]);
});

test('detectPixelFormat recognizes RGBA and BGRA red samples', () => {
  assert.equal(detectPixelFormat(Buffer.from([255, 0, 0, 255])), 'RGBA');
  assert.equal(detectPixelFormat(Buffer.from([0, 0, 255, 255])), 'BGRA');
});

test('installed colorizer maps missing active assets to the rate template and returns the Synapse color', () => {
  const calls = [];
  const sourceBitmap = Buffer.from([255, 0, 0, 255]);
  const sourceImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 1, height: 1 }),
    toBitmap: () => sourceBitmap,
  };
  const nativeImage = {
    createFromPath(iconPath) {
      calls.push(iconPath);
      return sourceImage;
    },
    createFromBitmap(bitmap, options) {
      return { bitmap, options };
    },
  };
  const originalCreateFromPath = nativeImage.createFromPath;

  const restore = installPollingRateIconColorizer(nativeImage);
  const result = nativeImage.createFromPath(path.join('C:\\app', 'src', 'assets', '250a.png'));

  assert.equal(path.basename(calls[0]), '250.png');
  assert.equal(path.basename(calls[1]), '125.png');
  assert.deepEqual([...result.bitmap], [70, 0, 255, 255]);
  assert.deepEqual(result.options, { width: 1, height: 1, scaleFactor: 1 });

  restore();
  assert.equal(nativeImage.createFromPath, originalCreateFromPath);
});
