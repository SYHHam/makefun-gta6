// Sunline: Breakwater - world, gameplay and control constants.
// Single source of truth for every module. All distances in metres,
// all speeds in metres per second unless a field says otherwise.

export const CONFIG = {
  GAME: {
    title: 'Sunline: Breakwater',
    city: 'Solmera',
    currency: 'Sol',
    currencySymbol: 'S',
    saveKey: 'sunline-save-v1',
    seed: 20261123,
  },

  WORLD: {
    size: 1200,
    half: 600,
    // Road centrelines. Six vertical and six horizontal lines make 5x5 blocks.
    roadLines: [-500, -300, -100, 100, 300, 500],
    blockPitch: 200,
    mainRoadWidth: 18,
    localRoadWidth: 10,
    // South edge: sand strip then open sea.
    beachStart: 540,
    seaStart: 600,
    seaLength: 800,
    groundY: 0,
  },

  DISTRICTS: {
    marAzul: {
      name: 'Mar Azul',
      label: 'MAR AZUL',
      color: 0x2fa8a0,
      css: '#2fa8a0',
      // South band: beach, promenade, hotels.
      bounds: { minX: -600, maxX: 600, minZ: 300, maxZ: 600 },
    },
    cobreViejo: {
      name: 'Cobre Viejo',
      label: 'COBRE VIEJO',
      color: 0xe8a34c,
      css: '#e8a34c',
      // Old town: north west and centre.
      bounds: { minX: -600, maxX: 100, minZ: -600, maxZ: 300 },
    },
    glasspoint: {
      name: 'Glasspoint',
      label: 'GLASSPOINT',
      color: 0x7fb4d8,
      css: '#7fb4d8',
      // Business towers and container port: north east.
      bounds: { minX: 100, maxX: 600, minZ: -600, maxZ: 300 },
    },
  },

  // Palette: golden-hour colours, warm low sun, hazy peach sky.
  COLORS: {
    sky: 0xffc98f,
    fog: 0xf7bd7d,
    sun: 0xff8f2e,
    ambient: 0xffe6c4,
    ground: 0x9a9a86,
    asphaltMain: 0x3a3d42,
    asphaltLocal: 0x44474d,
    roadLine: 0xd8c86a,
    sidewalk: 0xb9b3a4,
    sand: 0xe6cf9e,
    sea: 0x2e7f9e,
    seaDeep: 0x1f5f7d,
    buildingGlass: 0x8fc3dd,
    buildingGlassDark: 0x5d8fb0,
    buildingPastel: [0xf2c9a0, 0xf6e3b8, 0xe8a8a0, 0xf0d060, 0xcfe0d8, 0xe8c8d8],
    buildingBrick: [0xb0704f, 0x9a6a52, 0xc08a5e],
    warehouse: [0x8a8f96, 0x7a7f88, 0x9aa0a8],
    roof: 0x6a6f76,
    palmTrunk: 0x8a6a42,
    palmLeaf: 0x3f8a4a,
    palmLeafDark: 0x2f7040,
    lampPole: 0x3c4046,
    lampHead: 0xffe9a8,
    bench: 0x7a5a38,
    container: [0xc8552e, 0x2e7fc8, 0x3f9a4a, 0xd8b83a, 0x8a5fc8],
    windowDark: 0x274b63,
    grass: 0x5f9a48,
    awning: [0xe8542e, 0x2e7fc8, 0xf2c230, 0x3f9a4a, 0xe84c7a],
    neon: [0xff2e88, 0x2ee6ff, 0xffc230, 0x7cff2e],
    kiosk: [0xd86a3a, 0x2e8a7a, 0xc8a02e, 0x7a5fc8],
    cloud: 0xfff2dd,
    sunDisc: 0xffd27a,
  },

  BUILDINGS: {
    total: 94,
    tall: 14,
    commercial: 32,
    house: 40,
    warehouse: 8,
    tallHeight: { min: 36, max: 90 },
    commercialHeight: { min: 9, max: 30 },
    houseHeight: { min: 6, max: 18 },
    warehouseHeight: { min: 10, max: 14 },
  },

  NATURE: {
    palms: 150,
    palmHeight: 7,
  },

  PROPS: {
    lamps: 120,
    benches: 48,
    containers: 40,
    signs: 36,
    bollards: 60,
    kiosks: 12,
    billboards: 10,
    total: 326,
  },

  // Vehicle catalogue. Top speed in m/s, used by vehicles.js.
  VEHICLES: {
    solara: { name: 'Solara S', kind: 'coupe', color: 0xf2c230, topSpeed: 42, accel: 18, grip: 1.0, durability: 100 },
    brisa: { name: 'Brisa LX', kind: 'sedan', color: 0x3a7fd8, topSpeed: 35, accel: 14, grip: 1.0, durability: 100 },
    cinderback: { name: 'Cinderback', kind: 'muscle', color: 0xc83a2e, topSpeed: 48, accel: 20, grip: 0.85, durability: 110 },
    dockrunner: { name: 'Dockrunner', kind: 'pickup', color: 0x3f9a4a, topSpeed: 32, accel: 13, grip: 1.05, durability: 140 },
    velvet: { name: 'Velvet Nine', kind: 'sedan', color: 0xe8e8e8, topSpeed: 44, accel: 16, grip: 1.0, durability: 100 },
  },
  STEAL_DISTANCE: 2.5,

  UPGRADES: {
    turbo: { name: 'Turbo', tiers: [0, 6, 12, 18], cost: [0, 600, 1200, 2000] },
    armor: { name: 'Armor', tiers: [0, 40, 90, 150], cost: [0, 500, 1000, 1800] },
    nitro: { name: 'Nitro', tiers: [0, 10, 20, 32], cost: [0, 700, 1400, 2400] },
    maxTier: 3,
  },

  TRAFFIC: {
    liveCars: 40,
    followDistance: 7,
    turnChance: 0.2,
    stuckRecoverySeconds: 4,
    pedSpeedMin: 1.2,
    pedSpeedMax: 1.6,
    clusters: 10,
    clusterSize: 7,
  },

  WANTED: {
    maxLevel: 3,
    loseSightSeconds: 12,
    decaySeconds: 8,
    stealWitness: 1,
    attackCivilian: 1,
    attackPolice: 2,
  },

  COMBAT: {
    fistRange: 2,
    fistDamage: 12,
    fistCooldown: 0.55,
    pistolMag: 12,
    pistolReserve: 60,
    pistolDamage: 28,
    pistolCooldown: 0.32,
    aimSoftLockDegrees: 15,
  },

  PLAYER: {
    walkSpeed: 5,
    runSpeed: 8,
    health: 100,
    armor: 0,
  },

  MISSIONS: {
    rewards: [800, 1100, 1500, 1900, 2300, 3500],
    respect: [100, 140, 180, 220, 260, 400],
  },

  RESPECT_RANKS: [
    { name: 'Pendatang', min: 0 },
    { name: 'Orang Bengkel', min: 250 },
    { name: 'Pengemudi Kota', min: 700 },
    { name: 'Nama Pelabuhan', min: 1400 },
    { name: 'Legenda Solmera', min: 2400 },
  ],

  CONTROLS: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    run: 'ShiftLeft',
    interact: 'KeyE',
    weapon1: 'Digit1',
    weapon2: 'Digit2',
    aim: 'Mouse2',
    fire: 'Mouse0',
    horn: 'KeyH',
    nitro: 'Space',
    radio: 'KeyR',
    pause: 'Escape',
    handbrake: 'Space',
  },

  CAMERA: {
    footDistance: 7,
    footHeight: 3.2,
    driveDistance: 11,
    driveHeight: 4.5,
    aimDistance: 4.5,
    aimHeight: 2.2,
    followLerp: 5,
    lookLerp: 8,
    minPitch: -0.1,
    maxPitch: 0.55,
  },

  RENDER: {
    fogNear: 500,
    fogFar: 1100,
    sunPosition: [-600, 180, 300],
    sunIntensity: 2.6,
    hemiSky: 0xffd9a0,
    hemiGround: 0x8a6a4e,
    hemiIntensity: 1.0,
    shadowMapSize: 2048,
    shadowCameraExtent: 700,
    maxPixelRatio: 1.75,
    targetFps: 60,
  },

  PERFORMANCE: {
    maxDrawDistance: 1200,
    maxPixelRatio: 1.75,
    shadowMapSize: 2048,
    trafficLive: 40,
    pedClusters: 18,
    instanceBudget: 900,
  },

  SHOTS: {
    width: 1280,
    height: 720,
  },
};

export default CONFIG;
