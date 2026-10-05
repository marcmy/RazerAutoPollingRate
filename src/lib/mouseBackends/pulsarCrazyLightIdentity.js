'use strict';

const CRAZYLIGHT_VENDOR_ID = 0x3710;
const CRAZYLIGHT_PRODUCT_ID = 0x5406;
// 3414 is the original cable identity; 3524 is the X2 CrazyLight Medium
// reported by firmware 4.07 and listed as wired by Pulsar's configurator.
const CRAZYLIGHT_WIRED_PRODUCT_IDS = Object.freeze([0x3414, 0x3524]);

function crazyLightConnection(productId) {
  if (productId === CRAZYLIGHT_PRODUCT_ID) return 'wireless';
  if (CRAZYLIGHT_WIRED_PRODUCT_IDS.includes(productId)) return 'wired';
  return null;
}

module.exports = {
  CRAZYLIGHT_PRODUCT_ID,
  CRAZYLIGHT_VENDOR_ID,
  CRAZYLIGHT_WIRED_PRODUCT_IDS,
  crazyLightConnection,
};
