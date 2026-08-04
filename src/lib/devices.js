const models = {
  None: 0,
  HyperPollingDongle: 1,
  ViperSE: 2,
  DockPro: 3,
  ViperV3Pro: 4,
  ViperV4Pro: 5,
  DeathAdderV4Pro: 6,
};

const dongles = {
  0x009F: {
    model: models.ViperSE,
    is8kCompatible: true,
  },
  0x00B3: {
    model: models.HyperPollingDongle,
    is8kCompatible: true,
  },
  0x00C3: {
    model: models.HyperPollingDongle,
    is8kCompatible: true,
  },
  0x00A4: {
    model: models.DockPro,
    is8kCompatible: true,
  },
  0x00C1: {
    model: models.ViperV3Pro,
    is8kCompatible: true,
  },
  0x00E5: {
    model: models.ViperV4Pro,
    is8kCompatible: true,
    interfaceIndex: 0x03,
  },
  0x00E6: {
    model: models.ViperV4Pro,
    is8kCompatible: true,
    interfaceIndex: 0x03,
  },
  0x00BE: {
    model: models.DeathAdderV4Pro,
    is8kCompatible: true,
    interfaceIndex: 0x00,
  },
  0x00BF: {
    model: models.DeathAdderV4Pro,
    is8kCompatible: true,
    interfaceIndex: 0x00,
  },
};

module.exports = {
  dongles,
  models,
};
