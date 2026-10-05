const path = require('path');

const PIXEL_GLYPHS = {
  '0': ['0110', '1001', '1001', '1001', '1001', '1001', '1001', '1001', '0110'],
  '1': ['0010', '0110', '1010', '0010', '0010', '0010', '0010', '0010', '1111'],
  '2': ['0110', '1001', '0001', '0001', '0010', '0100', '1000', '1000', '1111'],
  '3': ['1110', '0001', '0001', '0001', '0110', '0001', '0001', '0001', '1110'],
  '4': ['1001', '1001', '1001', '1001', '1111', '0001', '0001', '0001', '0001'],
  '5': ['1111', '1000', '1000', '1000', '1110', '0001', '0001', '0001', '1110'],
  '6': ['0110', '1000', '1000', '1000', '1110', '1001', '1001', '1001', '0110'],
  '7': ['1111', '0001', '0001', '0010', '0010', '0010', '0100', '0100', '0100'],
  '8': ['0110', '1001', '1001', '1001', '0110', '1001', '1001', '1001', '0110'],
  '9': ['0110', '1001', '1001', '1001', '0111', '0001', '0001', '0001', '0110'],
  K: ['1001', '1001', '1010', '1010', '1100', '1010', '1010', '1001', '1001'],
};

function buildPollingBatteryBitmap(rate, batteryPercent, charging, pixelFormat = 'BGRA', scale = 1) {
  const unknownCharging = batteryPercent === null && charging === true;
  if (!getPollingRateColor(rate) || (!unknownCharging && (!Number.isInteger(batteryPercent)
    || batteryPercent < 0 || batteryPercent > 100))) throw new Error('Invalid rate/battery tray status');
  if (!['RGBA', 'BGRA'].includes(pixelFormat) || ![1, 2].includes(scale)) {
    throw new Error('Invalid tray bitmap format or scale');
  }
  const size = 16 * scale;
  const bitmap = Buffer.alloc(size * size * 4);
  function pixel(x, y, color) {
    const channels = parseHexColor(color);
    if (pixelFormat === 'BGRA') channels.reverse();
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        bitmap.set([...channels, 255], (((y * scale + dy) * size) + x * scale + dx) * 4);
      }
    }
  }
  function drawText(text, top, color) {
    const left = Math.floor((16 - (text.length * 5 - 1)) / 2);
    for (let char = 0; char < text.length; char += 1) {
      const glyph = PIXEL_GLYPHS[text[char]];
      for (let y = 0; y < 9; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          if (glyph[y][x] !== '1') continue;
          pixel(left + char * 5 + x, top + y, color);
        }
      }
    }
  }
  drawText(rate >= 1000 ? `${rate / 1000}K` : String(rate), 0, getPollingRateColor(rate));
  // Give the rate most of the icon. The percentage lives in the hover tooltip.
  const outline = !charging && batteryPercent <= 20 ? '#FF5050' : '#A0A0A0';
  for (let x = 0; x <= 14; x += 1) { pixel(x, 11, outline); pixel(x, 15, outline); }
  for (let y = 12; y <= 14; y += 1) { pixel(0, y, outline); pixel(14, y, outline); pixel(15, y, outline); }
  const filled = unknownCharging ? 13 : batteryPercent === 0 ? 0 : Math.max(1, Math.round(13 * batteryPercent / 100));
  const fillColor = batteryPercent <= 20 && !charging ? '#FF5050' : '#00FF00';
  for (let x = 1; x <= filled; x += 1) {
    if (unknownCharging && x % 2 === 0) continue;
    for (let y = 12; y <= 14; y += 1) pixel(x, y, fillColor);
  }
  return bitmap;
}

function createPollingBatteryIconFactory(nativeImage, referencePath) {
  const cache = new Map();
  let pixelFormat;
  return function createPollingBatteryIcon(rate, batteryPercent, charging) {
    const key = `${rate}:${batteryPercent}:${charging === true}`;
    if (cache.has(key)) return cache.get(key);
    if (!pixelFormat) pixelFormat = detectPixelFormat(nativeImage.createFromPath(referencePath).toBitmap());
    const icon = nativeImage.createFromBitmap(
      buildPollingBatteryBitmap(rate, batteryPercent, charging, pixelFormat),
      { width: 16, height: 16, scaleFactor: 1 },
    );
    icon.addRepresentation({
      buffer: buildPollingBatteryBitmap(rate, batteryPercent, charging, pixelFormat, 2),
      width: 32, height: 32, scaleFactor: 2,
    });
    // Bound native image storage even across many rate and percentage changes.
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(key, icon);
    return icon;
  };
}

const POLLING_RATE_COLORS = Object.freeze({
  125: '#8B00FF',
  250: '#4600FF',
  500: '#0000FF',
  1000: '#00FF00',
  2000: '#FFFF00',
  4000: '#FF7F00',
  8000: '#FF0000',
});

function getPollingRateColor(pollingRate) {
  return POLLING_RATE_COLORS[pollingRate] || null;
}

function getPollingRateIconTemplate(pollingRate) {
  if (!getPollingRateColor(pollingRate)) {
    return null;
  }
  return pollingRate === 8000 ? '8000a.png' : `${pollingRate}.png`;
}

function getPollingRateFromIconPath(iconPath) {
  const match = /^(125|250|500|1000|2000|4000|8000)a?\.png$/i.exec(path.basename(iconPath));
  return match ? Number.parseInt(match[1], 10) : null;
}

function detectPixelFormat(redBitmap) {
  for (let offset = 0; offset + 3 < redBitmap.length; offset += 4) {
    const alpha = redBitmap[offset + 3];
    if (alpha < 240) {
      continue;
    }

    const first = redBitmap[offset];
    const third = redBitmap[offset + 2];
    if (first > 200 && third < 32) {
      return 'RGBA';
    }
    if (third > 200 && first < 32) {
      return 'BGRA';
    }
  }

  throw new Error('Could not determine native image bitmap pixel format');
}

function parseHexColor(hexColor) {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(hexColor);
  if (!match) {
    throw new Error(`Invalid tray icon color: ${hexColor}`);
  }
  return match.slice(1).map((component) => Number.parseInt(component, 16));
}

function tintBitmap(sourceBitmap, hexColor, pixelFormat) {
  if (pixelFormat !== 'RGBA' && pixelFormat !== 'BGRA') {
    throw new Error(`Unsupported native image bitmap pixel format: ${pixelFormat}`);
  }

  const [red, green, blue] = parseHexColor(hexColor);
  const result = Buffer.from(sourceBitmap);
  const redOffset = pixelFormat === 'RGBA' ? 0 : 2;
  const blueOffset = pixelFormat === 'RGBA' ? 2 : 0;

  for (let offset = 0; offset + 3 < result.length; offset += 4) {
    const alpha = result[offset + 3];
    result[offset + redOffset] = Math.round((red * alpha) / 255);
    result[offset + 1] = Math.round((green * alpha) / 255);
    result[offset + blueOffset] = Math.round((blue * alpha) / 255);
  }

  return result;
}

function installPollingRateIconColorizer(nativeImage) {
  const originalCreateFromPath = nativeImage.createFromPath;
  const iconCache = new Map();
  let nativePixelFormat = null;

  nativeImage.createFromPath = (iconPath) => {
    const pollingRate = getPollingRateFromIconPath(iconPath);
    if (!pollingRate) {
      return originalCreateFromPath.call(nativeImage, iconPath);
    }

    const directory = path.dirname(iconPath);
    const cacheKey = `${directory}\0${pollingRate}`;
    if (iconCache.has(cacheKey)) {
      return iconCache.get(cacheKey);
    }

    const templateName = getPollingRateIconTemplate(pollingRate);
    const templateImage = originalCreateFromPath.call(nativeImage, path.join(directory, templateName));
    if (templateImage.isEmpty()) {
      return templateImage;
    }

    if (!nativePixelFormat) {
      const referenceImage = originalCreateFromPath.call(nativeImage, path.join(directory, '125.png'));
      nativePixelFormat = detectPixelFormat(referenceImage.toBitmap());
    }

    const size = templateImage.getSize();
    const bitmap = tintBitmap(templateImage.toBitmap(), getPollingRateColor(pollingRate), nativePixelFormat);
    const icon = nativeImage.createFromBitmap(bitmap, {
      width: size.width,
      height: size.height,
      scaleFactor: 1,
    });
    iconCache.set(cacheKey, icon);
    return icon;
  };

  return () => {
    nativeImage.createFromPath = originalCreateFromPath;
  };
}

module.exports = {
  buildPollingBatteryBitmap,
  createPollingBatteryIconFactory,
  detectPixelFormat,
  getPollingRateColor,
  getPollingRateFromIconPath,
  getPollingRateIconTemplate,
  installPollingRateIconColorizer,
  tintBitmap,
};
