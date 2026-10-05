const path = require('path');

const PIXEL_GLYPHS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  K: ['101', '101', '110', '101', '101'],
  '%': ['101', '001', '010', '100', '101'],
};

function buildPollingBatteryBitmap(rate, batteryPercent, charging, pixelFormat = 'BGRA', scale = 1) {
  if (!getPollingRateColor(rate) || !Number.isInteger(batteryPercent)
    || batteryPercent < 0 || batteryPercent > 100) throw new Error('Invalid rate/battery tray status');
  if (!['RGBA', 'BGRA'].includes(pixelFormat) || ![1, 2].includes(scale)) {
    throw new Error('Invalid tray bitmap format or scale');
  }
  const size = 16 * scale;
  const bitmap = Buffer.alloc(size * size * 4);
  function drawText(text, top, color) {
    const channels = parseHexColor(color);
    if (pixelFormat === 'BGRA') channels.reverse();
    const left = Math.floor((16 - (text.length * 4 - 1)) / 2);
    for (let char = 0; char < text.length; char += 1) {
      const glyph = PIXEL_GLYPHS[text[char]];
      for (let y = 0; y < 5; y += 1) {
        for (let x = 0; x < 3; x += 1) {
          if (glyph[y][x] !== '1') continue;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const offset = (((top + y) * scale + dy) * size
                + (left + char * 4 + x) * scale + dx) * 4;
              bitmap.set([...channels, 255], offset);
            }
          }
        }
      }
    }
  }
  drawText(rate >= 1000 ? `${rate / 1000}K` : String(rate), 1, getPollingRateColor(rate));
  drawText(`${batteryPercent}%`, 9, charging ? '#00C8FF' : batteryPercent <= 20 ? '#FF5050' : '#A0A0A0');
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
