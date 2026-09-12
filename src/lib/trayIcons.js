const path = require('path');

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
  detectPixelFormat,
  getPollingRateColor,
  getPollingRateFromIconPath,
  getPollingRateIconTemplate,
  installPollingRateIconColorizer,
  tintBitmap,
};
