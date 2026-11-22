// COSTA DORADA — every tunable number and colour the game shares.
// The city is a regular coastal grid; distances are metres and times are seconds.

export const CITY = {
  columns: 7,
  rows: 7,
  pitch: 62,
  block: 46,
  road: 16,
  sidewalk: 4,
  padHeight: 0.17,
  curbHeight: 0.2,
  beachStart: 225,
  promenadeEnd: 246,
  shoreEnd: 276,
  waterLevel: -0.42,
  marina: { x0: 250, x1: 392, z0: 108, z1: 300 },
};

export const STEP = 1 / 60;
export const MAX_STEPS = 5;

export const PLAYER = {
  radius: 0.42,
  height: 1.78,
  walkSpeed: 3.4,
  runSpeed: 6.6,
  sprintSpeed: 9.2,
  crouchSpeed: 1.9,
  jumpSpeed: 5.2,
  gravity: 18,
  accel: 26,
  turnRate: 12,
  eyeHeight: 1.58,
};

export const CAR = {
  radius: 1.25,
  wheelBase: 2.72,
  track: 1.64,
  engineForce: 12.5,
  reverseForce: 6.0,
  brakeForce: 22,
  drag: 0.42,
  rollResist: 1.6,
  maxSteer: 0.62,
  grip: 7.2,
  driftGrip: 2.1,
  suspension: 46,
  damping: 7.5,
  topSpeed: 44,
};

export const CAMERA = {
  fov: 58,
  near: 0.12,
  far: 1400,
  shoulder: 0.62,
  pivotHeight: 1.52,
  distance: 4.5,
  minDistance: 1.15,
  height: 0.35,
  pitchMin: -0.95,
  pitchMax: 0.62,
  sensitivity: 0.0023,
  spring: 11,
  chaseDistance: 8.6,
  chaseHeight: 3.35,
  chasePitch: 0.16,
};

/** Clock hours the two authored shots freeze at. */
export const SHOT_TIMES = { cover: 17.35, night: 22.4, drive: 17.15, marina: 18.05 };

export const PALETTE = {
  golden: {
    skyTop: 0x28527f,
    skyMid: 0xb9878f,
    horizon: 0xffc48b,
    sunDisc: 0xfff3cf,
    sunGlow: 0xff9a45,
    fog: 0xe0b18c,
    fogNear: 75,
    fogFar: 760,
    sun: 0xffc48e,
    sunIntensity: 4.2,
    hemiSky: 0xffd8b4,
    hemiGround: 0x6b4a38,
    hemiIntensity: 3.2,
    fill: 0x7d9acb,
    fillIntensity: 0.55,
    exposure: 1.3,
    clear: 0xe0b18c,
  },
  night: {
    skyTop: 0x050b1a,
    skyMid: 0x0e1c38,
    horizon: 0x4a3a55,
    sunDisc: 0xbfd4ff,
    sunGlow: 0x33518a,
    fog: 0x1a2742,
    fogNear: 50,
    fogFar: 620,
    sun: 0xa9c0ec,
    sunIntensity: 2.6,
    hemiSky: 0x46618c,
    hemiGround: 0x181d28,
    hemiIntensity: 3.1,
    fill: 0x6d80b0,
    fillIntensity: 0.9,
    exposure: 1.55,
    clear: 0x0a1120,
  },
};

export const SURFACE = {
  asphalt: 0x2d2c30,
  asphaltLight: 0x3a383d,
  concrete: 0xb9ad9a,
  curb: 0xd6cab6,
  plaza: 0x8f8577,
  lot: 0x6f685f,
  sand: 0xdbc08d,
  promenade: 0xa89a86,
  grass: 0x4a6b3c,
  line: 0xe8dfca,
};

export const ART = {
  skin: [0xc98f68, 0x8d5a3b, 0xe0b08a, 0x6b432d],
  shirt: [0xe4d6b8, 0x3f6f74, 0xb0523e, 0x2e3450, 0xd9a23f],
  trousers: [0x2b3346, 0x40382e, 0x1f2a2c, 0x574c3d],
  hair: [0x1b1512, 0x3a2418, 0x11100f],
  vehicles: [0x8c2f2a, 0x2b5d74, 0xd7c48f, 0x3a3d42, 0x5c7a52, 0xb0642c, 0xd8d4c8],
};

export const HUD = {
  money: 2450,
  health: 100,
  armour: 72,
  weapon: 'SMG',
  ammo: 24,
  reserve: 120,
  mission: {
    eyebrow: 'MISSION 01 — THE HARBOUR RUN',
    title: 'Meet Vela at the marina',
    detail: 'The coupe is at the kerb. Take the boulevard south, then cut east along the shore.',
  },
  objective: { x: 288, z: 184 },
};

export const FONT = `"Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif`;
export const SERIF = `Georgia, "Times New Roman", serif`;
